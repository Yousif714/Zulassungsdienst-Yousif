import 'server-only';

import { emptyBatch, type ImportBatch } from '@/domain/import/batch';
import { mapQonto, QF } from '@/domain/import/qonto';

import { createApiClient } from './http';
import { BudgetExceeded, type PullContext, type PullResult } from './types';

export const QONTO_BASE = 'https://thirdparty.qonto.com/v2';
/** IMPORT_SINCE (2026-08-01) als Berliner Mitternacht in UTC. */
export const QONTO_SINCE = '2026-07-31T22:00:00.000Z';
export const QONTO_OVERLAP_MS = 3 * 86_400_000;
const MIN_INTERVAL_MS = 500;
const PER_PAGE = 100;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;
/** Nur der Connector kennt diese Form. */
interface Cursor { settledFrom: string; account: number; page: number; maxSettled: string | null }

/** Feste Parameterreihenfolge (Tests und Routen-Fixtures verlassen sich darauf). */
export const qontoTransactionsQuery = (accountId: string, settledFrom: string, page: number): string =>
  new URLSearchParams([
    ['bank_account_id', accountId], ['status[]', 'completed'], ['settled_at_from', settledFrom],
    ['sort_by', 'settled_at:asc'], ['per_page', String(PER_PAGE)], ['current_page', String(page)],
  ]).toString();

const fresh = (): Cursor => ({ settledFrom: QONTO_SINCE, account: 0, page: 1, maxSettled: null });
const validTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

function parseCursor(raw: string | null): Cursor {
  if (raw) {
    try {
      const c = JSON.parse(raw) as Cursor;
      if (validTime(c.settledFrom) && Number.isInteger(c.account) && c.account >= 0 && Number.isInteger(c.page) && c.page >= 1 && (c.maxSettled === null || validTime(c.maxSettled))) {
        return { settledFrom: c.settledFrom, account: c.account, page: c.page, maxSettled: c.maxSettled };
      }
    } catch { /* ungültiger Cursor → Neustart */ }
  }
  return fresh();
}

export async function pullQonto(cursor: string | null, ctx: PullContext): Promise<PullResult> {
  // ctx.key = '<login>:<secret>' und geht unverändert als Authorization-Header (ohne Bearer).
  const api = createApiClient({ label: 'Qonto', baseUrl: new URL(QONTO_BASE).origin, key: ctx.key, authorization: ctx.key, fetch: ctx.fetch, sleep: ctx.sleep, now: ctx.now, minIntervalMs: MIN_INTERVAL_MS });
  const get = async (pathAndQuery: string): Promise<Obj> => {
    if (ctx.now() >= ctx.deadline) throw new BudgetExceeded();
    return (await api.getJson(pathAndQuery)) as Obj;
  };

  const state = parseCursor(cursor);
  const batch: ImportBatch = emptyBatch();
  let complete = false;
  try {
    const org = await get('/v2/organization');
    const accounts = ((org.organization?.bank_accounts ?? []) as Obj[])
      .filter((a) => typeof a.id === 'string' && a.currency === 'EUR' && a.status !== 'closed')
      .map((a) => a.id as string)
      .sort();
    for (; state.account < accounts.length; state.account++, state.page = 1) {
      for (;;) {
        const res = await get(`/v2/transactions?${qontoTransactionsQuery(accounts[state.account], state.settledFrom, state.page)}`);
        const list = (res[QF.list] ?? []) as Obj[];
        const mapped = mapQonto(list);
        batch.payments.push(...mapped.payments);
        for (const t of list) {
          const at = t[QF.settledAt];
          if (validTime(at) && (state.maxSettled === null || Date.parse(at) > Date.parse(state.maxSettled))) state.maxSettled = at;
        }
        const next = res.meta?.next_page;
        if (next === null || next === undefined) break;
        state.page = Number(next);
      }
    }
    complete = true;
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e; // inkl. RateLimited
  }
  if (!complete) return { batch, cursor: JSON.stringify(state), complete: false };
  const from = state.maxSettled === null ? QONTO_SINCE : new Date(Math.max(Date.parse(QONTO_SINCE), Date.parse(state.maxSettled) - QONTO_OVERLAP_MS)).toISOString();
  return { batch, cursor: JSON.stringify({ settledFrom: from, account: 0, page: 1, maxSettled: null } satisfies Cursor), complete: true };
}
