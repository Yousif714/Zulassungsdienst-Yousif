import { describe, expect, test } from 'vitest';

import { fixtureFetch } from '@/server/connectors/fixture-fetch';
import { pullLexware } from '@/server/connectors/lexware';
import type { PullContext } from '@/server/connectors/types';
import { idOf, lexwareRoutes, lexwareRoutesPaged, lexwareRoutesZulassung, updatedOf } from '../../fixtures';

const NOW = Date.parse('2026-11-12T10:00:00Z');
const ctx = (o: Partial<PullContext> = {}): PullContext => ({
  fetch: fixtureFetch(lexwareRoutes), key: 'lx_SECRET', sleep: async () => {}, now: () => NOW, deadline: NOW + 60_000, known: new Map(), ...o,
});
/** Budget über die Zahl der Anfragen: nach `n` fetch-Aufrufen ist `now()` hinter der Deadline. */
const limitFetches = (routes: Record<string, unknown>, n: number) => {
  const inner = fixtureFetch(routes);
  let count = 0;
  const f = ((i: RequestInfo | URL, init?: RequestInit) => { count++; return inner(i, init); }) as typeof fetch;
  return { o: { fetch: f, now: () => (count >= n ? NOW + 1_000_000 : NOW), deadline: NOW + 60_000 } };
};
const numbers = (r: { batch: { invoices: { number: string }[] } }) => r.batch.invoices.map((i) => i.number);
const ALL = ['RE-1043', 'RE-1051', 'RE-1060', 'RE-1100', 'RE-1101', 'RE-1102', 'RE-1110'];

test('Belegliste fragt voucherStatus=any (gültig für jeden Belegtyp), Entwürfe filtert der Connector', async () => {
  const { lexwareVoucherlistQuery } = await import('@/server/connectors/lexware');
  const q = new URLSearchParams(lexwareVoucherlistQuery(0));
  expect(q.get('voucherType')).toBe('invoice');
  expect(q.get('voucherStatus')).toBe('any');
  expect(q.get('voucherDateFrom')).toBe('2026-06-01');
});

test('anhaltendes 429 mitten in den Details → Teilergebnis mit Cursor statt Fehler; Folgelauf liefert den Rest', async () => {
  const inner = fixtureFetch(lexwareRoutesPaged);
  let n = 0;
  // Kontakte, Liste 0, 3 Details gehen durch; danach antwortet Lexware dauerhaft 429.
  const f = ((i: RequestInfo | URL, init?: RequestInit) => (++n > 5 ? Promise.resolve(new Response('{}', { status: 429 })) : inner(i, init))) as typeof fetch;
  const first = await pullLexware('lexware_nexus', null, ctx({ fetch: f }));
  expect(first.complete).toBe(false);
  expect(first.cursor).not.toBeNull();
  expect(first.batch.invoices).toHaveLength(3);
  const known = new Map(first.batch.invoices.map((i) => [i.externalId, updatedOf(i.number)]));
  const second = await pullLexware('lexware_nexus', first.cursor, ctx({ fetch: fixtureFetch(lexwareRoutesPaged), known }));
  expect(second.complete).toBe(true);
  expect([...numbers(first), ...numbers(second)].sort()).toEqual(ALL);
});

describe('pullLexware', () => {
  test('Kontakte, dann Rechnungen; Details nur für Neues', async () => {
    const calls: string[] = [];
    const known = new Map([[idOf('RE-1043'), updatedOf('RE-1043')]]);
    const r = await pullLexware('lexware_nexus', null, ctx({ fetch: fixtureFetch(lexwareRoutes, { calls }), known }));
    expect(calls.filter((c) => c.startsWith('/v1/invoices/'))).not.toContain(`/v1/invoices/${idOf('RE-1043')}`);
    expect(numbers(r)).toEqual(expect.arrayContaining(['RE-1051', 'RE-1060', 'RE-1100', 'RE-1101', 'RE-1102']));
    expect(numbers(r)).not.toContain('RE-1043');
    expect(r.batch.contacts.map((c) => c.name)).toContain('Murat Demir');
    expect(r.complete).toBe(true);
    expect(r.cursor).toBeNull();
    expect(calls.findIndex((c) => c.startsWith('/v1/contacts'))).toBeLessThan(calls.findIndex((c) => c.startsWith('/v1/voucherlist')));
  });

  test('Voucherlist: Filter ab IMPORT_SINCE, ohne draft; Schlüssel nur im Header', async () => {
    const calls: string[] = [];
    await pullLexware('lexware_nexus', null, ctx({ fetch: fixtureFetch(lexwareRoutes, { calls }) }));
    const vl = calls.find((c) => c.startsWith('/v1/voucherlist'))!;
    expect(vl).toContain('voucherType=invoice');
    expect(vl).toContain('voucherDateFrom=2026-06-01');
    expect(vl).not.toContain('draft');
    expect(calls.join()).not.toContain('SECRET');
  });

  test('Voucherlist ist maßgeblich für Status, Fälligkeit und Restbetrag', async () => {
    const entry = { id: idOf('RE-1100'), voucherType: 'invoice', voucherStatus: 'paid', voucherNumber: 'RE-1100', voucherDate: '2026-09-10T00:00:00.000+02:00', updatedDate: '2026-11-02T08:00:00.000+01:00', dueDate: '2026-10-01T00:00:00.000+02:00', openAmount: 0, totalAmount: 1200 };
    const partial = { ...entry, id: idOf('RE-1101'), voucherNumber: 'RE-1101', voucherStatus: 'open', openAmount: 50.5 };
    const routes = { ...lexwareRoutes, '/v1/voucherlist': { content: [entry, partial], last: true, totalPages: 1 } };
    const r = await pullLexware('lexware_nexus', null, ctx({ fetch: fixtureFetch(routes) }));
    const byNr = Object.fromEntries(r.batch.invoices.map((i) => [i.number, i]));
    expect(byNr['RE-1100']).toMatchObject({ status: 'paid', openCents: 0, dueDate: '2026-10-01', sourceUpdatedAt: '2026-11-02T08:00:00.000+01:00' });
    expect(byNr['RE-1101']).toMatchObject({ status: 'open', openCents: 5050 });
  });

  test('Draft aus der Liste wird nie geholt', async () => {
    const calls: string[] = [];
    const draft = { id: 'draft-1', voucherStatus: 'draft', voucherNumber: '', updatedDate: 'x' };
    const routes = { ...lexwareRoutes, '/v1/voucherlist': { content: [draft], last: true } };
    const r = await pullLexware('lexware_nexus', null, ctx({ fetch: fixtureFetch(routes, { calls }) }));
    expect(r.batch.invoices).toEqual([]);
    expect(calls.some((c) => c.includes('draft-1'))).toBe(false);
  });

  test('blättert über page bis last (Kontakte und Voucherlist)', async () => {
    const calls: string[] = [];
    const r = await pullLexware('lexware_nexus', null, ctx({ fetch: fixtureFetch(lexwareRoutesPaged, { calls }) }));
    expect(calls.filter((c) => c.startsWith('/v1/voucherlist')).map((c) => /page=(\d+)/.exec(c)![1])).toEqual(['0', '1']);
    expect([...numbers(r)].sort()).toEqual(ALL.slice().sort());
    expect(r.complete).toBe(true);
  });

  test('Zulassung-Verbindung liefert Zulassung-Daten', async () => {
    const r = await pullLexware('lexware_zulassung', null, ctx({ fetch: fixtureFetch(lexwareRoutesZulassung) }));
    expect(numbers(r)).toEqual(['RZ-500']);
    expect(r.batch.invoices[0].company).toBe('zulassung');
  });

  test('Abbruch mitten in den Details → Cursor; Folgelauf holt genau den Rest, known nicht leer', async () => {
    const lim = limitFetches(lexwareRoutesPaged, 5); // Kontakte, Liste 0, 3 Details
    const first = await pullLexware('lexware_nexus', null, ctx(lim.o));
    expect(first.complete).toBe(false);
    expect(first.batch.invoices).toHaveLength(3);
    expect(JSON.parse(first.cursor!)).toEqual({ phase: 'invoices', page: 0, since: '2026-06-01' });
    const known = new Map(first.batch.invoices.map((i) => [i.externalId, i.sourceUpdatedAt]));
    expect(known.size).toBe(3);
    const calls: string[] = [];
    const second = await pullLexware('lexware_nexus', first.cursor, ctx({ fetch: fixtureFetch(lexwareRoutesPaged, { calls }), known }));
    expect(second.complete).toBe(true);
    expect(second.cursor).toBeNull();
    expect(calls.some((c) => c.startsWith('/v1/contacts'))).toBe(false);
    for (const i of first.batch.invoices) expect(calls).not.toContain(`/v1/invoices/${i.externalId}`);
    expect(calls.filter((c) => c.startsWith('/v1/invoices/'))).toHaveLength(ALL.length - 3);
    expect(numbers(first).filter((n) => numbers(second).includes(n))).toEqual([]);
    expect([...numbers(first), ...numbers(second)].sort()).toEqual(ALL.slice().sort());
  });

  test('Cursor mit späterem oder ohne since → einmal Neustart bei den Kontakten', async () => {
    for (const since of ['2026-08-01', undefined]) {
      const calls: string[] = [];
      const old = JSON.stringify({ phase: 'invoices', page: 1, ...(since ? { since } : {}) });
      const r = await pullLexware('lexware_nexus', old, ctx({ fetch: fixtureFetch(lexwareRoutesPaged, { calls }) }));
      expect(calls[0]).toMatch(/^\/v1\/contacts/);
      expect(r.complete).toBe(true);
    }
    const calls: string[] = [];
    await pullLexware('lexware_nexus', JSON.stringify({ phase: 'invoices', page: 1, since: '2026-06-01' }), ctx({ fetch: fixtureFetch(lexwareRoutesPaged, { calls }) }));
    expect(calls[0]).toContain('page=1');
    expect(calls.some((c) => c.startsWith('/v1/contacts'))).toBe(false);
  });

  test('Eintrag ohne updatedDate wird nie übersprungen', async () => {
    const entry = { id: idOf('RE-1100'), voucherStatus: 'open', voucherNumber: 'RE-1100' };
    const routes = { ...lexwareRoutes, '/v1/voucherlist': { content: [entry], last: true } };
    const r = await pullLexware('lexware_nexus', null, ctx({ fetch: fixtureFetch(routes), known: new Map([[entry.id, undefined]]) }));
    expect(numbers(r)).toEqual(['RE-1100']);
  });

  test('Fehler tragen den Schlüssel nicht', async () => {
    const f = (async () => new Response('{"message":"bad lx_SECRET"}', { status: 401 })) as typeof fetch;
    const err = await pullLexware('lexware_nexus', null, ctx({ fetch: f })).then(() => { throw new Error('kein Fehler'); }, (e: Error) => e);
    expect(err.message).toBe('Lexware: HTTP 401 bei /v1/contacts (Schlüssel prüfen)');
  });
});
