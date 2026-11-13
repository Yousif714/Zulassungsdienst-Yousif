import 'server-only';

import { cursorOutdated, emptyBatch, IMPORT_SINCE, type ImportBatch } from '@/domain/import/batch';
import { mapLexwareContacts, mapLexwareInvoice, mapLexwareOrderConfirmation, type LexwareConnection } from '@/domain/import/lexware';

import { createApiClient } from './http';
import { BudgetExceeded, ConnectorError, type PullContext, type PullResult } from './types';

type Phase = 'contacts' | 'invoices' | 'orderconfirmations';
interface Cursor { phase: Phase; page: number; since: string }
/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

const PHASES: Phase[] = ['contacts', 'invoices', 'orderconfirmations'];
const PAGE_SIZE = 100;
const MIN_INTERVAL_MS = 500; // höchstens 2 Anfragen pro Sekunde
// `any` gilt für jeden Belegtyp; eine Statusliste mit typfremden Werten (z. B. `paidoff`) lehnt Lexware mit 400 ab.
// Entwürfe filtert die Schleife unten.
const VOUCHER_STATUS = 'any';

type VoucherType = 'invoice' | 'orderconfirmation';
export const lexwareVoucherlistQuery = (page: number, voucherType: VoucherType = 'invoice'): string =>
  new URLSearchParams({ voucherType, voucherStatus: VOUCHER_STATUS, voucherDateFrom: IMPORT_SINCE, sort: 'voucherDate,ASC', size: String(PAGE_SIZE), page: String(page) }).toString();

function parseCursor(raw: string | null): Cursor {
  if (raw) {
    try {
      const c = JSON.parse(raw) as Cursor;
      if (!cursorOutdated(c.since) && PHASES.includes(c.phase) && Number.isInteger(c.page) && c.page >= 0) return { phase: c.phase, page: c.page, since: IMPORT_SINCE };
    } catch { /* ungültiger Cursor → Neustart */ }
  }
  return { phase: 'contacts', page: 0, since: IMPORT_SINCE };
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

  /**
   * Belegliste eines Typs seitenweise ab `state.page`; Details nur für Neues/Geändertes.
   * Die Voucherlist ist maßgeblich für die Felder in `fromList` (u. a. Status und Änderungsmarke).
   */
  const vouchers = async (type: VoucherType, detailPath: string, fromList: string[], take: (merged: Obj) => void): Promise<void> => {
    for (;;) {
      const page = await get(`/v1/voucherlist?${lexwareVoucherlistQuery(state.page, type)}`);
      for (const entry of (page.content ?? []) as Obj[]) {
        if (entry.voucherStatus === 'draft' || !entry.id) continue;
        if (entry.updatedDate && ctx.known.has(entry.id) && ctx.known.get(entry.id) === entry.updatedDate) continue;
        const merged = { ...(await get(`${detailPath}/${encodeURIComponent(entry.id)}`)) };
        for (const k of fromList) if (entry[k] !== undefined && entry[k] !== null) merged[k] = entry[k];
        take(merged);
      }
      if (isLast(page, state.page)) break;
      state.page += 1;
    }
  };
  const next = (phase: Phase) => { state.phase = phase; state.page = 0; };

  let complete = false;
  let warning: string | undefined;
  try {
    if (state.phase === 'contacts') {
      for (;;) {
        const page = await get(`/v1/contacts?${new URLSearchParams({ page: String(state.page), size: String(PAGE_SIZE) })}`);
        batch.contacts.push(...mapLexwareContacts(page.content ?? [], conn));
        if (isLast(page, state.page)) break;
        state.page += 1;
      }
      next('invoices');
    }
    if (state.phase === 'invoices') {
      await vouchers('invoice', '/v1/invoices', ['voucherStatus', 'dueDate', 'openAmount', 'updatedDate'], (d) => batch.invoices.push(mapLexwareInvoice(d, conn)));
      next('orderconfirmations');
    }
    // Auftragsbestätigungen (NEXUS und Zulassung): keine Forderungen, nur Quelle für Vorschläge und Portal-Hinweise.
    // Lehnt Lexware die ABs ab (Recht, Typ, Feld), bleiben die Rechnungen gültig: Hinweis statt Fehler für den ganzen Abgleich.
    try {
      await vouchers('orderconfirmation', '/v1/order-confirmations', ['voucherStatus', 'updatedDate'], (d) => batch.orderConfirmations.push(mapLexwareOrderConfirmation(d, conn)));
    } catch (e) {
      if (!(e instanceof ConnectorError)) throw e;
      batch.orderConfirmations.length = 0;
      warning = `Auftragsbestätigungen: ${e.message}`;
    }
    complete = true;
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
  }
  return { batch, cursor: complete ? null : JSON.stringify(state), complete, ...(warning ? { warning } : {}) };
}
