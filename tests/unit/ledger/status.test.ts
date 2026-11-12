import { describe, expect, test } from 'vitest';
import { buildSchedule } from '@/domain/ledger/schedule';
import { allocate } from '@/domain/ledger/allocate';
import { memberStatus } from '@/domain/ledger/status';
import { base } from '../helpers';

const s = buildSchedule(base, []);

describe('allocate + memberStatus', () => {
  const { states, overpaidCents } = allocate(s, [{ bookedOn: '2026-10-02', amountCents: 30000 }, { bookedOn: '2026-11-03', amountCents: 15000 }]);
  test('Referenzbeispiel', () => {
    const st = memberStatus(states, overpaidCents, '2026-11-12');
    expect([st.dueCents, st.paidCents, st.arrearsCents, st.futureCents, st.openCents]).toEqual([60000, 45000, 15000, 60000, 75000]);
    expect(st.traffic).toBe('red'); expect(st.oldestUnpaidDue).toBe('2026-11-01'); expect(st.daysOverdue).toBe(11);
    expect(st.steps).toContain('Rückstand: 150,00 €');
  });
  test('paidOn und Sortierung', () => {
    const r = allocate(s, [{ bookedOn: '2026-11-03', amountCents: 15000 }, { bookedOn: '2026-10-02', amountCents: 30000 }]);
    expect(r.states[0].paidOn).toBe('2026-10-02'); expect(r.states[1].paidOn).toBeNull();
  });
  test('gelb', () => expect(memberStatus(states, overpaidCents, '2026-11-05').traffic).toBe('yellow'));
  test('grün', () => expect(memberStatus(allocate(s, [{ bookedOn: '2026-10-01', amountCents: 60000 }]).states, 0, '2026-11-12').traffic).toBe('green'));
  test('Überzahlung mindert künftige Raten, nie negativ', () => {
    const over = allocate(s, [{ bookedOn: '2026-10-01', amountCents: 70000 }]);
    const so = memberStatus(over.states, over.overpaidCents, '2026-11-12');
    expect([so.arrearsCents, so.futureCents, so.openCents]).toEqual([0, 50000, 50000]);
    expect(memberStatus(allocate(s, [{ bookedOn: '2026-10-01', amountCents: 130000 }]).states, 10000, '2026-11-12').openCents).toBe(0);
  });
});
