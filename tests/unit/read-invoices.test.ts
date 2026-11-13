import { beforeEach, expect, test } from 'vitest';
import { DemoProvider } from '@/domain/actions/demo-provider';
import { InvoiceReadError, type InvoiceReader } from '@/domain/ai-port';
import type { AppState, Invoice } from '@/domain/types';
import { createMemoryRepos } from '@/server/db/memory';
import type { Repos } from '@/server/db/repository';
import { diffState } from '@/server/db/tables';
import { readInvoices } from '@/server/read-invoices';
import { okResult, readInv, reading } from './import/reading-fixtures';

const NOW = new Date('2026-11-12T10:00:00Z');
let repos: Repos;
beforeEach(() => { repos = createMemoryRepos(); });

const contact = { id: 'm-x', company: 'nexus' as const, kind: 'member' as const, name: 'Erika Beispiel', phones: [], emails: ['erika@example.de'], externalRefs: [{ connectionId: 'lexware_nexus' as const, externalId: 'c-77' }] };
const invs = (n: number): Invoice[] => Array.from({ length: n }, (_, k) => readInv({ id: `i${k}`, externalId: `lex-${k}`, number: `RE-90${k}`, issuedOn: `2026-10-0${k + 1}` }));
async function seed(patch: Partial<AppState>): Promise<void> {
  const { state, revision } = await repos.state.load();
  const next = { ...state, contacts: [...state.contacts, contact], ...patch };
  const r = await repos.state.save(diffState(state, next), revision);
  if (!r.ok) throw new Error('seed');
}
const load = async () => (await repos.state.load()).state;
const fakeReader = (p: { fail?: InvoiceReadError; failOn?: string; delayMs?: number } = {}, clock?: { t: number }): InvoiceReader & { calls: string[]; timeouts: number[] } => {
  const calls: string[] = [];
  const timeouts: number[] = [];
  return {
    model: 'fake', calls, timeouts,
    read: async (i, o) => {
      calls.push(i.number); timeouts.push(o.timeoutMs);
      if (clock && p.delayMs) clock.t += p.delayMs;
      if (p.fail && (!p.failOn || p.failOn === i.number)) throw p.fail;
      return { result: okResult(), model: 'fake', inputTokens: 1000, outputTokens: 500 };
    },
  };
};
const run = (reader: InvoiceReader, clock = { t: 0 }) =>
  readInvoices(repos, { at: () => NOW, now: () => clock.t, deadline: 40_000, reader, provider: new DemoProvider() });

test('liest höchstens 5 Rechnungen pro Lauf, Rest im nächsten', async () => {
  await seed({ invoices: invs(7) });
  const r1 = fakeReader();
  expect(await run(r1)).toBe('partial');
  expect(r1.calls).toEqual(['RE-900', 'RE-901', 'RE-902', 'RE-903', 'RE-904']);
  const r2 = fakeReader();
  expect(await run(r2)).toBe('ok');
  expect(r2.calls).toEqual(['RE-905', 'RE-906']);
  const s = await load();
  expect(s.contracts).toHaveLength(7);
  expect(s.invoiceReadings.every((x) => x.costMicroCents === 1_400_000 && x.model === 'fake')).toBe(true);
});

test('Zeitbudget 15 s: ab Fristablauf kein weiterer Aufruf, timeoutMs = Restzeit', async () => {
  await seed({ invoices: invs(3) });
  const clock = { t: 0 };
  const r = fakeReader({ delayMs: 8000 }, clock);
  expect(await run(r, clock)).toBe('partial');
  expect(r.calls).toHaveLength(2);
  expect(r.timeouts).toEqual([15_000, 7000]);
});

test('Review 4: Limit mitten im Lauf → kein weiterer Aufruf, Hinweis', async () => {
  await seed({ invoices: invs(3), invoiceReadings: [reading({ id: 'alt', invoiceId: 'x', readAt: '2026-11-01T10:00:00Z', costMicroCents: 9_998_600_000 })] });
  const r = fakeReader();
  expect(await run(r)).toBe('partial');
  expect(r.calls).toHaveLength(1);
  expect((await load()).connections.find((c) => c.id === 'claude_invoices')).toMatchObject({ status: 'connected', lastError: 'Monatslimit erreicht' });
});

test('nicht fataler Fehler → Lesung error, nächste Rechnung wird gelesen; fataler → Abbruch, Verbindung Störung', async () => {
  await seed({ invoices: invs(2) });
  const r = fakeReader({ fail: new InvoiceReadError('Claude ausgelastet (429)', false), failOn: 'RE-900' });
  expect(await run(r)).toBe('ok');
  expect(r.calls).toEqual(['RE-900', 'RE-901']);
  expect((await load()).invoiceReadings.map((x) => [x.invoiceId, x.outcome])).toEqual([['i0', 'error'], ['i1', 'applied']]);
  const f = fakeReader({ fail: new InvoiceReadError('Claude-Schlüssel ungültig oder ohne Rechte', true) });
  expect(await run(f)).toBe('error');
  expect(f.calls).toEqual(['RE-900']);
  expect((await load()).connections.find((c) => c.id === 'claude_invoices')).toMatchObject({ status: 'error', lastError: 'Claude-Schlüssel ungültig oder ohne Rechte' });
});

test('Rechnung nach Vertragsanlage geändert (neue sourceUpdatedAt) → nicht neu gelesen', async () => {
  await seed({ invoices: invs(1) });
  await run(fakeReader());
  const { state, revision } = await repos.state.load();
  await repos.state.save(diffState(state, { ...state, invoices: state.invoices.map((i) => ({ ...i, sourceUpdatedAt: '2026-11-05T00:00:00Z' })) }), revision);
  const r = fakeReader();
  expect(await run(r)).toBe('ok');
  expect(r.calls).toEqual([]);
});

test('unerwartete Ausnahme → error, Verbindung Störung mit festem Text', async () => {
  await seed({ invoices: invs(1) });
  const boom: InvoiceReader = { model: 'x', read: async () => { throw new Error('geheim'); } };
  expect(await run(boom)).toBe('error');
  expect((await load()).connections.find((c) => c.id === 'claude_invoices')).toMatchObject({ status: 'error', lastError: 'Unbekannter Fehler' });
});
