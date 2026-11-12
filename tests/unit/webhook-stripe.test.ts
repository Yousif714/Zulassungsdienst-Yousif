import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { verifyStripeSignature } from '@/server/connectors/stripe-signature';

const syncSpy = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/server/sync', () => ({ syncConnections: syncSpy }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));

import { POST } from '@/app/api/webhooks/stripe/route';
import { resetTestRepos } from '@/server/registry';

const SECRET = 'whsec_test';
const sign = (body: string, t: number, secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const BODY = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
const nowSec = () => Math.floor(Date.now() / 1000);
const req = (body: string, sig: string | null) =>
  new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body, headers: sig ? { 'stripe-signature': sig } : {} });

describe('verifyStripeSignature', () => {
  test('gültige Signatur', () => expect(verifyStripeSignature(BODY, sign(BODY, 1000), SECRET, 1010)).toEqual({ ok: true, event: { id: 'evt_1', type: 'invoice.paid' } }));
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
  test('Antwort enthält nie das Geheimnis', async () => expect(await (await POST(req(BODY, 'x'))).text()).not.toContain(SECRET));
});
