import { describe, expect, test } from 'vitest';
import {
  checkCompletion, paymentLinkUrl, phaseStartUnix, planEndDate, planPrices, publicPlanView, schedulePhases, takeoverToken,
} from '@/domain/takeover/plan';
import type { Installment, IsoDate } from '@/domain/types';

const r = (no: number, dueDate: IsoDate, amountCents: number): Installment => ({ no, dueDate, amountCents });

describe('schedulePhases', () => {
  test('gleiche Raten im Monatsabstand → eine Phase', () => {
    expect(schedulePhases([r(1, '2026-12-01', 30000), r(2, '2027-01-01', 30000), r(3, '2027-02-01', 30000)], '2026-11-13'))
      .toEqual([{ start: '2026-12-01', end: { months: 3 }, amountCents: 30000 }]);
  });
  test('erste Rate höher (first_rate) → zwei Phasen', () => {
    expect(schedulePhases([r(1, '2026-12-01', 45000), r(2, '2027-01-01', 30000)], '2026-11-13'))
      .toEqual([{ start: '2026-12-01', end: { months: 1 }, amountCents: 45000 }, { start: '2027-01-01', end: { months: 1 }, amountCents: 30000 }]);
  });
  test('Fälligkeitstag 31 über Februar bleibt ein Lauf', () => {
    expect(schedulePhases([r(1, '2027-01-31', 10000), r(2, '2027-02-28', 10000), r(3, '2027-03-31', 10000)], '2027-01-01'))
      .toEqual([{ start: '2027-01-31', end: { months: 3 }, amountCents: 10000 }]);
  });
  test('Pause: Lücken-Phase ohne Abbuchung', () => {
    expect(schedulePhases([r(1, '2026-12-01', 30000), r(2, '2027-03-01', 30000)], '2026-11-13')).toEqual([
      { start: '2026-12-01', end: { months: 1 }, amountCents: 30000 },
      { start: '2027-01-01', end: { date: '2027-03-01' }, amountCents: 30000, trial: true },
      { start: '2027-03-01', end: { months: 1 }, amountCents: 30000 }]);
  });
  test('Abstand unter einem Monat: Phase endet am nächsten Fälligkeitstag', () => {
    expect(schedulePhases([r(1, '2026-12-15', 30000), r(2, '2027-01-01', 30000)], '2026-11-13')).toEqual([
      { start: '2026-12-15', end: { date: '2027-01-01' }, amountCents: 30000 },
      { start: '2027-01-01', end: { months: 1 }, amountCents: 30000 }]);
  });
  test('Lauf mit zu frühem Nachfolger: letzte Rate des Laufs wird eigene Phase', () => {
    expect(schedulePhases([r(1, '2026-12-15', 30000), r(2, '2027-01-15', 30000), r(3, '2027-02-01', 20000)], '2026-11-13')).toEqual([
      { start: '2026-12-15', end: { months: 1 }, amountCents: 30000 },
      { start: '2027-01-15', end: { date: '2027-02-01' }, amountCents: 30000 },
      { start: '2027-02-01', end: { months: 1 }, amountCents: 20000 }]);
  });
  test('nur überfällige Raten: eine Sofort-Phase über einen Monat', () => {
    expect(schedulePhases([r(1, '2027-02-01', 120000)], '2027-02-01'))
      .toEqual([{ start: 'now', end: { months: 1 }, amountCents: 120000 }]);
  });
  test('keine Raten → keine Phasen', () => expect(schedulePhases([], '2026-11-13')).toEqual([]));
});

describe('checkCompletion', () => {
  test('Link nach erster Fälligkeit genutzt: überfällige Rate sofort, Rest nach Plan', () => {
    expect(checkCompletion([r(1, '2026-12-01', 45000), r(2, '2027-01-01', 30000)], 75000, '2026-12-05')).toEqual({ ok: true, phases: [
      { start: 'now', end: { date: '2027-01-01' }, amountCents: 45000 }, { start: '2027-01-01', end: { months: 1 }, amountCents: 30000 }] });
  });
  test('inzwischen überwiesen → nicht ok', () => {
    expect(checkCompletion([r(1, '2026-12-01', 45000), r(2, '2027-01-01', 30000)], 45000, '2026-11-20')).toEqual({ ok: false });
  });
  test('leerer Plan → nicht ok', () => expect(checkCompletion([], 0, '2026-11-20')).toEqual({ ok: false }));
});

describe('Zeitpunkte und Preise', () => {
  test('planEndDate: Start Winter, Ende Sommer, Tag 31', () => {
    expect(planEndDate([{ start: '2027-01-31', end: { months: 3 }, amountCents: 1 }], '2027-01-01')).toBe('2027-04-30');
  });
  test('planEndDate: Ende per Datum und Sofort-Phase ab heute', () => {
    expect(planEndDate([{ start: '2026-12-15', end: { date: '2027-01-01' }, amountCents: 1 }], '2026-11-13')).toBe('2027-01-01');
    expect(planEndDate([{ start: 'now', end: { months: 1 }, amountCents: 1 }], '2027-01-31')).toBe('2027-02-28');
  });
  test('phaseStartUnix: 07:00 Berlin (Winter und Sommer)', () => {
    expect(phaseStartUnix('2026-12-01')).toBe(Date.parse('2026-12-01T06:00:00Z') / 1000);
    expect(phaseStartUnix('2027-06-01')).toBe(Date.parse('2027-06-01T05:00:00Z') / 1000);
    expect(phaseStartUnix('now')).toBe('now');
  });
  test('planPrices: Beträge aller Phasen', () => {
    expect(planPrices([r(1, '2026-12-01', 45000), r(2, '2027-01-01', 30000), r(3, '2027-02-01', 30000)], '2026-11-13')).toEqual([45000, 30000]);
  });
});

describe('Token und Link', () => {
  test('Token 64 Hex, Link ohne doppelten Schrägstrich', () => {
    let i = 0; const t = takeoverToken(() => `0000000${i++}-aaaa-bbbb-cccc-dddddddddddd`);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(t).toBe('00000000aaaabbbbccccdddddddddddd00000001aaaabbbbccccdddddddddddd');
    expect(paymentLinkUrl('https://nexus.example.de/', t)).toBe(`https://nexus.example.de/zahlung/${t}`);
    expect(paymentLinkUrl('https://nexus.example.de', t)).toBe(`https://nexus.example.de/zahlung/${t}`);
  });
});

describe('publicPlanView', () => {
  test('Anzahl, erste/letzte Abbuchung, überfällig = „sofort“', () => {
    const rates = [r(1, '2026-12-01', 45000), r(2, '2027-01-01', 30000)];
    expect(publicPlanView({ rates }, '2026-12-05')).toEqual({
      count: 2,
      rates: [{ label: 'sofort', amountCents: 45000 }, { label: '01.01.2027', amountCents: 30000 }],
      first: 'sofort', last: '01.01.2027',
    });
    expect(publicPlanView({ rates }, '2026-11-13')).toEqual({
      count: 2,
      rates: [{ label: '01.12.2026', amountCents: 45000 }, { label: '01.01.2027', amountCents: 30000 }],
      first: '01.12.2026', last: '01.01.2027',
    });
  });
});
