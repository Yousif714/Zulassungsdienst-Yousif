import { describe, expect, test } from 'vitest';
import { buildSchedule } from '@/domain/ledger/schedule';
import { allocate } from '@/domain/ledger/allocate';
import { memberStatus } from '@/domain/ledger/status';
import { monthForecast } from '@/domain/ledger/forecast';
import { base } from '../helpers';

describe('monthForecast', () => {
  test('Rest der Novemberrate, Ampel rot', () => {
    const { states, overpaidCents } = allocate(buildSchedule(base, []), [{ bookedOn: '2026-10-02', amountCents: 30000 }, { bookedOn: '2026-11-03', amountCents: 15000 }]);
    const st = memberStatus(states, overpaidCents, '2026-11-12');
    expect(monthForecast([{ status: st, states }], '2026-11', '2026-11-12')).toEqual({ expectedCents: 15000, atRiskCents: 15000 });
  });
  test('grünes Mitglied ist nicht gefährdet', () => {
    const { states, overpaidCents } = allocate(buildSchedule(base, []), [{ bookedOn: '2026-10-02', amountCents: 60000 }]);
    const st = memberStatus(states, overpaidCents, '2026-11-12');
    expect(monthForecast([{ status: st, states }], '2026-12', '2026-11-12')).toEqual({ expectedCents: 30000, atRiskCents: 0 });
  });
});
