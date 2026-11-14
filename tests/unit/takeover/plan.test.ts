import { describe, expect, test } from 'vitest';
import {
  checkCompletion, paymentLinkUrl, phaseStartUnix, planEndDate, planPrices, publicPlanView, schedulePhases, takeoverToken,
} from '@/domain/takeover/plan';
import type { TakeoverPhase } from '@/domain/takeover/plan';
import type { Installment, IsoDate } from '@/domain/types';

const r = (no: number, dueDate: IsoDate, amountCents: number): Installment => ({ no, dueDate, amountCents });
const sum = (rates: Installment[]): number => rates.reduce((x, i) => x + i.amountCents, 0);
/** Was Stripe insgesamt abbucht: Lücken nichts, Monatsphasen je Monat, Datumsphasen (kürzer als ein Monat) einmal. */
const chargedTotal = (phases: TakeoverPhase[]): number =>
  phases.reduce((x, p) => x + (p.trial ? 0 : 'months' in p.end ? p.amountCents * p.end.months : p.amountCents), 0);

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
  test('nur überfällige Raten: eine Sofort-Phase über 14 Tage (kürzer als ein Abrechnungszeitraum)', () => {
    const phases = schedulePhases([r(1, '2027-02-01', 120000)], '2027-02-01');
    expect(phases).toEqual([{ start: 'now', end: { date: '2027-02-15' }, amountCents: 120000 }]);
    expect(chargedTotal(phases)).toBe(120000);
  });
  test('keine Raten → keine Phasen', () => expect(schedulePhases([], '2026-11-13')).toEqual([]));
});

describe('checkCompletion', () => {
  test('Link nach erster Fälligkeit genutzt: überfällige Rate sofort, Rest nach Plan (nächste Fälligkeit < 14 Tage → Ende dort)', () => {
    const rates = [r(1, '2026-12-01', 45000), r(2, '2027-01-01', 30000)];
    const res = checkCompletion(rates, 75000, '2026-12-20');
    expect(res).toEqual({ ok: true, phases: [
      { start: 'now', end: { date: '2027-01-01' }, amountCents: 45000 }, { start: '2027-01-01', end: { months: 1 }, amountCents: 30000 }] });
    expect(res.ok && chargedTotal(res.phases)).toBe(sum(rates));
  });
  test('Sofort-Phase endet nach 14 Tagen, Lücke bis zur nächsten Fälligkeit (Tag 31: 28.02. → 31.03.)', () => {
    const rates = [r(1, '2027-02-28', 45000), r(2, '2027-03-31', 30000)];
    const res = checkCompletion(rates, 75000, '2027-02-28');
    expect(res).toEqual({ ok: true, phases: [
      { start: 'now', end: { date: '2027-03-14' }, amountCents: 45000 },
      { start: '2027-03-14', end: { date: '2027-03-31' }, amountCents: 30000, trial: true },
      { start: '2027-03-31', end: { months: 1 }, amountCents: 30000 }] });
    // Rückstand genau einmal: eine einzige nicht-Lücken-Phase mit 45000
    expect(res.ok && res.phases.filter((p) => !p.trial && p.amountCents === 45000)).toHaveLength(1);
    expect(res.ok && chargedTotal(res.phases)).toBe(sum(rates));
    expect(phaseStartUnix('2027-03-31')).toBe(Date.parse('2027-03-31T05:00:00Z') / 1000);
  });
  test('Abschluss am Fälligkeitstag vor 07:00 Berlin: Rate des Tages sofort, kein zweiter Einzug vor der nächsten Fälligkeit', () => {
    // 01.12. 06:30 Berlin: Kalendertag = Fälligkeitstag → Rate 1 gilt als fällig und wird sofort eingezogen
    const rates = [r(1, '2026-12-01', 30000), r(2, '2027-01-01', 30000), r(3, '2027-02-01', 30000)];
    const res = checkCompletion(rates, 90000, '2026-12-01');
    expect(res).toEqual({ ok: true, phases: [
      { start: 'now', end: { date: '2026-12-15' }, amountCents: 30000 },
      { start: '2026-12-15', end: { date: '2027-01-01' }, amountCents: 30000, trial: true },
      { start: '2027-01-01', end: { months: 2 }, amountCents: 30000 }] });
    expect(res.ok && chargedTotal(res.phases)).toBe(sum(rates));
  });
  test('Pause > 1 Monat bis zur nächsten Rate: Rückstand nur einmal, Lücke bis zur Fälligkeit', () => {
    const rates = [r(1, '2026-12-01', 45000), r(2, '2027-03-01', 30000)];
    const res = checkCompletion(rates, 75000, '2026-12-05');
    expect(res).toEqual({ ok: true, phases: [
      { start: 'now', end: { date: '2026-12-19' }, amountCents: 45000 },
      { start: '2026-12-19', end: { date: '2027-03-01' }, amountCents: 30000, trial: true },
      { start: '2027-03-01', end: { months: 1 }, amountCents: 30000 }] });
    expect(res.ok && chargedTotal(res.phases)).toBe(sum(rates));
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
  test('planEndDate: Ende per Datum und Monatsphase ab heute', () => {
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
