import 'server-only';

import { emptyBatch, IMPORT_SINCE, type ImportBatch } from '@/domain/import/batch';
import { mapLexwareContacts, mapLexwareInvoice, type LexwareConnection } from '@/domain/import/lexware';

import { createApiClient } from './http';
import { BudgetExceeded, type PullContext, type PullResult } from './types';

type Phase = 'contacts' | 'invoices';
interface Cursor { phase: Phase; page: number }
/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

const PAGE_SIZE = 100;
const MIN_INTERVAL_MS = 500; // höchstens 2 Anfragen pro Sekunde
const VOUCHER_STATUS = 'open,paid,paidoff,voided,overdue'; // ohne draft

function parseCursor(raw: string | null): Cursor {
  if (raw) {
    try {
      const c = JSON.parse(raw) as Cursor;
      if ((c.phase === 'contacts' || c.phase === 'invoices') && Number.isInteger(c.page) && c.page >= 0) return { phase: c.phase, page: c.page };
    } catch { /* ungültiger Cursor → Neustart */ }
  }
  return { phase: 'contacts', page: 0 };
}

const isLast = (page: Obj, n: number): boolean => page.last === true || !(page.content?.length > 0) || (Number.isInteger(page.totalPages) && n + 1 >= page.totalPages);

export async function pullLexware(conn: LexwareConnection, cursor: string | null, ctx: PullContext): Promise<PullResult> {
  const api = createApiClient({ label: 'Lexware', baseUrl: 'https://api.lexware.io', key: ctx.key, fetch: ctx.fetch, sleep: ctx.sleep, now: ctx.now, minIntervalMs: MIN_INTERVAL_MS });
  const get = async (pathAndQuery: string): Promise<Obj> => {
    if (ctx.now() >= ctx.deadline) throw new BudgetExceeded();
    return (await api.getJson(pathAndQuery)) as Obj;
  };

  const state = parseCursor(cursor);
  const batch: ImportBatch = emptyBatch();
  let complete = false;
  try {
    if (state.phase === 'contacts') {
      for (;;) {
        const page = await get(`/v1/contacts?${new URLSearchParams({ page: String(state.page), size: String(PAGE_SIZE) })}`);
        batch.contacts.push(...mapLexwareContacts(page.content ?? [], conn));
        if (isLast(page, state.page)) break;
        state.page += 1;
      }
      state.phase = 'invoices';
      state.page = 0;
    }
    for (;;) {
      const page = await get(
        `/v1/voucherlist?${new URLSearchParams({ voucherType: 'invoice', voucherStatus: VOUCHER_STATUS, voucherDateFrom: IMPORT_SINCE, sort: 'voucherDate,ASC', size: String(PAGE_SIZE), page: String(state.page) })}`,
      );
      for (const entry of (page.content ?? []) as Obj[]) {
        if (entry.voucherStatus === 'draft' || !entry.id) continue;
        if (entry.updatedDate && ctx.known.has(entry.id) && ctx.known.get(entry.id) === entry.updatedDate) continue;
        const detail = await get(`/v1/invoices/${encodeURIComponent(entry.id)}`);
        // Die Voucherlist ist maßgeblich für Status, Fälligkeit und Restbetrag (und die Änderungsmarke).
        const merged = { ...detail };
        for (const k of ['voucherStatus', 'dueDate', 'openAmount', 'updatedDate']) if (entry[k] !== undefined && entry[k] !== null) merged[k] = entry[k];
        batch.invoices.push(mapLexwareInvoice(merged, conn));
      }
      if (isLast(page, state.page)) break;
      state.page += 1;
    }
    complete = true;
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
  }
  return { batch, cursor: complete ? null : JSON.stringify(state), complete };
}
