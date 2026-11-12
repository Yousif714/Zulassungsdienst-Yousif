import { describe, expect, test } from 'vitest';
import { buildSchedule } from '@/domain/ledger/schedule';
import { allocate } from '@/domain/ledger/allocate';
import { planTakeover } from '@/domain/ledger/takeover';
import { base } from '../helpers';

const s = buildSchedule(base, []);
const { states } = allocate(s, [{ bookedOn: '2026-10-02', amountCents: 30000 }, { bookedOn: '2026-11-03', amountCents: 15000 }]);

describe('planTakeover', () => {
  test('first_rate', () => {
    const a = planTakeover(states, '2026-11-12', 'first_rate');
    expect([a.arrearsCents, a.futureCents, a.openCents]).toEqual([15000, 60000, 75000]);
    expect(a.rates.map((r) => [r.no, r.dueDate, r.amountCents])).toEqual([[1, '2026-12-01', 45000], [2, '2027-01-01', 30000]]);
  });
  test('spread', () => expect(planTakeover(states, '2026-11-12', 'spread').rates.map((r) => r.amountCents)).toEqual([37500, 37500]));
  test('Rundungsrest auf letzte Rate', () => {
    const odd = allocate(buildSchedule({ ...base, totalCents: 100001, installmentCents: 25000 }, []), [{ bookedOn: '2026-10-01', amountCents: 25000 }]);
    const c = planTakeover(odd.states, '2026-11-12', 'spread');
    expect(c.rates.map((r) => r.amountCents)).toEqual([37500, 37501]);
    expect(c.rates.reduce((x, r) => x + r.amountCents, 0)).toBe(c.openCents);
  });
  test('keine künftige Rate, aber Rückstand', () => {
    const all = allocate(s, []);
    expect(planTakeover(all.states, '2027-02-01', 'first_rate').rates).toEqual([{ no: 1, dueDate: '2027-02-01', amountCents: 120000 }]);
  });
});
