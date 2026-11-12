import type { InstallmentState, IsoDate } from '../types';
import type { MemberStatus } from './status';

export function monthForecast(
  members: { status: MemberStatus; states: InstallmentState[] }[],
  month: string,
  _today: IsoDate,
): { expectedCents: number; atRiskCents: number } {
  let expectedCents = 0;
  let atRiskCents = 0;
  for (const m of members) {
    const unpaid = m.states
      .filter((s) => s.dueDate.startsWith(month))
      .reduce((n, s) => n + s.amountCents - s.paidCents, 0);
    expectedCents += unpaid;
    if (m.status.traffic !== 'green') atRiskCents += unpaid;
  }
  return { expectedCents, atRiskCents };
}
