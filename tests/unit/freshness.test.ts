import { describe, expect, test } from 'vitest';
import { ageMinutes, areaStale, sourceFreshness } from '@/domain/freshness';
import { NOW_0930, conn } from './helpers';

describe('Datenstand', () => {
  test('stale nach 45 Min.', () => {
    expect(sourceFreshness(conn({ lastSuccessAt: '2026-11-12T07:40:00Z' }), NOW_0930)).toBe('stale');
    expect(sourceFreshness(conn({ lastSuccessAt: '2026-11-12T08:00:00Z' }), NOW_0930)).toBe('fresh');
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
