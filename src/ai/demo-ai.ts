import { formatBerlin, todayBerlin } from '@/domain/clock';
import { openInsights, nexusForecast, overdueMembers } from '@/data/selectors';
import { detectCommitment } from '@/domain/commitments';
import { selectTop } from '@/domain/detectors';
import { extractPlates, openReplies } from '@/domain/matching/messages';
import { formatEuro } from '@/domain/money';
import type { AppState, Call, Contact, Job, Message } from '@/domain/types';
import type { AIProvider, ChatAnswer } from './provider';

export const demoPaymentLink = (contractId: string) => `https://buy.stripe.com/demo/${contractId}`;

const GENERIC = new Set(['autohaus', 'gmbh', 'kg', 'und', 'co', 'herr', 'frau']);
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

function answerOverdue(s: AppState, today: string): ChatAnswer {
  const list = overdueMembers(s, today);
  if (list.length === 0) return { text: 'Aktuell ist bei NEXUS niemand überfällig.', links: [] };
  const sum = list.reduce((n, m) => n + m.arrearsCents, 0);
  const lines = list.map((m) => `${m.name}: ${formatEuro(m.arrearsCents)} (${m.traffic === 'red' ? 'rot' : 'gelb'})`);
  return {
    text: `Überfällig bei NEXUS:\n${lines.join('\n')}\nZusammen ${formatEuro(sum)}.`,
    links: list.map((m) => ({ label: m.name, href: `/nexus/mitglieder/${m.contractId}` })),
  };
}

function answerToday(s: AppState): ChatAnswer {
  const open = openInsights(s);
  const top = selectTop(open, 3);
  const lines = top.map((i, n) => `${n + 1}. ${i.title} · ${i.nextStep}`);
  return {
    text: `Heute sind ${open.length} Hinweise offen.${lines.length ? `\nDie wichtigsten:\n${lines.join('\n')}` : ''}`,
    links: top.flatMap((i) => (i.refs[0] ? [{ label: i.title, href: i.refs[0].href }] : [])),
  };
}

function answerSeries(q: string, s: AppState, now: Date): ChatAnswer | null {
  const series = [...new Set(s.calls.map((c) => c.series))].find((x) => q.includes(norm(x)));
  if (!series) return null;
  const next = s.calls
    .filter((c) => c.series === series && Date.parse(c.startsAt) >= now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!next) return { text: `Für ${series} ist kein weiterer Call geplant.`, links: [] };
  return {
    text: `Nächster ${series}-Call: ${formatBerlin(new Date(next.startsAt), 'dd.MM.yyyy')} um ${formatBerlin(new Date(next.startsAt), 'HH:mm')} Uhr. Folienstand ${next.slides.length}/${next.slideCount}.`,
    links: [{ label: next.topic, href: `/nexus/calls/${next.id}` }],
  };
}

function findContact(q: string, s: AppState): Contact | undefined {
  return s.contacts.find((c) => {
    if (c.kind !== 'dealer' && c.kind !== 'private') return false;
    const tokens = norm(c.name).split(/\s+/).filter((t) => t && !GENERIC.has(t));
    return tokens.length > 0 && tokens.every((t) => q.includes(t));
  });
}

function answerJob(q: string, s: AppState, now: Date): ChatAnswer | null {
  const contact = findContact(q, s);
  if (!contact) return null;
  const job = s.jobs
    .filter((j) => j.contactId === contact.id && j.status !== 'paid')
    .sort((a, b) => (b.doneAt ?? '9999').localeCompare(a.doneAt ?? '9999'))[0];
  if (!job) return { text: `Für ${contact.name} gibt es keinen offenen Auftrag.`, links: [] };
  const msgs = s.messages
    .filter((m) => m.jobId === job.id || m.contactId === contact.id)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const last = msgs[msgs.length - 1];
  const parts = [`Auftrag ${job.service} für ${contact.name}: ${JOB_STATUS[job.status]}.`];
  const links = [{ label: `Auftrag ${contact.name}`, href: `/zulassung/auftraege/${job.id}` }];
  if (last) {
    parts.push(`Letzte Nachricht (${last.direction === 'in' ? 'von ihm' : 'von uns'}, ${formatBerlin(new Date(last.sentAt), 'dd.MM. HH:mm')} Uhr): "${last.body}"`);
    const waiting = openReplies(s.messages, now, s.settings.replyThresholdHours).find((r) => r.message.threadId === last.threadId);
    if (waiting) parts.push(`Er wartet seit ${waiting.waitingHours} Std. auf Antwort.`);
    links.push({ label: 'Nachricht', href: `/nachrichten/${last.threadId}` });
  }
  return { text: parts.join('\n'), links };
}

function answerMoney(s: AppState, today: string): ChatAnswer {
  const f = nexusForecast(s, today);
  const month = today.slice(0, 7);
  const open = s.invoices.filter(
    (i) => i.company === 'zulassung' && i.status !== 'void' && i.openCents > 0 && i.dueDate.startsWith(month),
  );
  const z = open.reduce((n, i) => n + i.openCents, 0);
  return {
    text: `NEXUS: erwartet ${formatEuro(f.expectedCents)}, davon ${formatEuro(f.atRiskCents)} wackelig.\nZulassungsdienst: ${formatEuro(z)} offen mit Fälligkeit in diesem Monat (${open.length} Rechnungen).`,
    links: [
      { label: 'NEXUS', href: '/nexus' },
      { label: 'Zulassungsdienst', href: '/zulassung' },
    ],
  };
}

const STEPS = ['Ausgangslage', 'Das Problem', 'Die Grundidee', 'Schritt für Schritt', 'Ein Beispiel aus der Praxis', 'Typische Stolpersteine', 'Übung für die Woche', 'Fragen und Austausch', 'Zusammenfassung', 'Nächste Schritte'];

export const demoAI: AIProvider = {
  async answer(question, s, now) {
    const q = norm(question);
    const today = todayBerlin(now);
    if (q.includes('ueberfaellig')) return answerOverdue(s, today);
    if (q.includes('heute') && q.includes('offen')) return answerToday(s);
    const series = answerSeries(q, s, now);
    if (series) return series;
    if (q.includes('auftrag')) {
      const job = answerJob(q, s, now);
      if (job) return job;
    }
    if ((q.includes('geld') || q.includes('rein')) && q.includes('monat')) return answerMoney(s, today);
    return { text: FALLBACK, links: [] };
  },

  async draftReply(thread: Message[], contact: Contact | null) {
    const last = [...thread].filter((m) => m.direction === 'in').sort((a, b) => a.sentAt.localeCompare(b.sentAt)).pop();
    const greeting = contact ? `Guten Tag ${contact.name},` : 'Guten Tag,';
    const plate = last ? extractPlates(last.body)[0] : undefined;
    const topic = plate ? `zu Ihrem Fahrzeug ${plate}` : 'zu Ihrer Nachricht';
    return `${greeting}\n\nvielen Dank für Ihre Nachricht ${topic}. Wir kümmern uns darum und melden uns heute noch mit dem aktuellen Stand bei Ihnen.\n\nFreundliche Grüße\nZulassungsdienst`;
  },

  async draftReminder(contact, status, tone, paymentLink) {
    const amount = formatEuro(status.arrearsCents);
    if (tone === 'freundlich') {
      return `Hallo ${contact.name},\n\nkleine Erinnerung: Bei Ihrem NEXUS-Zugang ist noch ein Betrag von ${amount} offen. Falls sich das mit Ihrer Zahlung überschnitten hat, sehen Sie es uns bitte nach. Hier können Sie bequem bezahlen:\n${paymentLink}\n\nHerzliche Grüße\nNEXUS`;
    }
    return `Hallo ${contact.name},\n\nauf Ihrem NEXUS-Konto besteht ein Rückstand von ${amount}. Bitte begleichen Sie den Betrag bis spätestens in 3 Tagen über diesen Link:\n${paymentLink}\n\nMelden Sie sich bei Fragen umgehend bei uns.\n\nGrüße\nNEXUS`;
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

  detectCommitment(text, sentAt) {
    return detectCommitment(text, sentAt);
  },
};
