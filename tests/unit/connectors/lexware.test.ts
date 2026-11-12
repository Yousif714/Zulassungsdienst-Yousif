import { describe, expect, test } from 'vitest';

import { fixtureFetch } from '@/server/connectors/fixture-fetch';
import { pullLexware } from '@/server/connectors/lexware';
import type { PullContext } from '@/server/connectors/types';
import { idOf, lexwareRoutes, lexwareRoutesPaged, lexwareRoutesZulassung, updatedOf } from '../../fixtures';

const NOW = Date.parse('2026-11-12T10:00:00Z');
const ctx = (o: Partial<PullContext> = {}): PullContext => ({
  fetch: fixtureFetch(lexwareRoutes), key: 'lx_SECRET', sleep: async () => {}, now: () => NOW, deadline: NOW + 60_000, known: new Map(), ...o,
});
const counterBudget = (n: number): Pick<PullContext, 'now' | 'deadline'> => {
  let t = NOW;
  return { now: () => (t += 1000), deadline: NOW + n * 1000 };
};
const numbers = (r: { batch: { invoices: { number: string }[] } }) => r.batch.invoices.map((i) => i.number);
const ALL = ['RE-1043', 'RE-1051', 'RE-1060', 'RE-1100', 'RE-1101', 'RE-1102', 'RE-1110'];

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
    expect(vl).toContain('voucherDateFrom=2026-08-01');
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

  test('Abbruch am Budget, Fortsetzung über Cursor und known', async () => {
    const first = await pullLexware('lexware_nexus', null, ctx({ fetch: fixtureFetch(lexwareRoutesPaged), ...counterBudget(5) }));
    expect(first.complete).toBe(false);
    expect(first.cursor).not.toBeNull();
    expect(first.batch.invoices.length).toBeLessThan(ALL.length);
    const known = new Map(first.batch.invoices.map((i) => [i.externalId, i.sourceUpdatedAt]));
    const calls: string[] = [];
    const second = await pullLexware('lexware_nexus', first.cursor, ctx({ fetch: fixtureFetch(lexwareRoutesPaged, { calls }), known }));
    expect(second.complete).toBe(true);
    for (const i of first.batch.invoices) expect(calls).not.toContain(`/v1/invoices/${i.externalId}`);
    expect(new Set([...numbers(first), ...numbers(second)])).toEqual(new Set(ALL));
  });

  test('Fehler tragen den Schlüssel nicht', async () => {
    const f = (async () => new Response('{"message":"bad lx_SECRET"}', { status: 401 })) as typeof fetch;
    const err = await pullLexware('lexware_nexus', null, ctx({ fetch: f })).then(() => { throw new Error('kein Fehler'); }, (e: Error) => e);
    expect(err.message).toBe('Lexware: HTTP 401 bei /v1/contacts (Schlüssel prüfen)');
  });
});
