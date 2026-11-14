import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));

import { GET, POST } from '@/app/zahlung/[token]/weiter/route';
import { POST as TAKEOVER_POST, GET as TAKEOVER_GET } from '@/app/api/test/takeover/route';
import { fixtureFetch, type FixtureRequest } from '@/server/connectors/fixture-fetch';
import { createStripeWriter } from '@/server/connectors/stripe-write';
import { getRepos, resetTestRepos, setTestStripeWriter } from '@/server/registry';
import { stripeWriteRoutes } from '../fixtures/stripe-write';
import { linkSentState, seed } from './takeover/setup';

const token = () => linkSentState().takeovers[0].token;
const call = (t: string, ip = '203.0.113.7') =>
  [new Request(`https://nexus.example.de/zahlung/${t}/weiter`, { method: 'POST', headers: { 'x-forwarded-for': ip } }), { params: Promise.resolve({ token: t }) }] as const;

let requests: FixtureRequest[];
const sessions = () => requests.filter((r) => r.method === 'POST' && r.path === '/v1/checkout/sessions');

beforeEach(async () => {
  vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
  vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
  vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
  vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
  resetTestRepos();
  requests = [];
  setTestStripeWriter(createStripeWriter({ key: 'sk_test_SECRET', fetch: fixtureFetch(stripeWriteRoutes, { requests }), sleep: async () => {}, now: () => 0 }));
  await seed(getRepos(), linkSentState());
});

describe('POST /zahlung/[token]/weiter', () => {
  test('gültiger Token → 303 auf Checkout-URL, Sitzung mit mode setup', async () => {
    const res = await POST(...call(token()));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://checkout.stripe.test/c/pay/cs_test_1');
    expect(sessions()).toHaveLength(1);
    expect(sessions()[0].body).toContain('mode=setup');
  });
  test('GET weiter → 405, keine Sitzung', async () => {
    expect(GET).toBeTypeOf('function');
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(requests).toEqual([]);
  });
  test('ungültiger Token → 303 zurück auf die Seite, keine Sitzung', async () => {
    const bad = '0'.repeat(64);
    const res = await POST(...call(bad));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/zahlung/${bad}`);
    expect(sessions()).toHaveLength(0);
  });
  test('Demo (kein Schreiber) → 303 zurück, keine Sitzung', async () => {
    setTestStripeWriter(null);
    const t = token();
    const res = await POST(...call(t));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/zahlung/${t}`);
    expect(requests).toEqual([]);
  });
  test('6. POST je Token und Minute → 429 mit Text, keine weitere Sitzung', async () => {
    const t = token();
    for (let i = 0; i < 5; i++) expect((await POST(...call(t, `198.51.100.${i}`))).status).toBe(303);
    const res = await POST(...call(t, '198.51.100.99'));
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('Zu viele Aufrufe, bitte kurz warten.');
    expect(sessions()).toHaveLength(5);
  });
  test('11. POST je IP und Minute → 429 (auch bei wechselnden Token)', async () => {
    for (let i = 0; i < 10; i++) expect((await POST(...call(String(i).padStart(64, '0')))).status).toBe(303);
    expect((await POST(...call('f'.repeat(64)))).status).toBe(429);
  });
  test('Token wird nie in der 429-Antwort wiederholt', async () => {
    const t = token();
    for (let i = 0; i < 5; i++) await POST(...call(t, `198.51.100.${i}`));
    expect(await (await POST(...call(t, '198.51.100.99'))).text()).not.toContain(t);
  });
});

describe('/api/test/takeover', () => {
  test('außerhalb des Testmodus → 404', async () => {
    vi.stubEnv('NEXUS_TEST_MEMORY_DB', '');
    vi.stubEnv('SUPABASE_URL', 'https://x.supabase.example');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k'.repeat(30));
    const res = await TAKEOVER_POST(new Request('http://localhost/api/test/takeover', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(404);
    expect((await TAKEOVER_GET()).status).toBe(404);
  });
  test('Testmodus: setzt Stand, GET liefert Umstellungen', async () => {
    const state = linkSentState();
    const res = await TAKEOVER_POST(new Request('http://localhost/api/test/takeover', { method: 'POST', body: JSON.stringify({ routes: stripeWriteRoutes, state }) }));
    expect(res.status).toBe(200);
    const got = (await (await TAKEOVER_GET()).json()) as { takeovers: { status: string; token: string }[] };
    expect(got.takeovers.map((t) => [t.status, t.token])).toEqual([['link_sent', state.takeovers[0].token]]);
  });
});
