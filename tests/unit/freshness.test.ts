import { describe, expect, test } from 'vitest';
import { ageMinutes, ageText, areaStale, sourceFreshness, staleAfterMinutes } from '@/domain/freshness';
import { NOW_0930, conn } from './helpers';

describe('Datenstand', () => {
  test('stale nach 45 Min.', () => {
    expect(sourceFreshness(conn({ lastSuccessAt: '2026-11-12T07:40:00Z' }), NOW_0930)).toBe('stale');
    expect(sourceFreshness(conn({ lastSuccessAt: '2026-11-12T08:00:00Z' }), NOW_0930)).toBe('fresh');
  });
  test('portal_nexus ist 29 Tage nach dem Import frisch, nach 31 Tagen veraltet; andere nach 46 Min. veraltet', () => {
    const at = new Date('2026-11-12T08:30:00Z');
    const c = conn({ id: 'portal_nexus', status: 'connected', lastSuccessAt: '2026-10-14T08:30:00Z' });
    expect(sourceFreshness(c, at)).toBe('fresh');
    expect(sourceFreshness({ ...c, lastSuccessAt: '2026-10-12T08:00:00Z' }, at)).toBe('stale');
    expect(sourceFreshness(conn({ id: 'lexware_nexus', status: 'connected', lastSuccessAt: '2026-11-12T07:44:00Z' }), at)).toBe('stale');
  });
  test('ageText: Minuten, dann Datum, sonst nie abgerufen', () => {
    expect(ageText(conn({ lastSuccessAt: '2026-11-12T08:20:00Z' }), NOW_0930)).toBe('Stand vor 10 Min.');
    expect(ageText(conn({ lastSuccessAt: '2026-11-01T09:00:00Z' }), NOW_0930)).toBe('Stand vom 01.11.2026, 10:00 Uhr');
    expect(ageText(conn({ lastSuccessAt: null }), NOW_0930)).toBe('Noch nie abgerufen');
  });
  test('Fehler, fehlend, nie abgerufen', () => {
    expect(sourceFreshness(conn({ status: 'error' }), NOW_0930)).toBe('error');
    expect(sourceFreshness(conn({ status: 'missing', lastSuccessAt: null }), NOW_0930)).toBe('missing');
    expect(sourceFreshness(conn({ lastSuccessAt: null }), NOW_0930)).toBe('stale');
  });
  test('areaStale liefert die veralteten Quellen', () => {
    const cs = [conn({ id: 'bank_qonto' }), conn({ id: 'gmail', status: 'error' }), conn({ id: 'calendar', lastSuccessAt: '2026-11-12T01:00:00Z' })];
    expect(areaStale(['bank_qonto', 'gmail', 'calendar'], cs, NOW_0930)).toEqual(['gmail', 'calendar']);
  });
  test('ageMinutes: ganze Minuten seit dem letzten Abruf, null ohne Abruf', () => {
    expect(ageMinutes(conn({ lastSuccessAt: '2026-11-12T08:20:00Z' }), NOW_0930)).toBe(10);
    expect(ageMinutes(conn({ lastSuccessAt: '2026-11-12T08:29:30Z' }), NOW_0930)).toBe(0);
    expect(ageMinutes(conn({ lastSuccessAt: null }), NOW_0930)).toBeNull();
  });
});

test('Sparkasse gilt 7 Tage als frisch', () => {
  expect(staleAfterMinutes('bank_sparkasse')).toBe(10080);
  expect(sourceFreshness(conn({ id: 'bank_sparkasse', lastSuccessAt: '2026-11-06T09:00:00Z' }), NOW_0930)).toBe('fresh');
  expect(sourceFreshness(conn({ id: 'bank_sparkasse', lastSuccessAt: '2026-11-04T09:00:00Z' }), NOW_0930)).toBe('stale');
});
