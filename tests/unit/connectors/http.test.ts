import { describe, expect, test } from 'vitest';

import { fixtureFetch } from '@/server/connectors/fixture-fetch';
import { createApiClient } from '@/server/connectors/http';
import { BudgetExceeded, ConnectorError, RateLimited } from '@/server/connectors/types';

const noSleep = async () => {};
const spyFetch = (calls: Request[], bodies: unknown[]): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(input as string, init));
    const body = bodies.length > 1 ? bodies.shift() : bodies[0];
    return body instanceof Response ? body : Response.json(body);
  }) as typeof fetch;
const base = { label: 'Lexware', baseUrl: 'https://api.lexware.io', key: 'SECRET', sleep: noSleep, now: () => 1000, minIntervalMs: 500 };

describe('createApiClient', () => {
  test('HTTP 400 nennt den Grund aus der Antwort (IssueList oder message), ohne Schlüssel', async () => {
    const issue = Response.json({ IssueList: [{ i18nKey: 'invalid_value', source: 'voucherStatus', type: 'validation_failure' }] }, { status: 400 });
    const api = createApiClient({ ...base, fetch: spyFetch([], [issue]) });
    const err = await api.getJson('/v1/voucherlist?x=1').catch((e: Error) => e) as Error;
    expect(err.message).toBe('Lexware: HTTP 400 bei /v1/voucherlist (voucherStatus invalid_value)');

    const msg = Response.json({ message: 'Bad sort SECRET <b>x</b>' }, { status: 400 });
    const api2 = createApiClient({ ...base, fetch: spyFetch([], [msg]) });
    const err2 = await api2.getJson('/v1/voucherlist').catch((e: Error) => e) as Error;
    expect(err2.message).toBe('Lexware: HTTP 400 bei /v1/voucherlist (Bad sort *** bx/b)');

    const plain = new Response('nope', { status: 400 });
    const api3 = createApiClient({ ...base, fetch: spyFetch([], [plain]) });
    expect((await api3.getJson('/v1/a').catch((e: Error) => e) as Error).message).toBe('Lexware: HTTP 400 bei /v1/a');
  });

  test('Bearer-Schlüssel im Header, nie in der URL; zusätzliche Header', async () => {
    const calls: Request[] = [];
    const api = createApiClient({ ...base, fetch: spyFetch(calls, [{ ok: 1 }]), headers: { 'Stripe-Version': 'v1' } });
    expect(await api.getJson('/v1/contacts?page=0')).toEqual({ ok: 1 });
    expect(calls[0].headers.get('authorization')).toBe('Bearer SECRET');
    expect(calls[0].headers.get('stripe-version')).toBe('v1');
    expect(calls[0].url).toBe('https://api.lexware.io/v1/contacts?page=0');
    expect(calls[0].url).not.toContain('SECRET');
  });

  test('Drosselung: mindestens 500 ms zwischen zwei Anfragen', async () => {
    const waits: number[] = [];
    const api = createApiClient({ ...base, fetch: fixtureFetch({ '/a': {}, '/b': {} }), sleep: async (ms) => { waits.push(ms); } });
    await api.getJson('/a');
    expect(waits).toEqual([]);
    await api.getJson('/b');
    expect(waits.at(-1)).toBeGreaterThanOrEqual(500);
  });

  test('ohne Mindestabstand keine Wartezeit', async () => {
    const waits: number[] = [];
    const api = createApiClient({ ...base, minIntervalMs: 0, fetch: fixtureFetch({ '/a': {} }), sleep: async (ms) => { waits.push(ms); } });
    await api.getJson('/a');
    await api.getJson('/a');
    expect(waits).toEqual([]);
  });

  test('429 → einmal nach Retry-After warten und wiederholen', async () => {
    const calls: Request[] = [];
    const waits: number[] = [];
    const f = spyFetch(calls, [new Response('{}', { status: 429, headers: { 'retry-after': '1' } }), { ok: true }]);
    const api = createApiClient({ ...base, minIntervalMs: 0, fetch: f, sleep: async (ms) => { waits.push(ms); } });
    expect(await api.getJson('/v1/x')).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  test('429 ohne Retry-After (oder ungültig) → 1000 ms Wartezeit', async () => {
    for (const headers of [{} as Record<string, string>, { 'retry-after': '' }, { 'retry-after': 'bald' }, { 'retry-after': '0' }]) {
      const waits: number[] = [];
      const f = spyFetch([], [new Response('{}', { status: 429, headers }), { ok: true }]);
      await createApiClient({ ...base, minIntervalMs: 0, fetch: f, sleep: async (ms) => { waits.push(ms); } }).getJson('/v1/x');
      expect(waits).toEqual([1000]);
    }
  });

  test('429 → bis zu 3 Wiederholungen mit wachsender Pause (1 s, 2 s, 4 s)', async () => {
    const calls: Request[] = [];
    const waits: number[] = [];
    const r429 = () => new Response('{}', { status: 429 });
    const f = spyFetch(calls, [r429(), r429(), r429(), { ok: true }]);
    expect(await createApiClient({ ...base, minIntervalMs: 0, fetch: f, sleep: async (ms) => { waits.push(ms); } }).getJson('/v1/x')).toEqual({ ok: true });
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([1000, 2000, 4000]);
  });

  test('anhaltendes 429 → RateLimited (zählt als „später weiter“, BudgetExceeded), kein fünfter Versuch', async () => {
    const calls: Request[] = [];
    const f = spyFetch(calls, [new Response('{}', { status: 429 })]);
    const err = await createApiClient({ ...base, minIntervalMs: 0, fetch: f }).getJson('/v1/x').then(() => { throw new Error('kein Fehler'); }, (e: Error) => e);
    expect(err).toBeInstanceOf(RateLimited);
    expect(err).toBeInstanceOf(BudgetExceeded);
    expect(calls).toHaveLength(4);
  });

  test('Fehler ohne Schlüssel, ohne Query, ohne Antworttext', async () => {
    const f = fixtureFetch({}, { status: { '/v1/contacts': 401 } });
    const err = await createApiClient({ ...base, fetch: f }).getJson('/v1/contacts?token=SECRET').then(() => { throw new Error('kein Fehler'); }, (e: Error) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.message).toBe('Lexware: HTTP 401 bei /v1/contacts (Schlüssel prüfen)');
  });

  test('Antwort, die den Schlüssel in Text und Header zurückgibt, taucht nirgends auf', async () => {
    const f = (async () => new Response('{"error":"bad key SECRET"}', { status: 401, headers: { 'x-echo': 'Bearer SECRET' } })) as typeof fetch;
    const err = await createApiClient({ ...base, fetch: f }).getJson('/v1/contacts?k=SECRET').then(() => { throw new Error('kein Fehler'); }, (e: Error) => e);
    expect(JSON.stringify([err.message, String(err), err.stack?.split('\n')[0]])).not.toContain('SECRET');
    expect(err.cause).toBeUndefined();
  });

  test('Netzfehler mit Schlüssel im Text → bereinigt', async () => {
    const f = (async () => { throw new Error('connect failed Bearer SECRET'); }) as typeof fetch;
    const err = await createApiClient({ ...base, fetch: f }).getJson('/x').then(() => { throw new Error('kein Fehler'); }, (e: Error) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.message).toBe('Lexware: keine Verbindung');
    expect(err.cause).toBeUndefined();
  });

  test('ungültiges JSON → sicherer Fehler', async () => {
    const f = (async () => new Response('<html>SECRET', { status: 200 })) as typeof fetch;
    const err = await createApiClient({ ...base, fetch: f }).getJson('/x').then(() => { throw new Error('kein Fehler'); }, (e: Error) => e);
    expect(err.message).toBe('Lexware: ungültige Antwort bei /x');
  });
});

describe('fixtureFetch', () => {
  test('Treffer: Pfad+Query exakt, sonst Pfad, sonst 404; calls protokolliert Pfad+Query', async () => {
    const calls: string[] = [];
    const f = fixtureFetch({ '/p?a=1': { n: 'exakt' }, '/p': { n: 'pfad' } }, { calls });
    expect(await (await f('https://h.example/p?a=1')).json()).toEqual({ n: 'exakt' });
    expect(await (await f('https://h.example/p?a=2')).json()).toEqual({ n: 'pfad' });
    expect((await f('https://h.example/q')).status).toBe(404);
    expect(calls).toEqual(['/p?a=1', '/p?a=2', '/q']);
  });
});

describe('createApiClient authorization', () => {
  test('eigener Authorization-Wert ohne Bearer', async () => {
    const calls: Request[] = [];
    await createApiClient({ label: 'Qonto', baseUrl: 'https://thirdparty.qonto.com', key: 'LOGIN:SECRET', authorization: 'LOGIN:SECRET', fetch: spyFetch(calls, [{}]), sleep: noSleep, now: () => 1000, minIntervalMs: 0 }).getJson('/v2/organization');
    expect(calls[0].headers.get('authorization')).toBe('LOGIN:SECRET');
  });

  test('Standard bleibt Bearer', async () => {
    const calls: Request[] = [];
    await createApiClient({ ...base, fetch: spyFetch(calls, [{}]) }).getJson('/v1/a');
    expect(calls[0].headers.get('authorization')).toBe('Bearer SECRET');
  });

  test('400-Grund maskiert Login und Secret einzeln', async () => {
    const bad = Response.json({ message: 'bad LOGINX and SECRETY' }, { status: 400 });
    const err = await createApiClient({ ...base, label: 'Qonto', key: 'LOGINX:SECRETY', authorization: 'LOGINX:SECRETY', fetch: spyFetch([], [bad]) }).getJson('/v2/a').catch((e: Error) => e) as Error;
    expect(err.message).toBe('Qonto: HTTP 400 bei /v2/a (bad *** and ***)');
  });

  describe('postForm', () => {
    test('Methode, Content-Type, Idempotency-Key, Schlüssel nie im Fehlertext', async () => {
      const calls: Request[] = [];
      const ok = createApiClient({ ...base, label: 'Stripe', baseUrl: 'https://api.stripe.com', fetch: spyFetch(calls, [{ id: 'x_1' }]) });
      expect(await ok.postForm('/v1/customers', 'name=A', 'idem-1')).toEqual({ id: 'x_1' });
      expect(calls[0].method).toBe('POST');
      expect(calls[0].headers.get('content-type')).toBe('application/x-www-form-urlencoded');
      expect(calls[0].headers.get('idempotency-key')).toBe('idem-1');
      expect(calls[0].headers.get('authorization')).toBe('Bearer SECRET');
      expect(await calls[0].text()).toBe('name=A');

      const bad = Response.json({ error: { message: 'Invalid key SECRET' } }, { status: 400 });
      const api = createApiClient({ ...base, label: 'Stripe', baseUrl: 'https://api.stripe.com', fetch: spyFetch([], [bad]) });
      const err = await api.postForm('/v1/customers', 'name=A').catch((e: Error) => e) as Error;
      expect(err.message).toBe('Stripe: HTTP 400 bei /v1/customers (Invalid key ***)');
    });
    test('wiederholt 429 mit demselben Idempotency-Key und Body', async () => {
      const calls: Request[] = [];
      const api = createApiClient({ ...base, label: 'Stripe', baseUrl: 'https://api.stripe.com', fetch: spyFetch(calls, [new Response('{}', { status: 429 }), { id: 'x_2' }]) });
      expect(await api.postForm('/v1/customers', 'name=A', 'idem-2')).toEqual({ id: 'x_2' });
      expect(calls.map((c) => c.headers.get('idempotency-key'))).toEqual(['idem-2', 'idem-2']);
      expect(await Promise.all(calls.map((c) => c.text()))).toEqual(['name=A', 'name=A']);
    });
  });
});
