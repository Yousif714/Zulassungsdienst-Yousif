import { formatBerlin } from '../clock';
import type { AppState, Insight } from '../types';
import { threadRef } from './refs';

export function detectCommitments(s: AppState, now: Date): Insight[] {
  const out: Insight[] = [];
  for (const c of s.commitments) {
    const broken = c.status === 'broken' || (c.status === 'open' && Date.parse(c.dueAt) < now.getTime());
    if (!broken) continue;
    const m = s.messages.find((x) => x.id === c.messageId);
    if (!m) continue;
    const contact = s.contacts.find((x) => x.id === c.contactId);
    const name = contact?.name ?? m.from;
    out.push({
      dedupeKey: `commit:${c.id}`,
      type: 'commitment_broken',
      company: contact?.company ?? null,
      priority: 'today',
      title: `Zusage an ${name} ist überfällig`,
      body: `„${c.text}“, zugesagt bis ${formatBerlin(new Date(c.dueAt), 'dd.MM.yyyy, HH:mm')} Uhr.`,
      refs: [threadRef(m.threadId, name)],
      nextStep: 'Zusage einlösen oder Kunden informieren',
      needsSources: [m.connectionId],
    });
  }
  return out;
}
