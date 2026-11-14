import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { verifyStripeSignature } from '@/server/connectors/stripe-signature';

const syncSpy = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/server/sync', () => ({ syncConnections: syncSpy }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));

import { POST } from '@/app/api/webhooks/stripe/route';
import { fixtureFetch, type FixtureRequest } from '@/server/connectors/fixture-fetch';
import { createStripeWriter } from '@/server/connectors/stripe-write';
import { getRepos, resetTestRepos, setTestStripeWriter } from '@/server/registry';
import { loadState } from '@/server/state-service';
import { stripeWriteRoutes } from '../fixtures/stripe-write';
import { tx } from './helpers';
import { applyAt, linkSentState, seed, T0, TAKEOVER_ID } from './takeover/setup';

const SECRET = 'whsec_test';
const sign = (body: string, t: number, secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const BODY = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
const nowSec = () => Math.floor(Date.now() / 1000);
const req = (body: string, sig: string | null) =>
  new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body, headers: sig ? { 'stripe-signature': sig } : {} });

describe('verifyStripeSignature', () => {
  test('gültige Signatur', () => expect(verifyStripeSignature(BODY, sign(BODY, 1000), SECRET, 1010)).toEqual({ ok: true, event: { id: 'evt_1', type: 'invoice.paid', object: {} } }));
  test('liefert data.object mit', () => {
    const b = JSON.stringify({ id: 'evt_3', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', mode: 'setup' } } });
    expect(verifyStripeSignature(b, sign(b, 1000), SECRET, 1000)).toEqual({ ok: true, event: { id: 'evt_3', type: 'checkout.session.completed', object: { id: 'cs_test_1', mode: 'setup' } } });
    const n = JSON.stringify({ id: 'evt_4', type: 'customer.created' });
    expect(verifyStripeSignature(n, sign(n, 1000), SECRET, 1000)).toEqual({ ok: true, event: { id: 'evt_4', type: 'customer.created', object: null } });
  });
  test('falsches Geheimnis', () => expect(verifyStripeSignature(BODY, sign(BODY, 1000, 'other'), SECRET, 1010)).toEqual({ ok: false, reason: 'signature' }));
  test('veränderter Body', () => expect(verifyStripeSignature(BODY + ' ', sign(BODY, 1000), SECRET, 1010).ok).toBe(false));
  test('Zeit außerhalb der Toleranz', () => expect(verifyStripeSignature(BODY, sign(BODY, 1000), SECRET, 1000 + 301)).toEqual({ ok: false, reason: 'timestamp' }));
  test('mehrere v1 (Schlüsselwechsel): eine passende reicht', () =>
    expect(verifyStripeSignature(BODY, `t=1000,v1=${'0'.repeat(64)},${sign(BODY, 1000).split(',')[1]}`, SECRET, 1000).ok).toBe(true));
  test('fehlender Header', () => expect(verifyStripeSignature(BODY, null, SECRET, 1000)).toEqual({ ok: false, reason: 'missing' }));
  test('Zeitstempel in der Zukunft außerhalb der Toleranz', () => expect(verifyStripeSignature(BODY, sign(BODY, 1301), SECRET, 1000)).toEqual({ ok: false, reason: 'timestamp' }));
  test('genau 300 s Abstand wird akzeptiert, 301 s nicht', () => {
    expect(verifyStripeSignature(BODY, sign(BODY, 1000), SECRET, 1300).ok).toBe(true);
    expect(verifyStripeSignature(BODY, sign(BODY, 1000), SECRET, 1301)).toEqual({ ok: false, reason: 'timestamp' });
  });
  test('v1 mit falscher Länge oder ohne Hex → signature, keine Exception', () => {
    for (const v of ['abc', 'zz'.repeat(32), '0'.repeat(66), ''])
      expect(verifyStripeSignature(BODY, `t=1000,v1=${v}`, SECRET, 1000)).toEqual({ ok: false, reason: 'signature' });
  });
  test('Header ohne v1 → format', () => expect(verifyStripeSignature(BODY, 't=1000', SECRET, 1000)).toEqual({ ok: false, reason: 'format' }));
  test('Signatur gültig, aber ohne id/type → format', () => {
    const b = JSON.stringify({ foo: 1 });
    expect(verifyStripeSignature(b, sign(b, 1000), SECRET, 1000)).toEqual({ ok: false, reason: 'format' });
  });
});

describe('Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
    vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
    vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
    vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
    vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    resetTestRepos();
  });
  test('gültig → 200, Sync nur für Stripe', async () => {
    const res = await POST(req(BODY, sign(BODY, nowSec())));
    expect(res.status).toBe(200);
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect((syncSpy.mock.calls[0] as unknown[])[1]).toMatchObject({ only: ['stripe_nexus'] });
  });
  test('ungültig → 400, kein Sync', async () => {
    expect((await POST(req(BODY, 't=1,v1=00'))).status).toBe(400);
    expect(syncSpy).not.toHaveBeenCalled();
  });
  test('doppeltes Event → zweites Mal duplicate, Sync einmal', async () => {
    await POST(req(BODY, sign(BODY, nowSec())));
    expect(await (await POST(req(BODY, sign(BODY, nowSec())))).json()).toEqual({ duplicate: true });
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
  test('irrelevanter Typ → 200, kein Sync', async () => {
    const b = JSON.stringify({ id: 'evt_2', type: 'customer.created' });
    expect((await POST(req(b, sign(b, nowSec())))).status).toBe(200);
    expect(syncSpy).not.toHaveBeenCalled();
  });
  test('ohne Geheimnis → 503, nie unsigniert akzeptiert', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    expect((await POST(req(BODY, sign(BODY, nowSec())))).status).toBe(503);
    expect((await POST(req(BODY, null))).status).toBe(503);
    expect(syncSpy).not.toHaveBeenCalled();
  });
  test('zu großer Body → 413, kein Sync', async () => {
    const big = JSON.stringify({ id: 'evt_big', type: 'invoice.paid', pad: 'x'.repeat(1_100_000) });
    expect((await POST(req(big, sign(big, nowSec())))).status).toBe(413);
    expect(syncSpy).not.toHaveBeenCalled();
  });
  test('Sync-Fehler wird geloggt (nur Fehlername), Antwort bleibt 200', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    syncSpy.mockRejectedValueOnce(new RangeError('whsec_GEHEIM'));
    expect((await POST(req(BODY, sign(BODY, nowSec())))).status).toBe(200);
    expect(spy).toHaveBeenCalledWith('Stripe-Webhook: Sync fehlgeschlagen:', 'RangeError');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('GEHEIM');
    spy.mockRestore();
  });
  test('maxDuration 60 s', async () => expect((await import('@/app/api/webhooks/stripe/route')).maxDuration).toBe(60));
  test('Antwort enthält nie das Geheimnis', async () => expect(await (await POST(req(BODY, 'x'))).text()).not.toContain(SECRET));
});

describe('Route: checkout.session.completed (Umstellung)', () => {
  const KEY = `takeover:${TAKEOVER_ID}:schedule`;
  const event = (id = 'evt_cs_1', metadata: Record<string, string> = { takeoverId: TAKEOVER_ID, contractId: 'c1' }) => JSON.stringify({
    id, type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', object: 'checkout.session', mode: 'setup', setup_intent: 'seti_test_1', customer: 'cus_test_1', metadata } },
  });
  const post = (body: string) => POST(req(body, sign(body, nowSec())));
  let requests: FixtureRequest[];
  let status: Record<string, number>;
  const schedules = () => requests.filter((r) => r.method === 'POST' && r.path === '/v1/subscription_schedules');
  const state = () => loadState(getRepos(), T0);

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
    vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
    vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
    vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
    vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    resetTestRepos();
    requests = [];
    status = {};
    setTestStripeWriter(createStripeWriter({ key: 'sk_test_SECRET', fetch: fixtureFetch(stripeWriteRoutes, { requests, status }), sleep: async () => {}, now: () => 0 }));
    await seed(getRepos(), linkSentState());
  });
  afterEach(() => vi.useRealTimers());

  test('Webhook: gleicher Plan → eingerichtet, Zeitplan genau einmal', async () => {
    expect((await post(event())).status).toBe(200);
    expect(await (await post(event())).json()).toEqual({ duplicate: true });
    const s = await state();
    expect(s.takeovers[0]).toMatchObject({ status: 'set_up', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' });
    expect(s.contracts[0].billing).toBe('stripe');
    expect(schedules().map((r) => r.idempotencyKey)).toEqual([KEY]);
    expect(syncSpy).not.toHaveBeenCalled();
  });

  test('gleichzeitige Zustellung mit verschiedenen Ereignis-IDs → höchstens ein Zeitplan-Key, einmal eingerichtet', async () => {
    const rs = await Promise.all([post(event('evt_cs_a')), post(event('evt_cs_b'))]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    const s = await state();
    expect(s.takeovers[0].status).toBe('set_up');
    expect(schedules().length).toBeGreaterThanOrEqual(1);
    expect(schedules().every((r) => r.idempotencyKey === KEY)).toBe(true);
    expect(s.audit.filter((a) => a.text.startsWith('Umstellung eingerichtet')).length).toBe(1);
  });

  test('Webhook: inzwischen überwiesen → Plan geändert, kein Zeitplan, Zahlungsmittel gespeichert', async () => {
    const s0 = linkSentState();
    const p = tx({ id: 'p-c1-2', externalId: 'x-p-c1-2', bookedOn: '2026-11-12', amountCents: 10000 });
    resetTestRepos();
    setTestStripeWriter(createStripeWriter({ key: 'sk_test_SECRET', fetch: fixtureFetch(stripeWriteRoutes, { requests, status }), sleep: async () => {}, now: () => 0 }));
    await seed(getRepos(), { ...s0, payments: [...s0.payments, p], allocations: [...s0.allocations, { paymentId: p.id, contractId: 'c1', amountCents: 10000, method: 'manual' }] });
    expect((await post(event())).status).toBe(200);
    const s = await state();
    expect(s.takeovers[0]).toMatchObject({ status: 'plan_changed', paymentMethodId: 'pm_test_1', scheduleId: null });
    expect(schedules()).toHaveLength(0);
  });

  test('Webhook nach Zurückziehen ohne offenen Zeitplan → ignoriert, nur Suche', async () => {
    resetTestRepos();
    setTestStripeWriter(createStripeWriter({ key: 'sk_test_SECRET', fetch: fixtureFetch(stripeWriteRoutes, { requests, status }), sleep: async () => {}, now: () => 0 }));
    await seed(getRepos(), applyAt(linkSentState(), [{ type: 'withdrawTakeover', contractId: 'c1' }]));
    expect((await post(event())).status).toBe(200);
    expect((await state()).takeovers[0].status).toBe('withdrawn');
    expect(requests.map((r) => `${r.method} ${r.path.split('?')[0]}`)).toEqual(['GET /v1/subscription_schedules']);
  });

  test.each([
    ['Stripe-Fehler', 500],
    ['gleichzeitiger Key in Benutzung (409)', 409],
  ])('Webhook: %s beim Zeitplan → 500, Ereignis nicht als erledigt beansprucht', async (_n, code) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    status['POST /v1/subscription_schedules'] = code;
    const res = await post(event());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('SECRET');
    expect((await state()).takeovers[0].status).toBe('link_sent');
    expect(spy).toHaveBeenCalledWith('Stripe-Webhook: Umstellung fehlgeschlagen:', 'ConnectorError');
    delete status['POST /v1/subscription_schedules'];
    const again = await post(event());
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ received: true });
    expect((await state()).takeovers[0].status).toBe('set_up');
    expect(schedules().map((r) => r.idempotencyKey)).toEqual([KEY, KEY]);
    spy.mockRestore();
  });

  test('Webhook ohne Schreib-Schlüssel ändert nichts', async () => {
    setTestStripeWriter(null);
    expect((await post(event())).status).toBe(200);
    expect((await state()).takeovers[0]).toMatchObject({ status: 'link_sent', scheduleId: null });
    expect(requests).toEqual([]);
  });

  test('Checkout ohne takeoverId → keine Stripe-Aufrufe, 200', async () => {
    expect((await post(event('evt_cs_x', {}))).status).toBe(200);
    expect(requests).toEqual([]);
    expect((await state()).takeovers[0].status).toBe('link_sent');
  });
});
