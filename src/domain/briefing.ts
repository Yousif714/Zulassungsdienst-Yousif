import { invoiceOpenCents } from './ledger/receivables';
import { berlinParts, formatBerlin, todayBerlin } from './clock';
import { areaStale } from './freshness';
import { memberView, selectTop } from './detectors';
import { openReplies } from './matching/messages';
import { formatEuro } from './money';
import type { AppState, CalendarEvent, Company, ConnectionId, StoredInsight } from './types';

export type Briefing = {
  kind: 'morning' | 'evening' | 'weekly';
  title: string;
  top: StoredInsight[];
  events: CalendarEvent[];
  money: { company: Company; openCents: number; overdueCents: number; stale: boolean }[];
  repliesOpen: number;
  coach: StoredInsight[];
  dataAsOf: string;
  staleSources: ConnectionId[];
};

/** Quellen, von denen die Geldkarte einer Firma abhängt. */
export const MONEY_SOURCES: Record<Company, ConnectionId[]> = { nexus: ['bank_qonto', 'stripe_nexus'], zulassung: ['lexware_zulassung'] };

export function buildBriefing(s: AppState, kind: 'morning' | 'evening' | 'weekly', now: Date): Briefing {
  const today = todayBerlin(now);
  const open = s.insights.filter((i) => i.status === 'open');
  const coach = open.filter((i) => i.type.startsWith('coach_'));
  const top = selectTop(open.filter((i) => !i.type.startsWith('coach_')), 3);

  let nexusOpen = 0;
  let nexusOverdue = 0;
  for (const c of s.contracts) {
    const st = memberView(s, c.id, today).status;
    nexusOpen += st.openCents;
    nexusOverdue += st.arrearsCents;
  }
  const zInv = s.invoices
    .filter((i) => i.company === 'zulassung')
    .map((i) => ({ dueDate: i.dueDate, openCents: invoiceOpenCents(s, i) }));
  const zOpen = zInv.reduce((a, i) => a + i.openCents, 0);
  const zOverdue = zInv.filter((i) => i.dueDate < today).reduce((a, i) => a + i.openCents, 0);

  return {
    kind,
    title: kind === 'morning' ? 'Guten Morgen' : kind === 'evening' ? 'Guten Abend' : 'Wochenrückblick',
    top,
    events: s.events.filter((e) => berlinParts(new Date(e.startAt)).date === today).sort((a, b) => a.startAt.localeCompare(b.startAt)),
    money: [
      { company: 'nexus', openCents: nexusOpen, overdueCents: nexusOverdue, stale: areaStale(MONEY_SOURCES.nexus, s.connections, now).length > 0 },
      { company: 'zulassung', openCents: zOpen, overdueCents: zOverdue, stale: areaStale(MONEY_SOURCES.zulassung, s.connections, now).length > 0 },
    ],
    repliesOpen: openReplies(s.messages, now, s.settings.replyThresholdHours).length,
    coach,
    dataAsOf: formatBerlin(now, 'HH:mm'),
    staleSources: areaStale(s.connections.map((c) => c.id), s.connections, now),
  };
}

export function renderBriefingText(b: Briefing): string {
  const lines: string[] = [];
  lines.push(b.kind === 'morning' ? `Guten Morgen. ${b.top.length} Dinge heute:` : b.kind === 'evening' ? 'Guten Abend. Rückblick:' : 'Wochenrückblick:');
  b.top.forEach((t, i) => lines.push(`${i + 1}. ${t.title} · ${t.nextStep}`));
  if (b.events.length) {
    lines.push('Termine:');
    for (const e of b.events) lines.push(`${formatBerlin(new Date(e.startAt), 'HH:mm')} ${e.title}`);
  }
  if (b.repliesOpen) lines.push(`Offene Antworten: ${b.repliesOpen}`);
  for (const m of b.money) {
    const label = m.company === 'nexus' ? 'Geld NEXUS' : 'Geld Zulassungsdienst';
    lines.push(m.stale ? `${label}: Datenstand zu alt` : `${label}: offen ${formatEuro(m.openCents)}, überfällig ${formatEuro(m.overdueCents)}`);
  }
  lines.push(`Stand: ${b.dataAsOf}`);
  if (b.kind !== 'morning' && b.coach.length) {
    lines.push('Coach-Tipps:');
    for (const c of b.coach) lines.push(`- ${c.title} · ${c.nextStep}`);
  }
  return lines.join('\n');
}
