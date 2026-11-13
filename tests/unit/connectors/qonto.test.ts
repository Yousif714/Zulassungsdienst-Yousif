import { describe, expect, test } from 'vitest';

import { fixtureFetch } from '@/server/connectors/fixture-fetch';
import { pullQonto, QONTO_OVERLAP_MS, QONTO_SINCE, qontoTransactionsQuery } from '@/server/connectors/qonto';
import { ConnectorError, type PullContext } from '@/server/connectors/types';
import { qontoRoutes, qontoRoutesPaged, qontoTransactions } from '../../fixtures';

const NOW = Date.parse('2026-11-12T10:00:00Z');
const ctx = (o: Partial<PullContext> = {}): PullContext => ({
  fetch: fixtureFetch(qontoRoutes), key: 'LOGIN:SECRET', sleep: async () => {}, now: () => NOW, deadline: NOW + 60_000, known: new Map(), ...o,
});
/** Budget über die Zahl der Anfragen: nach `n` fetch-Aufrufen ist `now()` hinter der Deadline. */
const limitFetches = (routes: Record<string, unknown>, n: number) => {
  const inner = fixtureFetch(routes);
  let count = 0;
  const f = ((i: RequestInfo | URL, init?: RequestInit) => { count++; return inner(i, init); }) as typeof fetch;
  return { o: { fetch: f, now: () => (count >= n ? NOW + 1_000_000 : NOW), deadline: NOW + 60_000 } };
};
const ids = (r: { batch: { payments: { externalId: string }[] } }) => r.batch.payments.map((p) => p.externalId);
// t-demir-1, t-demir-2, t-krueger-ws, t-stripe, t-kaya-ref, t-return (t-out/Ausgang, t-usd, t-july entfallen im Mapper)
const ALL = ['t-demir-1', 't-demir-2', 't-kaya-ref', 't-krueger-ws', 't-return', 't-stripe'];

test('Query hat feste Parameterreihenfolge', () => {
  expect(qontoTransactionsQuery('acc-main', QONTO_SINCE, 2)).toBe(
    'bank_account_id=acc-main&status%5B%5D=completed&settled_at_from=2026-07-31T22%3A00%3A00.000Z&sort_by=settled_at%3Aasc&per_page=100&current_page=2',
  );
});

describe('pullQonto', () => {
  test('Header ohne Bearer, Konten, dann Buchungen ab QONTO_SINCE', async () => {
    const calls: string[] = [];
    const headers: (string | null)[] = [];
    const inner = fixtureFetch(qontoRoutes, { calls });
    const f = ((i: RequestInfo | URL, init?: RequestInit) => { headers.push(new Headers(init?.headers).get('authorization')); return inner(i, init); }) as typeof fetch;
    const r = await pullQonto(null, ctx({ fetch: f }));
    expect(calls[0]).toBe('/v2/organization');
    expect(calls[1]).toBe(`/v2/transactions?${qontoTransactionsQuery('acc-main', QONTO_SINCE, 1)}`);
    expect(headers).toEqual(['LOGIN:SECRET', 'LOGIN:SECRET']);
    expect(r.complete).toBe(true);
    expect(ids(r).sort()).toEqual(ALL);
    expect(ids(r)).toContain('t-demir-1');
  });

  test('blättert über next_page und alle offenen EUR-Konten (USD/geschlossen übersprungen)', async () => {
    const calls: string[] = [];
    const r = await pullQonto(null, ctx({ fetch: fixtureFetch(qontoRoutesPaged, { calls }) }));
    expect(calls).toEqual([
      '/v2/organization',
      `/v2/transactions?${qontoTransactionsQuery('acc-2', QONTO_SINCE, 1)}`,
      `/v2/transactions?${qontoTransactionsQuery('acc-main', QONTO_SINCE, 1)}`,
      `/v2/transactions?${qontoTransactionsQuery('acc-main', QONTO_SINCE, 2)}`,
    ]);
    expect(r.complete).toBe(true);
    expect(ids(r).sort()).toEqual(ALL);
  });

  test('nach complete: Cursor mit Überlappung von 3 Tagen', async () => {
    const r = await pullQonto(null, ctx());
    const max = Math.max(...qontoTransactions.transactions.map((t) => Date.parse(t.settled_at)));
    expect(r.complete).toBe(true);
    expect(JSON.parse(r.cursor!)).toEqual({ settledFrom: new Date(max - QONTO_OVERLAP_MS).toISOString(), accountId: null, page: 1, maxSettled: null });
    expect(JSON.parse(r.cursor!).settledFrom).toBe('2026-10-30T09:00:00.000Z');
  });

  test('Folgelauf nutzt settledFrom aus dem Cursor; nie vor QONTO_SINCE', async () => {
    const calls: string[] = [];
    const first = await pullQonto(null, ctx());
    await pullQonto(first.cursor, ctx({ fetch: fixtureFetch(qontoRoutes, { calls }) }));
    expect(calls[1]).toBe(`/v2/transactions?${qontoTransactionsQuery('acc-main', '2026-10-30T09:00:00.000Z', 1)}`);
    const empty = await pullQonto(null, ctx({ fetch: fixtureFetch({ ...qontoRoutes, '/v2/transactions': { transactions: [], meta: { next_page: null } } }) }));
    expect(JSON.parse(empty.cursor!).settledFrom).toBe(QONTO_SINCE);
  });

  test('ungültiger Cursor → Neustart ab QONTO_SINCE', async () => {
    const calls: string[] = [];
    const r = await pullQonto('{kaputt', ctx({ fetch: fixtureFetch(qontoRoutes, { calls }) }));
    expect(calls[1]).toBe(`/v2/transactions?${qontoTransactionsQuery('acc-main', QONTO_SINCE, 1)}`);
    expect(r.complete).toBe(true);
  });

  test('Zeitbudget mitten in der Liste → Teilergebnis; Fortsetzung liefert den Rest ohne Lücke', async () => {
    const lim = limitFetches(qontoRoutesPaged, 3); // Organisation, acc-2 Seite 1, acc-main Seite 1
    const first = await pullQonto(null, ctx(lim.o));
    expect(first.complete).toBe(false);
    expect(ids(first).sort()).toEqual(['t-demir-1', 't-demir-2', 't-krueger-ws', 't-return']);
    expect(JSON.parse(first.cursor!)).toMatchObject({ settledFrom: QONTO_SINCE, accountId: 'acc-main', page: 2 });
    const calls: string[] = [];
    const second = await pullQonto(first.cursor, ctx({ fetch: fixtureFetch(qontoRoutesPaged, { calls }) }));
    expect(second.complete).toBe(true);
    expect(calls).toEqual(['/v2/organization', `/v2/transactions?${qontoTransactionsQuery('acc-main', QONTO_SINCE, 2)}`]);
    expect(ids(second).sort()).toEqual(['t-kaya-ref', 't-stripe']);
    expect([...ids(first), ...ids(second)].sort()).toEqual(ALL);
    // maxSettled aus dem ersten Teil bleibt erhalten: Überlappung rechnet über beide Läufe
    expect(JSON.parse(second.cursor!).settledFrom).toBe('2026-10-30T09:00:00.000Z');
  });

  test('Kontenliste ändert sich zwischen Teilläufen → keine Lücke', async () => {
    const org = (ids: string[]) => ({ organization: { bank_accounts: ids.map((id) => ({ id, currency: 'EUR', status: 'active' })) } });
    const tx = (acc: string, page: number) => `/v2/transactions?${qontoTransactionsQuery(acc, QONTO_SINCE, page)}`;
    const t = (id: string) => ({ transaction_id: id, amount_cents: 100, side: 'credit', currency: 'EUR', label: 'X', settled_at: '2026-10-02T09:00:00.000Z', operation_type: 'income' });
    const page = (id: string, next: number | null) => ({ transactions: [t(id)], meta: { next_page: next } });
    const routes1 = { '/v2/organization': org(['a', 'c']), [tx('a', 1)]: page('a1', null), [tx('c', 1)]: page('c1', 2), [tx('c', 2)]: page('c2', null) };
    const first = await pullQonto(null, ctx(limitFetches(routes1, 3).o)); // Organisation, a, c Seite 1
    expect(first.complete).toBe(false);
    expect(ids(first)).toEqual(['a1', 'c1']);
    expect(JSON.parse(first.cursor!)).toMatchObject({ accountId: 'c', page: 2 });
    // Neues Konto b dazwischen: Index 1 wäre jetzt b; über die ID geht es bei c Seite 2 weiter.
    const calls: string[] = [];
    const routes2 = { ...routes1, '/v2/organization': org(['a', 'b', 'c']), [tx('b', 1)]: page('b1', null) };
    const second = await pullQonto(first.cursor, ctx({ fetch: fixtureFetch(routes2, { calls }) }));
    expect(second.complete).toBe(true);
    expect(ids(second)).toEqual(['c2']);
    expect(calls).toEqual(['/v2/organization', tx('c', 2)]);
    // Konto c verschwindet: weiter mit dem nächsten Konto (hier keins) statt Index außerhalb
    const third = await pullQonto(first.cursor, ctx({ fetch: fixtureFetch({ ...routes1, '/v2/organization': org(['a', 'b', 'd']), [tx('d', 1)]: page('d1', null), [tx('b', 1)]: page('b1', null) }) }));
    expect(third.complete).toBe(true);
    expect(ids(third)).toEqual(['d1']);
  });

  test('next_page nicht größer als die aktuelle Seite oder nicht endlich → Liste fertig', async () => {
    const base = qontoRoutes['/v2/transactions'] as { transactions: unknown[] };
    for (const next of [1, 0, 'x', Infinity, 1.5]) {
      const calls: string[] = [];
      const r = await pullQonto(null, ctx({ fetch: fixtureFetch({ ...qontoRoutes, '/v2/transactions': { ...base, meta: { next_page: next } } }, { calls }) }));
      expect(calls).toHaveLength(2);
      expect(r.complete).toBe(true);
    }
  });

  test('429 dreimal (Retries erschöpft) → Teilergebnis mit Cursor statt Fehler', async () => {
    const r = await pullQonto(null, ctx({ fetch: fixtureFetch(qontoRoutes, { status: { '/v2/transactions': 429 } }) }));
    expect(r.complete).toBe(false);
    expect(r.batch.payments).toEqual([]);
    expect(JSON.parse(r.cursor!)).toMatchObject({ settledFrom: QONTO_SINCE, accountId: 'acc-main', page: 1 });
  });

  test('401 → ConnectorError ohne Schlüssel', async () => {
    const err = await pullQonto(null, ctx({ fetch: fixtureFetch(qontoRoutes, { status: { '/v2/organization': 401 } }) })).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.message).toBe('Qonto: HTTP 401 bei /v2/organization (Schlüssel prüfen)');
    expect(err.message).not.toContain('SECRET');
    expect(err.message).not.toContain('LOGIN');
  });

  test('400 und Netzfehler enthalten weder Login noch Secret', async () => {
    const bad = (async () => Response.json({ message: 'Fehler LOGIN:SECRET LOGIN SECRET' }, { status: 400 })) as unknown as typeof fetch;
    const e400 = await pullQonto(null, ctx({ fetch: bad })).catch((e) => e);
    const down = (async () => { throw new Error('connect LOGIN:SECRET'); }) as unknown as typeof fetch;
    const eNet = await pullQonto(null, ctx({ fetch: down })).catch((e) => e);
    for (const e of [e400, eNet]) {
      expect(e).toBeInstanceOf(ConnectorError);
      expect(e.message).not.toMatch(/LOGIN|SECRET/);
    }
    expect(e400.message).toContain('HTTP 400 bei /v2/organization');
    expect(eNet.message).toBe('Qonto: keine Verbindung');
  });
});
