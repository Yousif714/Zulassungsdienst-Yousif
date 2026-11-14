import 'server-only';

import { STRIPE_API_VERSION } from '@/domain/import/stripe';
import { phaseStartUnix, type TakeoverPhase } from '@/domain/takeover/plan';

import { encodeForm, type FormValue } from './form';
import { createApiClient } from './http';
import { ConnectorError } from './types';

export const PLAN_PRODUCT_NAME = 'NEXUS-Mitgliedschaft (Ratenplan)';
const PRODUCT_IDEMPOTENCY_KEY = 'nexus-ratenplan-product-v1';

export interface ScheduleInput { customerId: string; paymentMethodId: string; productId: string; phases: TakeoverPhase[]; contractId: string; takeoverId: string }

/** Ein Zeitplan je Umstellung: Provider (Neu-Freigabe) und Webhook nutzen denselben Key, nie die Aktionsversion. */
export const scheduleIdempotencyKey = (takeoverId: string): string => `takeover:${takeoverId}:schedule`;

/** Basis-URL ohne abschließende Schrägstriche (nie `//zahlung`). */
export const trimBase = (base: string): string => base.replace(/\/+$/, '');

export interface StripeWriter {
  /** Nur suchen, nie anlegen (Prüfen bei unklarem Ausgang). */
  findCustomer(contractId: string): Promise<string | null>;
  /** Zeitplan des Kunden mit `metadata.takeoverId`, sonst null. */
  findSchedule(customerId: string, takeoverId: string): Promise<string | null>;
  findOrCreateCustomer(i: { contractId: string; name: string; email: string | null }, idemKey: string): Promise<string>;
  createSetupCheckout(i: { customerId: string; takeoverId: string; contractId: string; token: string; base: string }): Promise<{ id: string; url: string }>;
  setupIntentPaymentMethod(setupIntentId: string): Promise<string>;
  setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;
  ensurePlanProduct(): Promise<string>;
  createSchedule(i: ScheduleInput, idemKey: string): Promise<string>;
}

/**
 * Zeitplan-Parameter (Clover: kein `iterations`, nur `duration` oder `end_date`).
 * Metadaten an Zeitplan UND jeder Phase: nur Phasen-Metadaten gehen ans Abo über.
 * `billing_cycle_anchor=phase_start` nur bei Nicht-Trial-Phasen (Lücken-Phasen buchen nichts ab).
 */
export function scheduleParams(i: ScheduleInput): Record<string, FormValue> {
  const metadata = { contractId: i.contractId, takeoverId: i.takeoverId };
  return {
    customer: i.customerId,
    start_date: phaseStartUnix(i.phases[0].start),
    end_behavior: 'cancel',
    default_settings: { collection_method: 'charge_automatically', default_payment_method: i.paymentMethodId },
    metadata,
    phases: i.phases.map((p) => ({
      items: [{ price_data: { currency: 'eur', product: i.productId, unit_amount: p.amountCents, recurring: { interval: 'month' } }, quantity: 1 }],
      ...('date' in p.end
        ? { end_date: phaseStartUnix(p.end.date) }
        : { duration: { interval: 'month', interval_count: p.end.months } }),
      ...(p.trial ? { trial: true } : { billing_cycle_anchor: 'phase_start' }),
      proration_behavior: 'none',
      metadata,
    })),
  };
}

export function createStripeWriter(o: { key: string; fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number }): StripeWriter {
  const api = createApiClient({
    label: 'Stripe', baseUrl: 'https://api.stripe.com', key: o.key, fetch: o.fetch, sleep: o.sleep, now: o.now, minIntervalMs: 0,
    headers: { 'Stripe-Version': STRIPE_API_VERSION },
  });
  type Obj = Record<string, unknown>;
  const post = async (path: string, body: Record<string, FormValue>, idem?: string): Promise<Obj> => (await api.postForm(path, encodeForm(body), idem)) as Obj;
  const search = async (path: string, query: string): Promise<Obj | null> => {
    const r = (await api.getJson(`${path}?${new URLSearchParams({ query }).toString()}`)) as { data?: Obj[] };
    return r.data?.[0] ?? null;
  };
  const need = (v: unknown, what: string): string => {
    if (typeof v !== 'string' || !v) throw new ConnectorError(`Stripe: ${what} fehlt in der Antwort`);
    return v;
  };

  const findCustomer = async (contractId: string): Promise<string | null> => {
    const found = await search('/v1/customers/search', `metadata['contractId']:'${contractId.replace(/['\\]/g, '')}'`);
    return found ? need(found.id, 'Kunden-ID') : null;
  };

  return {
    findCustomer,
    async findSchedule(customerId, takeoverId) {
      const r = (await api.getJson(`/v1/subscription_schedules?${new URLSearchParams({ customer: customerId, limit: '100' }).toString()}`)) as { data?: Obj[] };
      const hit = (r.data ?? []).find((x) => (x.metadata as Record<string, unknown> | undefined)?.takeoverId === takeoverId);
      return hit ? need(hit.id, 'Zeitplan-ID') : null;
    },
    async findOrCreateCustomer(i, idemKey) {
      const found = await findCustomer(i.contractId);
      if (found) return found;
      const c = await post('/v1/customers', { name: i.name, email: i.email, metadata: { contractId: i.contractId } }, idemKey);
      return need(c.id, 'Kunden-ID');
    },
    async createSetupCheckout(i) {
      const s = await post('/v1/checkout/sessions', {
        mode: 'setup', customer: i.customerId, payment_method_types: ['card', 'sepa_debit'], locale: 'de',
        success_url: `${trimBase(i.base)}/zahlung/danke`, cancel_url: `${trimBase(i.base)}/zahlung/abbruch?t=${encodeURIComponent(i.token)}`,
        metadata: { takeoverId: i.takeoverId, contractId: i.contractId },
        setup_intent_data: { metadata: { takeoverId: i.takeoverId } },
      });
      return { id: need(s.id, 'Sitzungs-ID'), url: need(s.url, 'Sitzungs-URL') };
    },
    async setupIntentPaymentMethod(setupIntentId) {
      const si = (await api.getJson(`/v1/setup_intents/${encodeURIComponent(setupIntentId)}`)) as Obj;
      const pm = si.payment_method;
      return need(typeof pm === 'object' && pm ? (pm as Obj).id : pm, 'Zahlungsmittel');
    },
    async setDefaultPaymentMethod(customerId, paymentMethodId) {
      await post(`/v1/customers/${encodeURIComponent(customerId)}`, { invoice_settings: { default_payment_method: paymentMethodId } });
    },
    async ensurePlanProduct() {
      const found = await search('/v1/products/search', "metadata['nexus']:'ratenplan' AND active:'true'");
      if (found) return need(found.id, 'Produkt-ID');
      const p = await post('/v1/products', { name: PLAN_PRODUCT_NAME, metadata: { nexus: 'ratenplan' } }, PRODUCT_IDEMPOTENCY_KEY);
      return need(p.id, 'Produkt-ID');
    },
    async createSchedule(i, idemKey) {
      const s = await post('/v1/subscription_schedules', scheduleParams(i), idemKey);
      return need(s.id, 'Zeitplan-ID');
    },
  };
}
