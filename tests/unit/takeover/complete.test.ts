import { describe, expect, test } from 'vitest';
import { DemoProvider } from '@/domain/actions/demo-provider';
import { berlinLocalToUtc } from '@/domain/clock';
import type { AppState } from '@/domain/types';
import { createActionProvider } from '@/server/action-provider';
import { fixtureFetch, type FixtureRequest } from '@/server/connectors/fixture-fetch';
import { createStripeWriter } from '@/server/connectors/stripe-write';
import { createMemoryRepos } from '@/server/db/memory';
import { dispatchEvents, loadState } from '@/server/state-service';
import { completeTakeoverCheckout, createCheckoutForToken } from '@/server/takeover';
import { stripeWriteRoutes } from '../../fixtures/stripe-write';
import { tx } from '../helpers';
import { applyAt, executeEvents, linkSentState, seed, T0, TAKEOVER_ID } from './setup';

const unix = (iso: string) => Math.floor(berlinLocalToUtc(iso, '07:00').getTime() / 1000);
const KEY = `takeover:${TAKEOVER_ID}:schedule`;
const session = (p: Partial<{ mode: string; setup_intent: string | null; metadata: Record<string, string> }> = {}) =>
  ({ id: 'cs_test_1', mode: 'setup', setup_intent: 'seti_test_1', metadata: { takeoverId: TAKEOVER_ID, contractId: 'c1' }, ...p });

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
      'GET /v1/setup_intents/seti_test_1', 'POST /v1/customers/cus_test_1', 'GET /v1/products/search', 'POST /v1/products', 'POST /v1/subscription_schedules',
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
    const routes = { ...stripeWriteRoutes, 'GET /v1/subscription_schedules': { data: [{ id: 'sub_sched_test_1', metadata: { takeoverId: second } }] } };
    const { repos, writer, requests } = await setup(uncertain, { routes });
    const provider = createActionProvider({ writer, linkBase: 'https://nexus.example.de', now: () => T0 });
    await dispatchEvents(repos, [{ type: 'checkAction', id: second }], { at: () => T0, provider });
    const s1 = await loadState(repos, T0);
    expect(s1.takeovers.find((t) => t.id === second)).toMatchObject({ status: 'set_up', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' });
    expect(await completeTakeoverCheckout(repos, writer, session({ metadata: { takeoverId: second } }), { at: T0, provider })).toBe('ignored');
    expect(schedules(requests)).toHaveLength(0);
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
