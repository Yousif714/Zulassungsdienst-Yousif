import { beforeEach, describe, expect, test, vi } from 'vitest';
import { berlinLocalToUtc } from '@/domain/clock';
import { DemoProvider } from '@/domain/actions/demo-provider';
import type { Action } from '@/domain/types';
import { createActionProvider } from '@/server/action-provider';
import { fixtureFetch, type FixtureRequest } from '@/server/connectors/fixture-fetch';
import { createStripeWriter, type StripeWriter } from '@/server/connectors/stripe-write';
import { createMemoryRepos } from '@/server/db/memory';
import { getActionProvider, getStripeWriter, resetTestRepos, setTestStripeWriter } from '@/server/registry';
import { dispatchEvents, loadState } from '@/server/state-service';
import { stripeWriteRoutes } from '../fixtures/stripe-write';
import { paidState, seed, T0, TAKEOVER_ID } from './takeover/setup';

const LINK = 'https://nexus.example.de';
const unix = (iso: string) => Math.floor(berlinLocalToUtc(iso, '07:00').getTime() / 1000);
const RATES = [{ no: 1, dueDate: '2026-12-01', amountCents: 45000 }, { no: 2, dueDate: '2027-01-01', amountCents: 30000 }];

function takeover(p: Record<string, unknown> = {}): Action {
  return {
    id: TAKEOVER_ID, type: 'stripe_takeover', company: 'nexus', title: 'Umstellung auf Stripe: Erika Muster',
    payload: { contractId: 'c1', contactId: 'm1', name: 'Erika Muster', email: 'erika@example.de', mode: 'first_rate', rates: RATES, openCents: 75000, ...p },
    version: 1, status: 'executing', createdAt: T0.toISOString(), isDemo: false,
  };
}
const reminder: Action = { ...takeover(), id: 'reminder-c1-2026-10-01', type: 'send_reminder', payload: { text: 'Hallo' } };

function setup(o: { routes?: Record<string, unknown>; status?: Record<string, number>; now?: Date; linkBase?: string } = {}) {
  const requests: FixtureRequest[] = [];
  const writer = createStripeWriter({ key: 'sk_test_SECRET', fetch: fixtureFetch(o.routes ?? stripeWriteRoutes, { requests, status: o.status ?? {} }), sleep: async () => {}, now: () => 0 });
  const provider = createActionProvider({ writer, linkBase: o.linkBase ?? LINK, now: () => o.now ?? T0 });
  return { requests, writer, provider };
}
const posts = (r: FixtureRequest[], path: string) => r.filter((x) => x.method === 'POST' && x.path === path);

describe('createActionProvider: Ausführung', () => {
  test('Ausführung legt Kunden an und liefert output', async () => {
    const { provider, requests } = setup();
    expect(await provider.execute(takeover(), `${TAKEOVER_ID}:1`)).toEqual({ result: 'ok', output: { stripeCustomerId: 'cus_test_1', linkBase: LINK } });
    expect(posts(requests, '/v1/customers')).toHaveLength(1);
    expect(posts(requests, '/v1/customers')[0].idempotencyKey).toBe(`${TAKEOVER_ID}:1:customer`);
    expect(new URLSearchParams(posts(requests, '/v1/customers')[0].body).get('metadata[contractId]')).toBe('c1');
    expect(posts(requests, '/v1/subscription_schedules')).toHaveLength(0);
  });

  test('vorhandener Stripe-Kunde im payload → kein Kunden-Aufruf', async () => {
    const { provider, requests } = setup();
    expect(await provider.execute(takeover({ stripeCustomerId: 'cus_test_7' }), `${TAKEOVER_ID}:1`)).toEqual({ result: 'ok', output: { stripeCustomerId: 'cus_test_7', linkBase: LINK } });
    expect(requests).toEqual([]);
  });

  test('Basis-URL mit Schrägstrich am Ende wird normalisiert', async () => {
    const { provider } = setup({ linkBase: `${LINK}/` });
    expect(await provider.execute(takeover(), 'k')).toEqual({ result: 'ok', output: { stripeCustomerId: 'cus_test_1', linkBase: LINK } });
  });

  test('Neu-Freigabe mit hinterlegtem Zahlungsmittel legt sofort den Zeitplan an', async () => {
    const { provider, requests } = setup();
    const out = await provider.execute(takeover({ stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1' }), `${TAKEOVER_ID}:1`);
    expect(out).toEqual({ result: 'ok', output: { stripeCustomerId: 'cus_test_1', linkBase: LINK, scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' } });
    expect(new URLSearchParams(posts(requests, '/v1/customers/cus_test_1')[0].body).get('invoice_settings[default_payment_method]')).toBe('pm_test_1');
    const sched = posts(requests, '/v1/subscription_schedules');
    expect(sched).toHaveLength(1);
    expect(sched[0].idempotencyKey).toBe(`takeover:${TAKEOVER_ID}:schedule`);
    const b = new URLSearchParams(sched[0].body);
    expect(b.get('customer')).toBe('cus_test_1');
    expect(b.get('start_date')).toBe(String(unix('2026-12-01')));
    expect(b.get('metadata[takeoverId]')).toBe(TAKEOVER_ID);
    expect(b.get('phases[0][metadata][takeoverId]')).toBe(TAKEOVER_ID);
    expect(b.get('phases[0][items][0][price_data][product]')).toBe('prod_test_1');
    expect(b.get('phases[0][items][0][price_data][unit_amount]')).toBe('45000');
    expect(b.get('phases[1][items][0][price_data][unit_amount]')).toBe('30000');
    expect(b.get('phases[2][items][0][price_data][unit_amount]')).toBeNull();
  });

  test('echte schedulePhases-Ausgabe mit überfälliger Rate und Lücken-Phase im POST-Body', async () => {
    // 05.12.: Rate 01.12. überfällig → sofort bis 19.12. (14 Tage), Lücke bis 01.02., dann eine Monatsphase.
    const { provider, requests } = setup({ now: new Date('2026-12-05T09:00:00Z') });
    const rates = [{ no: 1, dueDate: '2026-12-01', amountCents: 45000 }, { no: 2, dueDate: '2027-02-01', amountCents: 30000 }];
    await provider.execute(takeover({ stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1', rates }), 'k');
    const b = Object.fromEntries(new URLSearchParams(posts(requests, '/v1/subscription_schedules')[0].body));
    expect(b).toMatchObject({
      start_date: 'now', end_behavior: 'cancel',
      'phases[0][items][0][price_data][unit_amount]': '45000', 'phases[0][end_date]': String(unix('2026-12-19')), 'phases[0][billing_cycle_anchor]': 'phase_start',
      'phases[1][items][0][price_data][unit_amount]': '30000', 'phases[1][end_date]': String(unix('2027-02-01')), 'phases[1][trial]': 'true',
      'phases[2][items][0][price_data][unit_amount]': '30000', 'phases[2][duration][interval]': 'month', 'phases[2][duration][interval_count]': '1', 'phases[2][billing_cycle_anchor]': 'phase_start',
    });
    expect(b['phases[1][billing_cycle_anchor]']).toBeUndefined();
    expect(b['phases[3][items][0][price_data][unit_amount]']).toBeUndefined();
  });

  test('ohne Schreib-Schlüssel: Demo-output, kein Stripe-Aufruf', async () => {
    const provider = createActionProvider({ writer: null, linkBase: LINK, now: () => T0 });
    expect(await provider.execute(takeover({ paymentMethodId: 'pm_test_1' }), `${TAKEOVER_ID}:1`)).toEqual({ result: 'ok', output: { linkBase: LINK } });
    expect(provider.simulatedFor?.(takeover())).toBe(true);
  });

  test('Stripe-Fehler → Ausführung wirft (Ausführer macht daraus „Fehlgeschlagen“)', async () => {
    const { provider } = setup({ status: { 'POST /v1/customers': 500 } });
    await expect(provider.execute(takeover(), 'k')).rejects.toThrow('Stripe: HTTP 500 bei /v1/customers');
  });

  test('Nachrichten bleiben Demo, nur stripe_takeover mit Schreiber ist echt', async () => {
    const { provider, requests } = setup();
    expect(provider.simulated).toBe(true);
    expect(provider.simulatedFor?.(reminder)).toBe(true);
    expect(provider.simulatedFor?.(takeover())).toBe(false);
    expect(await provider.execute(reminder, 'r:1')).toBe('ok');
    expect(await provider.lookup('r:1', reminder)).toBe(true);
    expect(await provider.lookup('r:2', reminder)).toBe(false);
    expect(requests).toEqual([]);
  });
});

describe('createActionProvider: lookup (Prüfen bei unklarem Ausgang)', () => {
  test('Kunde per contractId gefunden → output mit Kunde', async () => {
    const { provider, requests } = setup({ routes: { ...stripeWriteRoutes, 'GET /v1/customers/search': { data: [{ id: 'cus_test_1' }] } } });
    expect(await provider.lookup(`${TAKEOVER_ID}:1`, takeover())).toEqual({ output: { stripeCustomerId: 'cus_test_1', linkBase: LINK } });
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });

  test('kein Kunde → false, nichts angelegt', async () => {
    const { provider, requests } = setup();
    expect(await provider.lookup(`${TAKEOVER_ID}:1`, takeover())).toBe(false);
    expect(requests.map((r) => r.method)).toEqual(['GET']);
  });

  test('Neu-Freigabe: Zeitplan existiert schon → scheduleId im output', async () => {
    const routes = { ...stripeWriteRoutes, 'GET /v1/subscription_schedules': { data: [
      { id: 'sub_sched_other', metadata: { takeoverId: 'stripe-takeover-c1-0' } },
      { id: 'sub_sched_test_1', metadata: { takeoverId: TAKEOVER_ID } },
    ] } };
    const { provider, requests } = setup({ routes });
    expect(await provider.lookup(`${TAKEOVER_ID}:1`, takeover({ stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1' })))
      .toEqual({ output: { stripeCustomerId: 'cus_test_1', linkBase: LINK, scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' } });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /v1/subscription_schedules?customer=cus_test_1&limit=100']);
  });

  test('Neu-Freigabe ohne Zeitplan → nur Kunde (Link bleibt, Webhook richtet ein)', async () => {
    const { provider } = setup();
    expect(await provider.lookup('k', takeover({ stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1' })))
      .toEqual({ output: { stripeCustomerId: 'cus_test_1', linkBase: LINK, paymentMethodId: 'pm_test_1' } });
  });

  test('ohne Schreiber: erst nach Demo-Ausführung gefunden', async () => {
    const provider = createActionProvider({ writer: null, linkBase: LINK, now: () => T0, demo: new DemoProvider() });
    expect(await provider.lookup('k:1', takeover())).toBe(false);
    await provider.execute(takeover(), 'k:1');
    expect(await provider.lookup('k:1', takeover())).toEqual({ output: { linkBase: LINK } });
  });
});

describe('Server-Ausführer im Zusammenspiel', () => {
  test('Freigabe im Echtbetrieb mit Schreiber → echte Umstellung (kein Demo-Token), Kunde gespeichert', async () => {
    const repos = createMemoryRepos();
    await seed(repos, paidState());
    const { provider } = setup();
    const at = () => T0;
    await dispatchEvents(repos, [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }], { at, provider });
    await dispatchEvents(repos, [{ type: 'approveAction', id: TAKEOVER_ID, version: 1, via: 'app' }], { at, provider });
    const s = await loadState(repos, T0);
    expect(s.actions.find((a) => a.id === TAKEOVER_ID)?.status).toBe('executed');
    expect(s.takeovers).toHaveLength(1);
    const t = s.takeovers[0];
    expect(t).toMatchObject({ id: TAKEOVER_ID, status: 'link_sent', isDemo: false, stripeCustomerId: 'cus_test_1', scheduleId: null });
    expect(t.token).toMatch(/^[0-9a-f]{64}$/);
    expect(t.link).toBe(`${LINK}/zahlung/${t.token}`);
  });

  test('ohne Schreiber im Echtbetrieb → Demo-Umstellung', async () => {
    const repos = createMemoryRepos();
    await seed(repos, paidState());
    const provider = createActionProvider({ writer: null, linkBase: LINK, now: () => T0 });
    const at = () => T0;
    await dispatchEvents(repos, [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }], { at, provider });
    await dispatchEvents(repos, [{ type: 'approveAction', id: TAKEOVER_ID, version: 1, via: 'app' }], { at, provider });
    const t = (await loadState(repos, T0)).takeovers[0];
    expect(t).toMatchObject({ isDemo: true, stripeCustomerId: null });
    expect(t.link).toBe(`${LINK}/zahlung/${t.token}`);
    expect(t.token.startsWith('demo-')).toBe(true);
  });
});

describe('Registry', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
    vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
    vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
    vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
    vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
    vi.stubEnv('STRIPE_WRITE_KEY', '');
    resetTestRepos();
  });

  test('ohne STRIPE_WRITE_KEY kein Schreiber, Test-Überschreibung greift', () => {
    expect(getStripeWriter()).toBeNull();
    const w = { marker: true } as unknown as StripeWriter;
    setTestStripeWriter(w);
    expect(getStripeWriter()).toBe(w);
    setTestStripeWriter(null);
    expect(getStripeWriter()).toBeNull();
  });

  test('mit STRIPE_WRITE_KEY → Schreiber; resetTestRepos hebt die Überschreibung auf', () => {
    vi.stubEnv('STRIPE_WRITE_KEY', 'rk_test_dummy');
    setTestStripeWriter(null);
    expect(getStripeWriter()).toBeNull();
    resetTestRepos();
    expect(getStripeWriter()).not.toBeNull();
  });

  test('setTestStripeWriter wirft außerhalb des Testmodus', () => {
    vi.stubEnv('NEXUS_TEST_MEMORY_DB', '');
    vi.stubEnv('SUPABASE_URL', 'https://db.example.de');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'x'.repeat(20));
    expect(() => setTestStripeWriter(null)).toThrow('setTestStripeWriter nur im Testmodus');
  });

  test('getActionProvider: Nachrichten simuliert, Umstellung echt mit Schreiber', () => {
    expect(getActionProvider().simulated).toBe(true);
    expect(getActionProvider().simulatedFor?.(takeover())).toBe(true);
    setTestStripeWriter({} as StripeWriter);
    expect(getActionProvider().simulatedFor?.(takeover())).toBe(false);
  });
});
