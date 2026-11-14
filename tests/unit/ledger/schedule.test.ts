import { describe, expect, test } from 'vitest';
import { buildSchedule } from '@/domain/ledger/schedule';
import { allocate } from '@/domain/ledger/allocate';
import { planTakeover } from '@/domain/ledger/takeover';
import { memberStatus } from '@/domain/ledger/status';

const base = { id:'c1', contactId:'m1', totalCents:120000, installments:4, installmentCents:30000, dueDay:1, startDate:'2026-10-01', billing:'legacy', catchUpMode:'first_rate' } as const;

describe('buildSchedule', () => {
  test('vier Raten monatlich ab Start', () => expect(buildSchedule(base, []).map(i=>[i.dueDate,i.amountCents])).toEqual([['2026-10-01',30000],['2026-11-01',30000],['2026-12-01',30000],['2027-01-01',30000]]));
  test('letzte Rate fängt Rest auf', () => expect(buildSchedule({...base, totalCents:100000, installmentCents:33333, installments:3}, []).map(i=>i.amountCents)).toEqual([33333,33333,33334]));
  test('Fälligkeitstag 31 → Monatsende', () => expect(buildSchedule({...base, dueDay:31, startDate:'2027-01-31'}, []).map(i=>i.dueDate)).toEqual(['2027-01-31','2027-02-28','2027-03-31','2027-04-30']));
  test('Stundung verschiebt Raten im Zeitraum auf "bis"', () => expect(buildSchedule(base, [{kind:'deferral', from:'2026-11-01', to:'2026-11-20'}])[1].dueDate).toBe('2026-11-20'));
  test('Pause verschiebt alle folgenden Raten', () => expect(buildSchedule(base, [{kind:'pause', from:'2026-11-01', months:1}]).map(i=>i.dueDate)).toEqual(['2026-10-01','2026-12-01','2027-01-01','2027-02-01']));
  test('Fälligkeitstag ändern ab Datum', () => expect(buildSchedule(base, [{kind:'due_day_shift', from:'2026-12-01', newDueDay:5}]).map(i=>i.dueDate)).toEqual(['2026-10-01','2026-11-01','2026-12-05','2027-01-05']));
  const plan = (paidCents: number, rates: { no: number; dueDate: string; amountCents: number }[]) => ({ takeoverId: 'tk1', paidCents, rates });
  test('nach Umstellung: bezahlter Teil + Plan-Raten, neu nummeriert', () => {
    const c = { ...base, plan: plan(45000, [{ no: 1, dueDate: '2026-12-01', amountCents: 45000 }, { no: 2, dueDate: '2027-01-01', amountCents: 30000 }]) };
    expect(buildSchedule(c, [])).toEqual([
      { no: 1, dueDate: '2026-10-01', amountCents: 30000 },
      { no: 2, dueDate: '2026-11-01', amountCents: 15000 },
      { no: 3, dueDate: '2026-12-01', amountCents: 45000 },
      { no: 4, dueDate: '2027-01-01', amountCents: 30000 },
    ]);
  });
  test('paidCents 0: nur Plan-Raten', () => {
    const rates = [{ no: 1, dueDate: '2026-12-01', amountCents: 120000 }];
    expect(buildSchedule({ ...base, plan: plan(0, rates) }, [])).toEqual(rates);
  });
  test('Ausnahmen wirken auf den bezahlten Teil, Plan-Raten bleiben unverändert', () => {
    const rates = [{ no: 1, dueDate: '2026-12-01', amountCents: 90000 }];
    const out = buildSchedule({ ...base, plan: plan(30000, rates) }, [{ kind: 'deferral', from: '2026-10-01', to: '2026-10-20' }]);
    expect(out).toEqual([{ no: 1, dueDate: '2026-10-20', amountCents: 30000 }, { no: 2, dueDate: '2026-12-01', amountCents: 90000 }]);
  });
  test('Referenz 4a: 1.200 € = 4 × 300 €, 450 € gezahlt → Rückstand 0, offen 750 € nach Umstellung', () => {
    const before = allocate(buildSchedule(base, []), [{ bookedOn: '2026-10-02', amountCents: 30000 }, { bookedOn: '2026-11-03', amountCents: 15000 }]);
    const tp = planTakeover(before.states, '2026-11-12', 'first_rate');
    expect(tp.rates).toEqual([{ no: 1, dueDate: '2026-12-01', amountCents: 45000 }, { no: 2, dueDate: '2027-01-01', amountCents: 30000 }]);
    const sched = buildSchedule({ ...base, plan: { takeoverId: 'tk1', paidCents: 45000, rates: tp.rates } }, []);
    expect(sched.reduce((a, r) => a + r.amountCents, 0)).toBe(120000);
    const after = allocate(sched, [{ bookedOn: '2026-10-02', amountCents: 30000 }, { bookedOn: '2026-11-03', amountCents: 15000 }]);
    const st = memberStatus(after.states, 0, '2026-11-12');
    expect([st.arrearsCents, st.openCents]).toEqual([0, 75000]);
  });
});
