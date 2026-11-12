import type { Installment, InstallmentState, IsoDate } from '../types';

/** Zahlungen (nach Buchungsdatum sortiert) füllen immer die älteste offene Rate zuerst. */
export function allocate(
  schedule: Installment[],
  paid: { bookedOn: IsoDate; amountCents: number }[],
): { states: InstallmentState[]; overpaidCents: number } {
  const states: InstallmentState[] = schedule.map((i) => ({ ...i, paidCents: 0, paidOn: null }));
  const payments = [...paid].sort((a, b) => a.bookedOn.localeCompare(b.bookedOn));
  let overpaidCents = 0;

  for (const p of payments) {
    let rest = p.amountCents;
    for (const st of states) {
      if (rest <= 0) break;
      const open = st.amountCents - st.paidCents;
      if (open <= 0) continue;
      const take = Math.min(open, rest);
      st.paidCents += take;
      rest -= take;
      if (st.paidCents === st.amountCents) st.paidOn = p.bookedOn;
    }
    overpaidCents += rest;
  }
  return { states, overpaidCents };
}
