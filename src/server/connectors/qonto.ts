import 'server-only';

import { cursorOutdated, emptyBatch, IMPORT_SINCE, type ImportBatch } from '@/domain/import/batch';
import { mapQonto, QF } from '@/domain/import/qonto';

import { createApiClient } from './http';
import { BudgetExceeded, type PullContext, type PullResult } from './types';

export const QONTO_BASE = 'https://thirdparty.qonto.com/v2';
/** IMPORT_SINCE als Berliner Mitternacht (Sommerzeit, UTC+2) in UTC. */
export const QONTO_SINCE = new Date(Date.parse(`${IMPORT_SINCE}T00:00:00Z`) - 2 * 3_600_000).toISOString();
export const QONTO_OVERLAP_MS = 3 * 86_400_000;
const MIN_INTERVAL_MS = 500;
const PER_PAGE = 100;

/** Qonto-Feld- und Parameternamen des Connectors (Buchungsfelder: `QF` im Mapper). Alle gegen Doku prüfen (https://api-doc.qonto.com; Session ohne Netz). Eine Stelle für Korrekturen. */
const QO = {
  org: 'organization', accounts: 'bank_accounts', accountId: 'id', accountCurrency: 'currency', accountStatus: 'status',
  closedStatus: 'closed', currency: 'EUR', meta: 'meta', nextPage: 'next_page',
  qAccount: 'bank_account_id', qStatus: 'status[]', qStatusValue: 'completed', qSettledFrom: 'settled_at_from',
  qSort: 'sort_by', qSortValue: 'settled_at:asc', qPerPage: 'per_page', qPage: 'current_page',
  apiPrefix: '/v2', orgPath: '/organization', txPath: '/transactions',
} as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;
/** Nur der Connector kennt diese Form. `accountId` null = Zyklusanfang; Konten werden über die ID wiedergefunden, nicht über einen Index. */
interface Cursor { settledFrom: string; accountId: string | null; page: number; maxSettled: string | null; since: string }

/** Feste Parameterreihenfolge (Tests und Routen-Fixtures verlassen sich darauf). */
export const qontoTransactionsQuery = (accountId: string, settledFrom: string, page: number): string =>
  new URLSearchParams([
    [QO.qAccount, accountId], [QO.qStatus, QO.qStatusValue], [QO.qSettledFrom, settledFrom],
    [QO.qSort, QO.qSortValue], [QO.qPerPage, String(PER_PAGE)], [QO.qPage, String(page)],
  ]).toString();

const fresh = (): Cursor => ({ settledFrom: QONTO_SINCE, accountId: null, page: 1, maxSettled: null, since: IMPORT_SINCE });
const validTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

function parseCursor(raw: string | null): Cursor {
  if (raw) {
    try {
      const c = JSON.parse(raw) as Cursor;
      if (!cursorOutdated(c.since) && validTime(c.settledFrom) && (c.accountId === null || typeof c.accountId === 'string') && Number.isInteger(c.page) && c.page >= 1 && (c.maxSettled === null || validTime(c.maxSettled))) {
        return { settledFrom: c.settledFrom, accountId: c.accountId, page: c.page, maxSettled: c.maxSettled, since: IMPORT_SINCE };
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
    const org = await get(`${QO.apiPrefix}${QO.orgPath}`);
    const accounts = ((org[QO.org]?.[QO.accounts] ?? []) as Obj[])
      .filter((a) => typeof a[QO.accountId] === 'string' && a[QO.accountCurrency] === QO.currency && a[QO.accountStatus] !== QO.closedStatus)
      .map((a) => a[QO.accountId] as string)
      .sort();
    // Konto über die ID wiederfinden; fehlt es (geschlossen/umgestellt), mit dem nächsten Konto in Reihenfolge ab Seite 1 weitermachen.
    let idx = 0;
    if (state.accountId !== null) {
      const at = accounts.indexOf(state.accountId);
      if (at >= 0) idx = at;
      else { idx = accounts.findIndex((id) => id > state.accountId!); if (idx < 0) idx = accounts.length; state.page = 1; }
    }
    for (; idx < accounts.length; idx++, state.page = 1) {
      state.accountId = accounts[idx];
      for (;;) {
        const res = await get(`${QO.apiPrefix}${QO.txPath}?${qontoTransactionsQuery(accounts[idx], state.settledFrom, state.page)}`);
        const list = (res[QF.list] ?? []) as Obj[];
        const mapped = mapQonto(list);
        batch.payments.push(...mapped.payments);
        for (const t of list) {
          const at = t[QF.settledAt];
          if (validTime(at) && (state.maxSettled === null || Date.parse(at) > Date.parse(state.maxSettled))) state.maxSettled = at;
        }
        const next = res[QO.meta]?.[QO.nextPage];
        // Nur vorwärts und endlich, sonst gilt die Liste als fertig (kein Endlos-Blättern bei fehlerhafter Antwort).
        if (typeof next !== 'number' || !Number.isInteger(next) || next <= state.page) break;
        state.page = next;
      }
    }
    complete = true;
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e; // inkl. RateLimited
  }
  if (!complete) return { batch, cursor: JSON.stringify(state), complete: false };
  const from = state.maxSettled === null ? QONTO_SINCE : new Date(Math.max(Date.parse(QONTO_SINCE), Date.parse(state.maxSettled) - QONTO_OVERLAP_MS)).toISOString();
  return { batch, cursor: JSON.stringify({ settledFrom: from, accountId: null, page: 1, maxSettled: null, since: IMPORT_SINCE } satisfies Cursor), complete: true };
}
