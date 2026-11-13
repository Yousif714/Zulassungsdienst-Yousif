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

describe('Erstattungen', () => {
  test('Erstattung nimmt von der jüngsten bezahlten Rate', () => {
    const r = allocate(s, [{ bookedOn: '2026-10-01', amountCents: 60000 }, { bookedOn: '2026-10-15', amountCents: -30000 }]);
    expect(r.states.map((x) => [x.paidCents, x.paidOn])).toEqual([[30000, '2026-10-01'], [0, null], [0, null], [0, null]]);
  });
  test('Erstattung zuerst gegen Überzahlung', () => {
    const r = allocate(s, [{ bookedOn: '2026-10-01', amountCents: 130000 }, { bookedOn: '2026-10-02', amountCents: -10000 }]);
    expect(r.overpaidCents).toBe(0);
    expect(r.states.every((x) => x.paidCents === 30000)).toBe(true);
  });
  test('Teilerstattung lässt Rate teilbezahlt ohne paidOn', () => {
    const r = allocate(s, [{ bookedOn: '2026-10-01', amountCents: 30000 }, { bookedOn: '2026-10-02', amountCents: -5000 }]);
    expect([r.states[0].paidCents, r.states[0].paidOn]).toEqual([25000, null]);
  });
  test('Betrag 0 ändert nichts', () => expect(allocate(s, [{ bookedOn: '2026-10-01', amountCents: 0 }]).states.every((x) => x.paidCents === 0)).toBe(true));
  test('Erstattung größer als Gezahltes → nie negativ', () => {
    const r = allocate(s, [{ bookedOn: '2026-10-01', amountCents: 10000 }, { bookedOn: '2026-10-02', amountCents: -50000 }]);
    expect(r.states.every((x) => x.paidCents >= 0)).toBe(true);
    expect(r.overpaidCents).toBe(0);
  });
  test('gleicher Tag: Zahlung vor Erstattung', () => expect(allocate(s, [{ bookedOn: '2026-10-01', amountCents: -30000 }, { bookedOn: '2026-10-01', amountCents: 30000 }]).states[0].paidCents).toBe(0));
});
