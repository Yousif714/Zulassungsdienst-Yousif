import { describe, expect, test } from 'vitest';
import { buildSchedule } from '@/domain/ledger/schedule';

const base = { id:'c1', contactId:'m1', totalCents:120000, installments:4, installmentCents:30000, dueDay:1, startDate:'2026-10-01', billing:'legacy', catchUpMode:'first_rate' } as const;

describe('buildSchedule', () => {
  test('vier Raten monatlich ab Start', () => expect(buildSchedule(base, []).map(i=>[i.dueDate,i.amountCents])).toEqual([['2026-10-01',30000],['2026-11-01',30000],['2026-12-01',30000],['2027-01-01',30000]]));
  test('letzte Rate fängt Rest auf', () => expect(buildSchedule({...base, totalCents:100000, installmentCents:33333, installments:3}, []).map(i=>i.amountCents)).toEqual([33333,33333,33334]));
  test('Fälligkeitstag 31 → Monatsende', () => expect(buildSchedule({...base, dueDay:31, startDate:'2027-01-31'}, []).map(i=>i.dueDate)).toEqual(['2027-01-31','2027-02-28','2027-03-31','2027-04-30']));
  test('Stundung verschiebt Raten im Zeitraum auf "bis"', () => expect(buildSchedule(base, [{kind:'deferral', from:'2026-11-01', to:'2026-11-20'}])[1].dueDate).toBe('2026-11-20'));
  test('Pause verschiebt alle folgenden Raten', () => expect(buildSchedule(base, [{kind:'pause', from:'2026-11-01', months:1}]).map(i=>i.dueDate)).toEqual(['2026-10-01','2026-12-01','2027-01-01','2027-02-01']));
  test('Fälligkeitstag ändern ab Datum', () => expect(buildSchedule(base, [{kind:'due_day_shift', from:'2026-12-01', newDueDay:5}]).map(i=>i.dueDate)).toEqual(['2026-10-01','2026-11-01','2026-12-05','2027-01-05']));
});
