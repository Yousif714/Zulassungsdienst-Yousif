import { describe, expect, test } from 'vitest';

import { berlinLocalToUtc } from '@/domain/clock';
import { fixtureFetch, type FixtureRequest } from '@/server/connectors/fixture-fetch';
import { createStripeWriter, PLAN_PRODUCT_NAME, scheduleIdempotencyKey, scheduleParams } from '@/server/connectors/stripe-write';
import { stripeWriteRoutes } from '../../fixtures/stripe-write';

const unix = (iso: string, t = '07:00') => Math.floor(berlinLocalToUtc(iso, t).getTime() / 1000);
const base = { customerId: 'cus_test_1', paymentMethodId: 'pm_test_1', productId: 'prod_test_1', contractId: 'c1', takeoverId: 'tk1' };
const meta = { contractId: 'c1', takeoverId: 'tk1' };
const price = (amount: number) => [{ price_data: { currency: 'eur', product: 'prod_test_1', unit_amount: amount, recurring: { interval: 'month' } }, quantity: 1 }];
const writer = (routes: Record<string, unknown> = stripeWriteRoutes, requests: FixtureRequest[] = [], status: Record<string, number> = {}) =>
  createStripeWriter({ key: 'sk_test_SECRET', fetch: fixtureFetch(routes, { requests, status }), sleep: async () => {}, now: () => 0 });

describe('scheduleParams', () => {
  test('Start 07:00 Berlin, Phasen mit Metadaten, cancel am Ende', () => {
    const p = scheduleParams({ ...base, phases: [{ start: '2026-12-01', end: { months: 1 }, amountCents: 45000 }, { start: '2027-01-01', end: { months: 2 }, amountCents: 30000 }] });
    expect(p).toMatchObject({ customer: 'cus_test_1', start_date: Date.parse('2026-12-01T06:00:00Z') / 1000, end_behavior: 'cancel',
      default_settings: { collection_method: 'charge_automatically', default_payment_method: 'pm_test_1' }, metadata: meta });
    expect(p.phases).toEqual([
      { items: price(45000), duration: { interval: 'month', interval_count: 1 }, billing_cycle_anchor: 'phase_start', proration_behavior: 'none', metadata: meta },
      { items: price(30000), duration: { interval: 'month', interval_count: 2 }, billing_cycle_anchor: 'phase_start', proration_behavior: 'none', metadata: meta },
    ]);
  });
  test('Lücken-Phase trial ohne billing_cycle_anchor, end_date als Unix 07:00', () => {
    const p = scheduleParams({ ...base, phases: [
      { start: '2026-12-01', end: { date: '2027-01-15' }, amountCents: 45000 },
      { start: '2027-01-15', end: { date: '2027-03-01' }, amountCents: 0, trial: true },
    ] });
    expect(p.phases).toEqual([
      { items: price(45000), end_date: unix('2027-01-15'), billing_cycle_anchor: 'phase_start', proration_behavior: 'none', metadata: meta },
      { items: price(0), end_date: unix('2027-03-01'), trial: true, proration_behavior: 'none', metadata: meta },
    ]);
    expect(unix('2027-01-15')).toBe(Date.parse('2027-01-15T06:00:00Z') / 1000);
  });
  test('überfällige Rate → start_date now', () => {
    const p = scheduleParams({ ...base, phases: [{ start: 'now', end: { date: '2026-12-01' }, amountCents: 90000 }, { start: '2026-12-01', end: { months: 1 }, amountCents: 45000 }] });
    expect(p.start_date).toBe('now');
    expect((p.phases as { end_date?: number }[])[0].end_date).toBe(unix('2026-12-01'));
  });
});

describe('createStripeWriter', () => {
  test('findOrCreateCustomer findet vorhandenen Kunden über contractId', async () => {
    const requests: FixtureRequest[] = [];
    const id = await writer({ ...stripeWriteRoutes, 'GET /v1/customers/search': { data: [{ id: 'cus_test_9' }] } }, requests)
      .findOrCreateCustomer({ contractId: 'c1', name: 'Erika Muster', email: 'erika@example.de' }, 'k');
    expect(id).toBe('cus_test_9');
    expect(requests.map((r) => r.method)).toEqual(['GET']);
    expect(decodeURIComponent(requests[0].path)).toContain("metadata['contractId']:'c1'");
  });
  test('findOrCreateCustomer legt an mit Idempotency-Key', async () => {
    const requests: FixtureRequest[] = [];
    const id = await writer(undefined, requests).findOrCreateCustomer({ contractId: 'c1', name: 'Erika Muster', email: null }, 'stripe-takeover-c1-1:1:customer');
    expect(id).toBe('cus_test_1');
    expect(requests[1]).toMatchObject({ method: 'POST', path: '/v1/customers', idempotencyKey: 'stripe-takeover-c1-1:1:customer' });
    expect(decodeURIComponent(requests[1].body)).toBe('name=Erika Muster&metadata[contractId]=c1');
  });
  test('createSetupCheckout: mode setup, card + sepa_debit, Danke-/Abbruch-URL', async () => {
    const requests: FixtureRequest[] = [];
    const r = await writer(undefined, requests).createSetupCheckout({ customerId: 'cus_test_1', takeoverId: 'tk1', contractId: 'c1', token: 'tok123', base: 'https://nexus.example' });
    expect(r).toEqual({ id: 'cs_test_1', url: 'https://checkout.stripe.test/c/pay/cs_test_1' });
    const body = decodeURIComponent(requests[0].body);
    expect(body).toContain('mode=setup');
    expect(body).toContain('payment_method_types[0]=card&payment_method_types[1]=sepa_debit');
    expect(body).toContain('success_url=https://nexus.example/zahlung/danke');
    expect(body).toContain('cancel_url=https://nexus.example/zahlung/abbruch?t=tok123');
    expect(body).toContain('setup_intent_data[metadata][takeoverId]=tk1');
    expect(requests[0].idempotencyKey).toBeNull();
  });
  test('ensurePlanProduct legt Produkt nur an, wenn die Suche nichts findet', async () => {
    const found: FixtureRequest[] = [];
    expect(await writer({ ...stripeWriteRoutes, 'GET /v1/products/search': { data: [{ id: 'prod_test_7' }] } }, found).ensurePlanProduct()).toBe('prod_test_7');
    expect(found.map((r) => r.method)).toEqual(['GET']);
    const created: FixtureRequest[] = [];
    expect(await writer(undefined, created).ensurePlanProduct()).toBe('prod_test_1');
    expect(created[1]).toMatchObject({ method: 'POST', path: '/v1/products', idempotencyKey: 'nexus-ratenplan-product-v1' });
    expect(decodeURIComponent(created[1].body)).toBe(`name=${PLAN_PRODUCT_NAME}&metadata[nexus]=ratenplan`);
  });
  test('setupIntentPaymentMethod, setDefaultPaymentMethod, createSchedule', async () => {
    const requests: FixtureRequest[] = [];
    const w = writer(undefined, requests);
    expect(await w.setupIntentPaymentMethod('seti_test_1')).toBe('pm_test_1');
    await w.setDefaultPaymentMethod('cus_test_1', 'pm_test_1');
    expect(decodeURIComponent(requests[1].body)).toBe('invoice_settings[default_payment_method]=pm_test_1');
    const id = await w.createSchedule({ ...base, phases: [{ start: 'now', end: { months: 3 }, amountCents: 45000 }] }, 'takeover:tk1:schedule');
    expect(id).toBe('sub_sched_test_1');
    expect(requests[2]).toMatchObject({ path: '/v1/subscription_schedules', idempotencyKey: 'takeover:tk1:schedule' });
    expect(decodeURIComponent(requests[2].body)).toContain('start_date=now&end_behavior=cancel');
  });
  test('Basis-URL mit Schrägstrich am Ende → nie //zahlung, Token in cancel_url kodiert', async () => {
    const requests: FixtureRequest[] = [];
    await writer(undefined, requests).createSetupCheckout({ customerId: 'cus_test_1', takeoverId: 'tk1', contractId: 'c1', token: 'a b&c=d', base: 'https://nexus.example//' });
    const body = new URLSearchParams(requests[0].body);
    expect(body.get('success_url')).toBe('https://nexus.example/zahlung/danke');
    expect(body.get('cancel_url')).toBe('https://nexus.example/zahlung/abbruch?t=a%20b%26c%3Dd');
  });
  test('findCustomer sucht nur, legt nie an', async () => {
    const none: FixtureRequest[] = [];
    expect(await writer(undefined, none).findCustomer('c1')).toBeNull();
    expect(none.map((r) => r.method)).toEqual(['GET']);
    expect(await writer({ ...stripeWriteRoutes, 'GET /v1/customers/search': { data: [{ id: 'cus_test_9' }] } }).findCustomer('c1')).toBe('cus_test_9');
  });
  test('findSchedule: Zeitplan des Kunden mit passender takeoverId', async () => {
    const requests: FixtureRequest[] = [];
    const routes = { ...stripeWriteRoutes, 'GET /v1/subscription_schedules': { data: [
      { id: 'sub_sched_other', status: 'active', metadata: { takeoverId: 'tk0' } },
      { id: 'sub_sched_test_1', status: 'active', metadata: { takeoverId: 'tk1', contractId: 'c1' } },
    ] } };
    expect(await writer(routes, requests).findSchedule('cus_test_1', 'tk1')).toBe('sub_sched_test_1');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'GET', path: '/v1/subscription_schedules?customer=cus_test_1&limit=100' });
    expect(await writer(routes).findSchedule('cus_test_1', 'tk9')).toBeNull();
    expect(await writer({ ...stripeWriteRoutes, 'GET /v1/subscription_schedules': { data: [] } }).findSchedule('cus_test_1', 'tk1')).toBeNull();
  });
  test.each(['canceled', 'released', 'completed'])('findSchedule übergeht Zeitpläne im Status %s', async (status) => {
    const routes = { ...stripeWriteRoutes, 'GET /v1/subscription_schedules': { data: [{ id: 'sub_sched_old', status, metadata: { takeoverId: 'tk1' } }] } };
    expect(await writer(routes).findSchedule('cus_test_1', 'tk1')).toBeNull();
  });
  test('findSchedule übernimmt not_started und active, erster Treffer nach beendeten', async () => {
    const routes = { ...stripeWriteRoutes, 'GET /v1/subscription_schedules': { data: [
      { id: 'sub_sched_old', status: 'canceled', metadata: { takeoverId: 'tk1' } },
      { id: 'sub_sched_test_1', status: 'not_started', metadata: { takeoverId: 'tk1' } },
    ] } };
    expect(await writer(routes).findSchedule('cus_test_1', 'tk1')).toBe('sub_sched_test_1');
  });
  test('findSchedule blättert über mehr als 100 Zeitpläne (starting_after, has_more)', async () => {
    const requests: FixtureRequest[] = [];
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `sub_sched_x${i}`, status: 'active', metadata: { takeoverId: `tk-x${i}` } }));
    const routes = {
      ...stripeWriteRoutes,
      'GET /v1/subscription_schedules?customer=cus_test_1&limit=100': { data: page1, has_more: true },
      'GET /v1/subscription_schedules?customer=cus_test_1&limit=100&starting_after=sub_sched_x99': { data: [
        { id: 'sub_sched_test_1', status: 'active', metadata: { takeoverId: 'tk1' } },
      ], has_more: false },
    };
    expect(await writer(routes, requests).findSchedule('cus_test_1', 'tk1')).toBe('sub_sched_test_1');
    expect(requests.map((r) => r.path)).toEqual([
      '/v1/subscription_schedules?customer=cus_test_1&limit=100',
      '/v1/subscription_schedules?customer=cus_test_1&limit=100&starting_after=sub_sched_x99',
    ]);
    // Ohne Treffer: endet nach der letzten Seite.
    const none: FixtureRequest[] = [];
    expect(await writer(routes, none).findSchedule('cus_test_1', 'tk9')).toBeNull();
    expect(none).toHaveLength(2);
  });
  test('cancelSchedule: ohne Rechnung und Anteilsberechnung, ohne Idempotency-Key (Stripe cached sonst auch 500 bis zu 24 h)', async () => {
    const requests: FixtureRequest[] = [];
    await writer(undefined, requests).cancelSchedule('sub_sched_test_1');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', path: '/v1/subscription_schedules/sub_sched_test_1/cancel', idempotencyKey: null });
    expect(Object.fromEntries(new URLSearchParams(requests[0].body))).toEqual({ invoice_now: 'false', prorate: 'false' });
  });
  test('cancelSchedule: zweiter Versuch nach 500 geht ohne Key wirklich an Stripe', async () => {
    const requests: FixtureRequest[] = [];
    const status: Record<string, number> = { 'POST /v1/subscription_schedules/sub_sched_test_1/cancel': 500 };
    const w = writer(undefined, requests, status);
    await expect(w.cancelSchedule('sub_sched_test_1')).rejects.toThrow('HTTP 500');
    delete status['POST /v1/subscription_schedules/sub_sched_test_1/cancel'];
    await w.cancelSchedule('sub_sched_test_1');
    expect(requests.map((r) => r.idempotencyKey)).toEqual([null, null]);
  });
  test.each([
    ['schon storniert → Erfolg', 'canceled', true],
    ['abgeschlossen → Erfolg', 'completed', true],
    ['noch offen → Fehler', 'active', false],
  ])('cancelSchedule 400: %s', async (_n, st, ok) => {
    const routes = { ...stripeWriteRoutes, 'GET /v1/subscription_schedules/sub_sched_test_1': { id: 'sub_sched_test_1', status: st } };
    const p = writer(routes, [], { 'POST /v1/subscription_schedules/sub_sched_test_1/cancel': 400 }).cancelSchedule('sub_sched_test_1');
    if (ok) await expect(p).resolves.toBeUndefined();
    else await expect(p).rejects.toThrow('HTTP 400');
  });
  test('Idempotency-Key des Zeitplans hängt nur an der Umstellung', () => {
    expect(scheduleIdempotencyKey('stripe-takeover-c1-1')).toBe('takeover:stripe-takeover-c1-1:schedule');
  });
  test('Fehlermeldung enthält den Schlüssel nie', async () => {
    const err = await writer(undefined, [], { 'POST /v1/customers': 401 }).findOrCreateCustomer({ contractId: 'c1', name: 'x', email: null }, 'k').catch((e: Error) => e) as Error;
    expect(err.message).toBe('Stripe: HTTP 401 bei /v1/customers (Schlüssel prüfen)');
    expect(err.message).not.toContain('SECRET');
  });
});
