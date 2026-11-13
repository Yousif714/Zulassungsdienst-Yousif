import { openInsights, nexusForecast, overdueMembers } from '@/data/selectors';
import type { AITools, ToolName, ToolResult } from '@/domain/ai-port';
import { todayBerlin } from '@/domain/clock';
import { selectTop } from '@/domain/detectors';
import { invoiceOpenCents } from '@/domain/ledger/receivables';
import { openReplies } from '@/domain/matching/messages';
import type { AppState, Contact } from '@/domain/types';

const GENERIC = new Set(['autohaus', 'gmbh', 'kg', 'und', 'co', 'herr', 'frau']);

/** Die Anfrage kommt schon normalisiert (kleingeschrieben, Umlaute aufgelöst) vom Provider. */
function norm(t: string): string {
  return t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

function findContact(q: string, s: AppState): Contact | undefined {
  return s.contacts.find((c) => {
    if (c.kind !== 'dealer' && c.kind !== 'private') return false;
    const tokens = norm(c.name).split(/\s+/).filter((t) => t && !GENERIC.has(t));
    return tokens.length > 0 && tokens.every((t) => q.includes(t));
  });
}

export function createStateTools(s: AppState, now: Date): AITools {
  const today = todayBerlin(now);
  const impl = {
    overdue_members: () => ({
      members: overdueMembers(s, today).map((m) => ({ contractId: m.contractId, name: m.name, arrearsCents: m.arrearsCents, traffic: m.traffic })),
    }),
    open_today: () => {
      const open = openInsights(s);
      return {
        openCount: open.length,
        top: selectTop(open, 3).map((i) => ({ title: i.title, nextStep: i.nextStep, href: i.refs[0]?.href ?? null })),
      };
    },
    month_money: () => {
      const f = nexusForecast(s, today);
      const month = today.slice(0, 7);
      const open = s.invoices
        .filter((i) => i.company === 'zulassung' && i.dueDate.startsWith(month))
        .map((i) => invoiceOpenCents(s, i))
        .filter((cents) => cents > 0);
      return {
        expectedCents: f.expectedCents,
        atRiskCents: f.atRiskCents,
        zulassungOpenCents: open.reduce((n, cents) => n + cents, 0),
        zulassungOpenCount: open.length,
      };
    },
    series_calls: ({ query }: { query: string }) => {
      const q = norm(query);
      const series = [...new Set(s.calls.map((c) => c.series))].find((x) => q.includes(norm(x))) ?? null;
      if (!series) return { series: null, next: null };
      const next = s.calls
        .filter((c) => c.series === series && Date.parse(c.startsAt) >= now.getTime())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
      return {
        series,
        next: next ? { id: next.id, topic: next.topic, startsAt: next.startsAt, slides: next.slides.length, slideCount: next.slideCount } : null,
      };
    },
    find_job: ({ query }: { query: string }) => {
      const q = norm(query);
      const contact = findContact(q, s);
      if (!contact) return { contact: null, job: null, lastMessage: null, waitingHours: null };
      const job = s.jobs
        .filter((j) => j.contactId === contact.id && j.status !== 'paid')
        .sort((a, b) => (b.doneAt ?? '9999').localeCompare(a.doneAt ?? '9999'))[0];
      const base = { contact: { id: contact.id, name: contact.name } };
      if (!job) return { ...base, job: null, lastMessage: null, waitingHours: null };
      const msgs = s.messages
        .filter((m) => m.jobId === job.id || m.contactId === contact.id)
        .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
      const last = msgs[msgs.length - 1];
      const waiting = last ? openReplies(s.messages, now, s.settings.replyThresholdHours).find((r) => r.message.threadId === last.threadId) : undefined;
      return {
        ...base,
        job: { id: job.id, service: job.service, status: job.status },
        lastMessage: last ? { direction: last.direction, sentAt: last.sentAt, body: last.body, threadId: last.threadId } : null,
        waitingHours: waiting ? waiting.waitingHours : null,
      };
    },
  };
  return {
    async call(name, args) {
      return (impl[name] as (a: unknown) => unknown)(args) as never;
    },
  };
}
