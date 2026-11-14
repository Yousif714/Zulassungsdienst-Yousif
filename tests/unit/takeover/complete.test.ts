import { describe, expect, test } from 'vitest';
import { DemoProvider } from '@/domain/actions/demo-provider';
import { berlinLocalToUtc } from '@/domain/clock';
import type { AppState } from '@/domain/types';
import { createActionProvider } from '@/server/action-provider';
import { fixtureFetch, type FixtureRequest } from '@/server/connectors/fixture-fetch';
import { createStripeWriter, type StripeWriter } from '@/server/connectors/stripe-write';
import { createMemoryRepos } from '@/server/db/memory';
import type { Repos } from '@/server/db/repository';
import { dispatchEvents, loadState } from '@/server/state-service';
import { completeTakeoverCheckout, createCheckoutForToken } from '@/server/takeover';
import { stripeWriteRoutes } from '../../fixtures/stripe-write';
import { tx } from '../helpers';
import { applyAt, executeEvents, linkSentState, seed, T0, TAKEOVER_ID } from './setup';

const unix = (iso: string) => Math.floor(berlinLocalToUtc(iso, '07:00').getTime() / 1000);
const KEY = `takeover:${TAKEOVER_ID}:schedule`;
const session = (p: Partial<{ mode: string; setup_intent: string | null; customer: string | null; metadata: Record<string, string> }> = {}) =>
  ({ id: 'cs_test_1', mode: 'setup', setup_intent: 'seti_test_1', customer: 'cus_test_1', metadata: { takeoverId: TAKEOVER_ID, contractId: 'c1' }, ...p });

async function setup(state: AppState = linkSentState(), o: { routes?: Record<string, unknown>; status?: Record<string, number> } = {}) {
  const repos = createMemoryRepos();
  await seed(repos, state);
  const requests: FixtureRequest[] = [];
  const status = o.status ?? {};
  const writer = createStripeWriter({ key: 'sk_test_SECRET', fetch: fixtureFetch(o.routes ?? stripeWriteRoutes, { requests, status }), sleep: async () => {}, now: () => 0 });
  return { repos, writer, requests, status };
}
const schedules = (r: FixtureRequest[]) => r.filter((x) => x.method === 'POST' && x.path === '/v1/subscription_schedules');
const deps = (at = T0) => ({ at, provider: new DemoProvider() });

/** Zusätzliche Überweisung nach dem Link → offene Summe weicht vom Plan ab. */
function transferredMeanwhile(): AppState {
  const s = linkSentState();
  const p = tx({ id: 'p-c1-2', externalId: 'x-p-c1-2', bookedOn: '2026-11-12', amountCents: 10000 });
  return { ...s, payments: [...s.payments, p], allocations: [...s.allocations, { paymentId: p.id, contractId: 'c1', amountCents: 10000, method: 'manual' }] };
}

describe('completeTakeoverCheckout', () => {
  test('gleicher Plan → Standard-Zahlungsmittel, Produkt, Zeitplan, eingerichtet', async () => {
    const { repos, writer, requests } = await setup();
    expect(await completeTakeoverCheckout(repos, writer, session(), deps())).toBe('set_up');
    const s = await loadState(repos, T0);
    expect(s.takeovers[0]).toMatchObject({ id: TAKEOVER_ID, status: 'set_up', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' });
    expect(s.contracts[0].billing).toBe('stripe');
    expect(s.audit[s.audit.length - 1]).toMatchObject({ actor: 'system', text: 'Umstellung eingerichtet: Erika Muster, 2 Raten (Zeitplan sub_sched_test_1)' });
    expect(requests.map((r) => `${r.method} ${r.path.split('?')[0]}`)).toEqual([
      'GET /v1/setup_intents/seti_test_1', 'POST /v1/customers/cus_test_1', 'GET /v1/products/search', 'POST /v1/products', 'GET /v1/subscription_schedules', 'POST /v1/subscription_schedules',
    ]);
    const sched = schedules(requests);
    expect(sched[0].idempotencyKey).toBe(KEY);
    const b = Object.fromEntries(new URLSearchParams(sched[0].body));
    expect(b).toMatchObject({
      customer: 'cus_test_1', start_date: String(unix('2026-12-01')), 'default_settings[default_payment_method]': 'pm_test_1',
      'metadata[takeoverId]': TAKEOVER_ID, 'metadata[contractId]': 'c1',
      'phases[0][items][0][price_data][unit_amount]': '45000', 'phases[0][duration][interval_count]': '1',
      'phases[1][items][0][price_data][unit_amount]': '30000', 'phases[1][duration][interval_count]': '1',
    });
  });

  test('zweiter Aufruf → ignoriert, Zeitplan genau einmal', async () => {
    const { repos, writer, requests } = await setup();
    await completeTakeoverCheckout(repos, writer, session(), deps());
    expect(await completeTakeoverCheckout(repos, writer, session(), deps())).toBe('ignored');
    expect(schedules(requests)).toHaveLength(1);
    expect((await loadState(repos, T0)).takeovers[0].status).toBe('set_up');
  });

  test('inzwischen überwiesen → Plan geändert, kein Zeitplan, Zahlungsmittel gespeichert', async () => {
    const { repos, writer, requests } = await setup(transferredMeanwhile());
    expect(await completeTakeoverCheckout(repos, writer, session(), deps())).toBe('plan_changed');
    const s = await loadState(repos, T0);
    expect(s.takeovers[0]).toMatchObject({ status: 'plan_changed', paymentMethodId: 'pm_test_1', scheduleId: null });
    expect(s.contracts[0].billing).toBe('legacy');
    expect(schedules(requests)).toHaveLength(0);
    expect(s.audit[s.audit.length - 1].text).toBe('Umstellung Erika Muster: Plan hat sich geändert, neu freigeben');
  });

  test('Link erst nach der ersten Fälligkeit genutzt, gleiche Summe → überfällige Rate sofort, Rest nach Plan', async () => {
    const at = new Date('2026-12-02T09:00:00Z');
    const { repos, writer, requests } = await setup();
    expect(await completeTakeoverCheckout(repos, writer, session(), deps(at))).toBe('set_up');
    const b = Object.fromEntries(new URLSearchParams(schedules(requests)[0].body));
    // 02.12.: 450 € sofort bis 16.12. (14 Tage), Lücke bis 01.01., dann 300 € einen Monat.
    expect(b).toMatchObject({
      start_date: 'now',
      'phases[0][items][0][price_data][unit_amount]': '45000', 'phases[0][end_date]': String(unix('2026-12-16')),
      'phases[1][trial]': 'true', 'phases[1][end_date]': String(unix('2027-01-01')),
      'phases[2][items][0][price_data][unit_amount]': '30000', 'phases[2][duration][interval_count]': '1',
    });
  });

  test('nach Zurückziehen → ignoriert, kein Stripe-Aufruf, Status bleibt', async () => {
    const { repos, writer, requests } = await setup(applyAt(linkSentState(), [{ type: 'withdrawTakeover', contractId: 'c1' }]));
    expect(await completeTakeoverCheckout(repos, writer, session(), deps())).toBe('ignored');
    expect(requests).toEqual([]);
    expect((await loadState(repos, T0)).takeovers[0].status).toBe('withdrawn');
  });

  test.each([
    ['anderer Modus', session({ mode: 'payment' })],
    ['ohne takeoverId', session({ metadata: {} })],
    ['unbekannte Umstellung', session({ metadata: { takeoverId: 'stripe-takeover-c9-1' } })],
    ['ohne setup_intent', session({ setup_intent: null })],
  ])('%s → ignoriert ohne Stripe-Aufruf', async (_n, sess) => {
    const { repos, writer, requests } = await setup();
    expect(await completeTakeoverCheckout(repos, writer, sess, deps())).toBe('ignored');
    expect(requests).toEqual([]);
    expect((await loadState(repos, T0)).takeovers[0].status).toBe('link_sent');
  });

  test.each([
    ['Stripe-Fehler', 500, 'Stripe: HTTP 500 bei /v1/subscription_schedules'],
    ['gleichzeitiger Aufruf mit gleichem Key (409)', 409, 'Stripe: HTTP 409 bei /v1/subscription_schedules'],
  ])('%s beim Zeitplan → wirft, Status bleibt link_sent; Wiederholung richtet ein', async (_n, code, msg) => {
    const { repos, writer, requests, status } = await setup(undefined, { status: { 'POST /v1/subscription_schedules': code } });
    await expect(completeTakeoverCheckout(repos, writer, session(), deps())).rejects.toThrow(msg);
    expect((await loadState(repos, T0)).takeovers[0].status).toBe('link_sent');
    delete status['POST /v1/subscription_schedules'];
    expect(await completeTakeoverCheckout(repos, writer, session(), deps())).toBe('set_up');
    expect(schedules(requests).map((r) => r.idempotencyKey)).toEqual([KEY, KEY]);
  });

  test('B2: Neu-Freigabe läuft in Zeitüberschreitung nach Zeitplan-Anlage → Prüfen findet Zeitplan, Webhook legt keinen zweiten an', async () => {
    // Umstellung 1 → Plan geändert (Zahlungsmittel hinterlegt) → Neu-Freigabe 2 → Ausgang unklar.
    const s0 = applyAt(transferredMeanwhile(), [
      { type: 'takeoverPlanChanged', takeoverId: TAKEOVER_ID, paymentMethodId: 'pm_test_1' },
      { type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' },
    ]);
    const second = 'stripe-takeover-c1-2';
    expect(s0.actions.find((a) => a.id === second)?.payload).toMatchObject({ stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1' });
    const uncertain = applyAt(s0, [...executeEvents(second, 1).slice(0, 2), { type: 'actionExecuted', id: second, result: 'timeout' }]);
    expect(uncertain.actions.find((a) => a.id === second)?.status).toBe('uncertain');
    const routes = { ...stripeWriteRoutes, 'GET /v1/subscription_schedules': { data: [{ id: 'sub_sched_test_1', status: 'active', metadata: { takeoverId: second } }] } };
    const { repos, writer, requests } = await setup(uncertain, { routes });
    const provider = createActionProvider({ writer, linkBase: 'https://nexus.example.de', now: () => T0 });
    await dispatchEvents(repos, [{ type: 'checkAction', id: second }], { at: () => T0, provider });
    const s1 = await loadState(repos, T0);
    expect(s1.takeovers.find((t) => t.id === second)).toMatchObject({ status: 'set_up', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' });
    expect(await completeTakeoverCheckout(repos, writer, session({ metadata: { takeoverId: second } }), { at: T0, provider })).toBe('ignored');
    expect(schedules(requests)).toHaveLength(0);
  });
});

describe('completeTakeoverCheckout: Schutz vor doppeltem oder verwaistem Zeitplan', () => {
  const withdraw = (repos: Repos) => dispatchEvents(repos, [{ type: 'withdrawTakeover', contractId: 'c1' }], { at: () => T0, provider: new DemoProvider() });
  const cancels = (r: FixtureRequest[]) => r.filter((x) => x.method === 'POST' && x.path.endsWith('/cancel'));

  test('Tageswechsel: Wiederholung am Folgetag übernimmt den schon angelegten Zeitplan, kein zweiter', async () => {
    const routes: Record<string, unknown> = { ...stripeWriteRoutes };
    const { repos, writer, requests, status } = await setup(undefined, { routes, status: { 'POST /v1/subscription_schedules': 500 } });
    // Zeitplan bei Stripe angelegt, Antwort verloren → 500, Stripe wiederholt am nächsten Tag.
    await expect(completeTakeoverCheckout(repos, writer, session(), deps())).rejects.toThrow('Stripe: HTTP 500');
    delete status['POST /v1/subscription_schedules'];
    routes['GET /v1/subscription_schedules'] = { data: [{ id: 'sub_sched_test_7', status: 'active', metadata: { takeoverId: TAKEOVER_ID } }] };
    const nextDay = new Date('2026-11-14T09:00:00Z');
    expect(await completeTakeoverCheckout(repos, writer, session(), deps(nextDay))).toBe('set_up');
    expect(schedules(requests)).toHaveLength(1); // nur der erste (verlorene) Versuch
    expect((await loadState(repos, nextDay)).takeovers[0]).toMatchObject({ status: 'set_up', scheduleId: 'sub_sched_test_7' });
  });

  test('Zurückziehen zwischen Laden und Anlegen → kein Zeitplan, ignoriert', async () => {
    const { repos, writer, requests } = await setup();
    const racing: StripeWriter = { ...writer, findSchedule: async (c, t) => { await withdraw(repos); return writer.findSchedule(c, t); } };
    expect(await completeTakeoverCheckout(repos, racing, session(), deps())).toBe('ignored');
    expect(schedules(requests)).toHaveLength(0);
    expect((await loadState(repos, T0)).takeovers[0].status).toBe('withdrawn');
  });

  test('Zurückziehen während der Zeitplan angelegt wird → Zeitplan storniert, Audit, ignoriert', async () => {
    const { repos, writer, requests } = await setup();
    const racing: StripeWriter = { ...writer, createSchedule: async (i, k) => { const id = await writer.createSchedule(i, k); await withdraw(repos); return id; } };
    expect(await completeTakeoverCheckout(repos, racing, session(), deps())).toBe('ignored');
    expect(schedules(requests)).toHaveLength(1);
    const c = cancels(requests);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ path: '/v1/subscription_schedules/sub_sched_test_1/cancel', idempotencyKey: `takeover:${TAKEOVER_ID}:schedule-cancel` });
    expect(Object.fromEntries(new URLSearchParams(c[0].body))).toEqual({ invoice_now: 'false', prorate: 'false' });
    const s = await loadState(repos, T0);
    expect(s.takeovers[0]).toMatchObject({ status: 'withdrawn', scheduleId: null });
    expect(s.audit[s.audit.length - 1]).toMatchObject({ actor: 'system', text: 'Zeitplan storniert: Umstellung inzwischen zurückgezogen (Erika Muster, Zeitplan sub_sched_test_1)' });
  });

  test('gleichzeitiger zweiter Lauf mit demselben Zeitplan → set_up, nichts storniert', async () => {
    const { repos, writer, requests } = await setup();
    const racing: StripeWriter = {
      ...writer,
      createSchedule: async (i, k) => {
        const id = await writer.createSchedule(i, k);
        await dispatchEvents(repos, [{ type: 'takeoverSetUp', takeoverId: TAKEOVER_ID, scheduleId: id, paymentMethodId: 'pm_test_1' }], { at: () => T0, provider: new DemoProvider() });
        return id;
      },
    };
    expect(await completeTakeoverCheckout(repos, racing, session(), deps())).toBe('set_up');
    expect(cancels(requests)).toHaveLength(0);
  });

  test('Umstellung hat schon einen anderen Zeitplan → eigener wird storniert, nicht set_up', async () => {
    const { repos, writer, requests } = await setup();
    const racing: StripeWriter = {
      ...writer,
      createSchedule: async (i, k) => {
        const id = await writer.createSchedule(i, k);
        await dispatchEvents(repos, [{ type: 'takeoverSetUp', takeoverId: TAKEOVER_ID, scheduleId: 'sub_sched_test_9', paymentMethodId: 'pm_test_1' }], { at: () => T0, provider: new DemoProvider() });
        return id;
      },
    };
    expect(await completeTakeoverCheckout(repos, racing, session(), deps())).toBe('ignored');
    expect(cancels(requests).map((r) => r.path)).toEqual(['/v1/subscription_schedules/sub_sched_test_1/cancel']);
    const s = await loadState(repos, T0);
    expect(s.takeovers[0]).toMatchObject({ status: 'set_up', scheduleId: 'sub_sched_test_9' });
    expect(s.audit[s.audit.length - 1].text).toBe('Zeitplan storniert: Umstellung nicht mehr offen (Erika Muster, Zeitplan sub_sched_test_1)');
  });

  test.each([
    ['fremder Kunde', 'cus_test_9'],
    ['ohne Kunde', null],
  ])('%s in der Checkout-Sitzung → ignoriert, kein Stripe-Aufruf, Audit', async (_n, customer) => {
    const { repos, writer, requests } = await setup();
    expect(await completeTakeoverCheckout(repos, writer, session({ customer }), deps())).toBe('ignored');
    expect(requests).toEqual([]);
    const s = await loadState(repos, T0);
    expect(s.takeovers[0].status).toBe('link_sent');
    expect(s.audit[s.audit.length - 1]).toMatchObject({ actor: 'system', text: `Umstellung Erika Muster: Checkout mit fremdem Stripe-Kunden (${customer ?? 'keiner'}) ignoriert` });
  });
});

describe('createCheckoutForToken', () => {
  const tokenOf = (s: AppState) => s.takeovers[0].token;

  test('gültiger Token → neue Checkout-Sitzung, Weiterleitung', async () => {
    const state = linkSentState();
    const { repos, writer, requests } = await setup(state);
    expect(await createCheckoutForToken(repos, writer, tokenOf(state), 'https://nexus.example.de/')).toEqual({ kind: 'redirect', url: 'https://checkout.stripe.test/c/pay/cs_test_1' });
    expect(requests).toHaveLength(1);
    const b = Object.fromEntries(new URLSearchParams(requests[0].body));
    expect(b).toMatchObject({
      mode: 'setup', customer: 'cus_test_1', 'metadata[takeoverId]': TAKEOVER_ID, 'metadata[contractId]': 'c1',
      success_url: 'https://nexus.example.de/zahlung/danke', cancel_url: `https://nexus.example.de/zahlung/abbruch?t=${tokenOf(state)}`,
    });
  });

  test.each([
    ['unbekannter Token', 'f'.repeat(64)],
    ['leerer Token', ''],
  ])('%s → ungültig, kein Stripe-Aufruf', async (_n, token) => {
    const { repos, writer, requests } = await setup();
    expect(await createCheckoutForToken(repos, writer, token, 'https://nexus.example.de')).toEqual({ kind: 'invalid' });
    expect(requests).toEqual([]);
  });

  test('zurückgezogen → ungültig', async () => {
    const state = applyAt(linkSentState(), [{ type: 'withdrawTakeover', contractId: 'c1' }]);
    const { repos, writer, requests } = await setup(state);
    expect(await createCheckoutForToken(repos, writer, tokenOf(state), 'https://nexus.example.de')).toEqual({ kind: 'invalid' });
    expect(requests).toEqual([]);
  });

  test('ohne Schreiber → Demo, kein Stripe-Aufruf', async () => {
    const state = linkSentState();
    const { repos } = await setup(state);
    expect(await createCheckoutForToken(repos, null, tokenOf(state), 'https://nexus.example.de')).toEqual({ kind: 'demo' });
  });

  test('Demo-Umstellung mit Schreiber → Demo', async () => {
    const s = linkSentState();
    const state = { ...s, takeovers: [{ ...s.takeovers[0], isDemo: true, token: `demo-${s.takeovers[0].token}` }] };
    const { repos, writer, requests } = await setup(state);
    expect(await createCheckoutForToken(repos, writer, tokenOf(state), 'https://nexus.example.de')).toEqual({ kind: 'demo' });
    expect(requests).toEqual([]);
  });
});
