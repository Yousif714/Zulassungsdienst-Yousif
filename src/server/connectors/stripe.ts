import 'server-only';

import { IMPORT_SINCE } from '@/domain/import/batch';
import { mapStripe, STRIPE_API_VERSION, type StripeRaw } from '@/domain/import/stripe';

import { createApiClient } from './http';
import { BudgetExceeded, type PullContext, type PullResult } from './types';

export { STRIPE_API_VERSION };

type Phase = 'invoices' | 'refunds' | 'disputes';
interface Cursor { createdGte: number; phase: Phase; startingAfter: string | null }
/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

const PHASES: Phase[] = ['invoices', 'refunds', 'disputes'];
const OVERLAP_SEC = 35 * 86400;
/** Berlin-Mitternacht von IMPORT_SINCE (Sommerzeit) als sichere Untergrenze in Unix-Sekunden. */
const sinceSec = (): number => Date.parse(`${IMPORT_SINCE}T00:00:00Z`) / 1000 - 7200;

function parseCursor(raw: string | null): Cursor {
  if (raw) {
    try {
      const c = JSON.parse(raw) as Cursor;
      if (Number.isFinite(c.createdGte) && PHASES.includes(c.phase)) return { createdGte: c.createdGte, phase: c.phase, startingAfter: c.startingAfter ?? null };
    } catch { /* ungültiger Cursor → Neustart */ }
  }
  return { createdGte: sinceSec(), phase: 'invoices', startingAfter: null };
}

const query = (params: [string, string][], startingAfter: string | null): string =>
  `?${new URLSearchParams([...params, ['limit', '100'], ...(startingAfter ? [['starting_after', startingAfter] as [string, string]] : [])]).toString()}`;
const idOf = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof (v as Obj).id === 'string' ? (v as Obj).id : null);

export async function pullStripe(cursor: string | null, ctx: PullContext): Promise<PullResult> {
  const api = createApiClient({
    label: 'Stripe', baseUrl: 'https://api.stripe.com', key: ctx.key, fetch: ctx.fetch, sleep: ctx.sleep, now: ctx.now, minIntervalMs: 0,
    headers: { 'Stripe-Version': STRIPE_API_VERSION },
  });
  const get = async (pathAndQuery: string): Promise<Obj> => {
    if (ctx.now() >= ctx.deadline) throw new BudgetExceeded();
    return (await api.getJson(pathAndQuery)) as Obj;
  };

  const cur = parseCursor(cursor);
  const raw = { subscriptions: [], products: [], invoices: [], refunds: [], disputes: [] } as {
    subscriptions: unknown[]; products: unknown[]; invoices: Obj[]; refunds: Obj[]; disputes: Obj[];
  };

  /** Alle Seiten einer Liste, ohne Fortsetzungspunkt (Abos, Produkte: wenige). */
  const readAll = async (path: string, params: [string, string][], into: unknown[]): Promise<void> => {
    const items: unknown[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await get(`${path}${query(params, after)}`);
      items.push(...(page.data ?? []));
      after = page.has_more && page.data?.length ? page.data[page.data.length - 1].id : null;
      if (!after) break;
    }
    into.push(...items);
  };

  /** Rechnung zu einer Erstattung/einem Streitfall: Charge → PaymentIntent → Rechnungszahlung (API-Version clover). */
  const invoiceIdOf = async (x: Obj): Promise<string | null> => {
    if (x.invoiceId !== undefined) return x.invoiceId; // bereits aufgelöst (Test-Fixtures)
    let pi = idOf(x.payment_intent);
    if (!pi && x.charge) {
      const charge = await get(`/v1/charges/${encodeURIComponent(idOf(x.charge)!)}`);
      if (idOf(charge.invoice)) return idOf(charge.invoice); // ältere API-Versionen
      pi = idOf(charge.payment_intent);
    }
    if (!pi) return null;
    const res = await get(`/v1/invoice_payments?${new URLSearchParams({ 'payment[type]': 'payment_intent', 'payment[payment_intent]': pi, limit: '1' })}`);
    return idOf(res.data?.[0]?.invoice);
  };

  let complete = false;
  const state: Cursor = { ...cur };
  try {
    if (cur.phase === 'invoices' && cur.startingAfter === null) {
      await readAll('/v1/subscriptions', [['status', 'all'], ['expand[]', 'data.customer'], ['expand[]', 'data.schedule']], raw.subscriptions);
      await readAll('/v1/products', [], raw.products);
    }
    for (const phase of PHASES.slice(PHASES.indexOf(cur.phase))) {
      state.phase = phase;
      const base: [string, string][] = [['created[gte]', String(cur.createdGte)]];
      for (;;) {
        const path = phase === 'invoices' ? '/v1/invoices' : `/v1/${phase}`;
        const page = await get(`${path}${query(phase === 'invoices' ? [['status', 'paid'], ...base] : base, state.startingAfter)}`);
        const data: Obj[] = page.data ?? [];
        if (phase === 'invoices') {
          raw.invoices.push(...data);
        } else {
          // Erst die ganze Seite auflösen; bei Budgetende wird die Seite verworfen und später neu geholt.
          const resolved: Obj[] = [];
          const extra: Obj[] = [];
          for (const x of data) {
            const invoiceId = await invoiceIdOf(x);
            resolved.push({ ...x, invoiceId });
            const have = [...raw.invoices, ...extra].some((i) => i.id === invoiceId);
            if (phase === 'refunds' && invoiceId && !have) extra.push(await get(`/v1/invoices/${encodeURIComponent(invoiceId)}`));
          }
          raw.invoices.push(...extra);
          raw[phase].push(...resolved);
        }
        if (page.has_more && data.length) state.startingAfter = data[data.length - 1].id;
        else { state.startingAfter = null; break; }
      }
    }
    complete = true;
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
  }

  const batch = mapStripe(raw as unknown as StripeRaw);
  if (complete) {
    // Wasserzeichen steigt erst jetzt; 35 Tage Überlappung fangen Nachzügler, Schlüssel machen sie unschädlich.
    const next: Cursor = { createdGte: Math.max(cur.createdGte, Math.floor(ctx.now() / 1000) - OVERLAP_SEC), phase: 'invoices', startingAfter: null };
    return { batch, cursor: JSON.stringify(next), complete: true };
  }
  return { batch, cursor: JSON.stringify(state), complete: false };
}
