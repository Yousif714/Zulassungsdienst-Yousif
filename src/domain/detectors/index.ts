import { areaStale } from '../freshness';
import type { AppState, ConnectionId, Insight, StoredInsight } from '../types';
import { detectCallSlides } from './calls';
import { detectCommitments } from './commitments';
import { detectDoubleInvoices, detectInvoiceOverdue, detectStripePaidLexwareOpen } from './invoices';
import { detectJobsNotInvoiced } from './jobs';
import { detectMemberOverdue } from './members';
import { detectUnmatchedPayments } from './payments';
import { detectSubscriptionChanges } from './subscriptions';
import { detectReplies } from './replies';
import { detectStaleSources } from './sources';
import { detectPortalAbNoInvoice, detectPortalNoInvoice } from './portal';

export { memberView } from './members';

export function runDetectors(s: AppState, now: Date): Insight[] {
  const all = [
    ...detectReplies(s, now),
    ...detectMemberOverdue(s, now),
    ...detectUnmatchedPayments(s, now),
    ...detectSubscriptionChanges(s),
    ...detectStripePaidLexwareOpen(s),
    ...detectDoubleInvoices(s),
    ...detectJobsNotInvoiced(s),
    ...detectInvoiceOverdue(s, now),
    ...detectCallSlides(s, now),
    ...detectCommitments(s, now),
    ...detectStaleSources(s, now),
    ...detectPortalNoInvoice(s),
    ...detectPortalAbNoInvoice(s),
  ];
  return all.filter((i) => areaStale(i.needsSources, s.connections, now).length === 0);
}

const RANK = { now: 0, today: 1, info: 2 } as const;

export function selectTop(list: StoredInsight[], max = 3): StoredInsight[] {
  return list
    .filter((i) => i.status === 'open')
    .sort(
      (a, b) =>
        RANK[a.priority] - RANK[b.priority] ||
        (b.amountCents ?? 0) - (a.amountCents ?? 0) ||
        a.createdAt.localeCompare(b.createdAt),
    )
    .slice(0, max);
}

export function reconcileInsights(
  existing: StoredInsight[],
  fresh: Insight[],
  now: Date,
  staleSources: ConnectionId[] = [],
  suppressedKeys: string[] = [],
): StoredInsight[] {
  const stamp = now.toISOString();
  const freshByKey = new Map<string, Insight>();
  for (const f of fresh) if (!freshByKey.has(f.dedupeKey)) freshByKey.set(f.dedupeKey, f);

  const out: StoredInsight[] = existing.map((e) => {
    const f = freshByKey.get(e.dedupeKey);
    if (f) {
      if (e.status === 'dismissed') return e;
      if (e.status === 'done' || e.status === 'stale') {
        const reopened: StoredInsight = { ...e, ...f, status: 'open', createdAt: stamp };
        delete reopened.resolvedAt;
        return reopened;
      }
      return { ...e, ...f, status: e.status };
    }
    const sourceStale = e.needsSources.some((x) => staleSources.includes(x));
    if (e.status === 'open') return sourceStale ? { ...e, status: 'stale' } : { ...e, status: 'done', resolvedAt: stamp };
    // Abgehakt und Anlass weg: Episode vorbei. Kommt der Anlass später wieder, öffnet sich der Hinweis neu.
    // Bei veralteter Quelle ist unklar, ob der Anlass weg ist; unterdrückte Coach-Tipps fehlen absichtlich: beide bleiben abgehakt.
    if (e.status === 'dismissed' && !sourceStale && !suppressedKeys.includes(e.dedupeKey)) return { ...e, status: 'done', resolvedAt: stamp };
    return e;
  });
  const known = new Set(existing.map((e) => e.dedupeKey));
  for (const [key, f] of freshByKey) if (!known.has(key)) out.push({ ...f, status: 'open', createdAt: stamp });
  return out;
}
