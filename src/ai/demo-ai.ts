import { formatBerlin } from '@/domain/clock';
import { detectCommitment } from '@/domain/commitments';
import { extractPlates } from '@/domain/matching/messages';
import { formatEuro } from '@/domain/money';
import type { AIProvider, AITools, ChatAnswer } from '@/domain/ai-port';
import type { Call, Job } from '@/domain/types';

const FALLBACK = 'Das kann die Demo noch nicht beantworten. Ab Phase 2 beantwortet Claude jede Frage.';

function norm(t: string): string {
  return t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

const JOB_STATUS: Record<Job['status'], string> = {
  open: 'offen',
  waiting_customer: 'wartet auf den Kunden',
  done: 'erledigt',
  invoiced: 'in Rechnung gestellt',
  paid: 'bezahlt',
};

async function answerOverdue(tools: AITools): Promise<ChatAnswer> {
  const { members: list } = await tools.call('overdue_members', {});
  if (list.length === 0) return { text: 'Aktuell ist bei NEXUS niemand überfällig.', links: [] };
  const sum = list.reduce((n, m) => n + m.arrearsCents, 0);
  const lines = list.map((m) => `${m.name}: ${formatEuro(m.arrearsCents)} (${m.traffic === 'red' ? 'rot' : 'gelb'})`);
  return {
    text: `Überfällig bei NEXUS:\n${lines.join('\n')}\nZusammen ${formatEuro(sum)}.`,
    links: list.map((m) => ({ label: m.name, href: `/nexus/mitglieder/${m.contractId}` })),
  };
}

async function answerToday(tools: AITools): Promise<ChatAnswer> {
  const { openCount, top } = await tools.call('open_today', {});
  const lines = top.map((i, n) => `${n + 1}. ${i.title} · ${i.nextStep}`);
  return {
    text: `Heute sind ${openCount} Hinweise offen.${lines.length ? `\nDie wichtigsten:\n${lines.join('\n')}` : ''}`,
    links: top.flatMap((i) => (i.href ? [{ label: i.title, href: i.href }] : [])),
  };
}

async function answerSeries(q: string, tools: AITools): Promise<ChatAnswer | null> {
  const { series, next } = await tools.call('series_calls', { query: q });
  if (!series) return null;
  if (!next) return { text: `Für ${series} ist kein weiterer Call geplant.`, links: [] };
  return {
    text: `Nächster ${series}-Call: ${formatBerlin(new Date(next.startsAt), 'dd.MM.yyyy')} um ${formatBerlin(new Date(next.startsAt), 'HH:mm')} Uhr. Folienstand ${next.slides}/${next.slideCount}.`,
    links: [{ label: next.topic, href: `/nexus/calls/${next.id}` }],
  };
}

async function answerJob(q: string, tools: AITools): Promise<ChatAnswer | null> {
  const { contact, job, lastMessage: last, waitingHours } = await tools.call('find_job', { query: q });
  if (!contact) return null;
  if (!job) return { text: `Für ${contact.name} gibt es keinen offenen Auftrag.`, links: [] };
  const parts = [`Auftrag ${job.service} für ${contact.name}: ${JOB_STATUS[job.status]}.`];
  const links = [{ label: `Auftrag ${contact.name}`, href: `/zulassung/auftraege/${job.id}` }];
  if (last) {
    parts.push(`Letzte Nachricht (${last.direction === 'in' ? 'von ihm' : 'von uns'}, ${formatBerlin(new Date(last.sentAt), 'dd.MM. HH:mm')} Uhr): "${last.body}"`);
    if (waitingHours !== null) parts.push(`Er wartet seit ${waitingHours} Std. auf Antwort.`);
    links.push({ label: 'Nachricht', href: `/nachrichten/${last.threadId}` });
  }
  return { text: parts.join('\n'), links };
}

async function answerMoney(tools: AITools): Promise<ChatAnswer> {
  const m = await tools.call('month_money', {});
  return {
    text: `NEXUS: erwartet ${formatEuro(m.expectedCents)}, davon ${formatEuro(m.atRiskCents)} wackelig.\nZulassungsdienst: ${formatEuro(m.zulassungOpenCents)} offen mit Fälligkeit in diesem Monat (${m.zulassungOpenCount} Rechnungen).`,
    links: [
      { label: 'NEXUS', href: '/nexus' },
      { label: 'Zulassungsdienst', href: '/zulassung' },
    ],
  };
}

const STEPS = ['Ausgangslage', 'Das Problem', 'Die Grundidee', 'Schritt für Schritt', 'Ein Beispiel aus der Praxis', 'Typische Stolpersteine', 'Übung für die Woche', 'Fragen und Austausch', 'Zusammenfassung', 'Nächste Schritte'];

export const demoAI: AIProvider = {
  async answer(question, { tools }) {
    const q = norm(question);
    if (q.includes('ueberfaellig')) return answerOverdue(tools);
    if (q.includes('heute') && q.includes('offen')) return answerToday(tools);
    const series = await answerSeries(q, tools);
    if (series) return series;
    if (q.includes('auftrag')) {
      const job = await answerJob(q, tools);
      if (job) return job;
    }
    if ((q.includes('geld') || q.includes('rein')) && q.includes('monat')) return answerMoney(tools);
    return { text: FALLBACK, links: [] };
  },

  async draftReply({ thread, contact }) {
    const last = [...thread].filter((m) => m.direction === 'in').sort((a, b) => a.sentAt.localeCompare(b.sentAt)).pop();
    const greeting = contact ? `Guten Tag ${contact.name},` : 'Guten Tag,';
    const plate = last ? extractPlates(last.body)[0] : undefined;
    const topic = plate ? `zu Ihrem Fahrzeug ${plate}` : 'zu Ihrer Nachricht';
    return `${greeting}\n\nvielen Dank für Ihre Nachricht ${topic}. Wir kümmern uns darum und melden uns heute noch mit dem aktuellen Stand bei Ihnen.\n\nFreundliche Grüße\nZulassungsdienst`;
  },

  async draftReminder({ contact, status, tone, paymentLink }) {
    const amount = formatEuro(status.arrearsCents);
    // Ohne gültigen Link (Echtbetrieb ohne Umstellung) kein Link-Satz.
    if (tone === 'freundlich') {
      const pay = paymentLink ? ` Hier können Sie bequem bezahlen:\n${paymentLink}` : '';
      return `Hallo ${contact.name},\n\nkleine Erinnerung: Bei Ihrem NEXUS-Zugang ist noch ein Betrag von ${amount} offen. Falls sich das mit Ihrer Zahlung überschnitten hat, sehen Sie es uns bitte nach.${pay}\n\nHerzliche Grüße\nNEXUS`;
    }
    const pay = paymentLink ? ` über diesen Link:\n${paymentLink}` : '.';
    return `Hallo ${contact.name},\n\nauf Ihrem NEXUS-Konto besteht ein Rückstand von ${amount}. Bitte begleichen Sie den Betrag bis spätestens in 3 Tagen${pay}\n\nMelden Sie sich bei Fragen umgehend bei uns.\n\nGrüße\nNEXUS`;
  },

  async slidesFor(call: Call) {
    const subject = call.topic.includes(':') ? call.topic.split(':').slice(1).join(':').trim() : call.topic;
    return Array.from({ length: call.slideCount }, (_, i) => {
      const heading = i === 0 ? subject : (STEPS[i % STEPS.length] ?? 'Vertiefung');
      return {
        position: i + 1,
        title: `Folie ${i + 1}: ${heading}`,
        body: `${heading} im Thema „${subject}“\n- Kernaussage ${i + 1} zu ${call.series}\n- Beispiel aus dem Alltag der Teilnehmer\n- Frage an die Runde`,
      };
    });
  },

  async detectCommitment(text, sentAt) {
    return detectCommitment(text, sentAt);
  },
};
