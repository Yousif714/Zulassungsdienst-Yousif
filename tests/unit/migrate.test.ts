import { describe, expect, test } from 'vitest';
import { migrateState } from '@/domain/migrate';
import { CONNECTION_CATALOG, HOW_TO, contractSources } from '@/domain/connections';
import { normalizeIban } from '@/domain/matching/payments';
import { fromRows, toRows } from '@/server/db/tables';
import { loadInitial, STORE_KEY } from '@/data/store';
import type { AppState, ConnectionId } from '@/domain/types';
import { IBAN_KAYA, NOW_0930, base, ins, stateWith, tx } from './helpers';
import { memStorage } from './import/helpers';

const legacy = (): AppState => {
  const s = stateWith({ payments: [tx({ connectionId: 'bank' as ConnectionId, iban: 'de89 3704 0044 0532 0130 00' })],
    ibanLinks: [{ iban: 'DE89 3704 0044 0532 0130 00', contactId: 'm-kaya', confirmedAt: 'x' }],
    insights: [{ ...ins('k1', { needsSources: ['bank' as ConnectionId, 'stripe_nexus'] }), status: 'open', createdAt: 'x' }] });
  return { ...s, connections: [...s.connections.filter((c) => c.id !== 'bank_qonto'), { id: 'bank' as ConnectionId, company: null, label: 'Bankkonto', status: 'error', lastSuccessAt: '2026-11-01T00:00:00Z', lastError: 'x' }] };
};

describe('migrateState', () => {
  test('bank → bank_qonto, Status und Zeit bleiben', () => {
    const c = migrateState(legacy()).connections.find((x) => x.id === 'bank_qonto')!;
    expect(c).toMatchObject({ label: 'Qonto (NEXUS)', company: 'nexus', status: 'error', lastSuccessAt: '2026-11-01T00:00:00Z' });
    expect(migrateState(legacy()).connections.some((x) => (x.id as string) === 'bank')).toBe(false);
  });
  test('bank wird gelöscht, wenn bank_qonto schon existiert', () => {
    const s = legacy();
    const withBoth = { ...s, connections: [...s.connections, { id: 'bank_qonto' as ConnectionId, company: 'nexus' as const, label: 'Qonto (NEXUS)', status: 'connected' as const, lastSuccessAt: 'y' }] };
    const m = migrateState(withBoth).connections;
    expect(m.filter((x) => x.id === 'bank_qonto')).toHaveLength(1);
    expect(m.find((x) => x.id === 'bank_qonto')!.lastSuccessAt).toBe('y');
    expect(m.some((x) => (x.id as string) === 'bank')).toBe(false);
  });
  test('Zahlungen, IBAN-Links, Hinweise migriert, nichts verloren', () => {
    const m = migrateState(legacy());
    expect(m.payments).toHaveLength(1);
    expect(m.payments[0]).toMatchObject({ connectionId: 'bank_qonto', iban: IBAN_KAYA });
    expect(m.ibanLinks).toEqual([{ iban: IBAN_KAYA, contactId: 'm-kaya', confirmedAt: 'x' }]);
    expect(m.insights[0].needsSources).toEqual(['bank_qonto', 'stripe_nexus']);
  });
  test('doppelte IBAN-Links: der erste bleibt', () => {
    const s = stateWith({ ibanLinks: [{ iban: IBAN_KAYA, contactId: 'm-kaya', confirmedAt: 'a' }, { iban: 'de89 3704 0044 0532 0130 00', contactId: 'm-yilmaz', confirmedAt: 'b' }] });
    expect(migrateState(s).ibanLinks).toEqual([{ iban: IBAN_KAYA, contactId: 'm-kaya', confirmedAt: 'a' }]);
  });
  test('idempotent', () => expect(migrateState(migrateState(legacy()))).toEqual(migrateState(legacy())));
  test('nichts zu tun → dasselbe Objekt', () => { const s = stateWith(); expect(migrateState(s)).toBe(s); });
  test('fromRows migriert', () => expect(fromRows(toRows(legacy())).connections.map((c) => c.id)).toContain('bank_qonto'));
  test('loadInitial migriert gespeicherten Demo-Stand', () => {
    const st = memStorage({ [STORE_KEY]: JSON.stringify(legacy()) });
    expect(loadInitial(st, '', NOW_0930).state.payments[0].connectionId).toBe('bank_qonto');
  });
});
test('Katalog: Qonto und Sparkasse', () => {
  expect(CONNECTION_CATALOG.find((c) => c.id === 'bank_sparkasse')).toMatchObject({ company: 'zulassung', label: 'Sparkasse (Zulassung)' });
  expect(HOW_TO.bank_sparkasse).toBe('Kommt als Upload (CAMT- oder CSV-Export).');
  expect(contractSources(base)).toEqual(['bank_qonto']);
});
test('normalizeIban', () => expect(normalizeIban(' de89 3704\t0044 0532 0130 00 ')).toBe(IBAN_KAYA));
