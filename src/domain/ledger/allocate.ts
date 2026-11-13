import type { Installment, InstallmentState, IsoDate } from '../types';

/**
 * Zahlungen (nach Buchungsdatum sortiert, am selben Tag zuerst Zahlungen, dann Erstattungen)
 * füllen immer die älteste offene Rate zuerst. Erstattungen (< 0) mindern zuerst die Überzahlung,
 * dann die jüngste (teil-)bezahlte Rate; der Stand wird nie negativ, ein Rest darüber verfällt.
 */
export function allocate(
  schedule: Installment[],
  paid: { bookedOn: IsoDate; amountCents: number }[],
): { states: InstallmentState[]; overpaidCents: number } {
  const states: InstallmentState[] = schedule.map((i) => ({ ...i, paidCents: 0, paidOn: null }));
  const payments = [...paid].sort(
    (a, b) => a.bookedOn.localeCompare(b.bookedOn) || Number(a.amountCents < 0) - Number(b.amountCents < 0),
  );
  let overpaidCents = 0;

  for (const p of payments) {
    if (p.amountCents === 0) continue;
    if (p.amountCents < 0) {
      let rest = -p.amountCents;
      const fromOver = Math.min(overpaidCents, rest);
      overpaidCents -= fromOver;
      rest -= fromOver;
      for (let k = states.length - 1; k >= 0 && rest > 0; k--) {
        const st = states[k];
        if (st.paidCents <= 0) continue;
        const take = Math.min(st.paidCents, rest);
        st.paidCents -= take;
        rest -= take;
        st.paidOn = null;
      }
      continue;
    }
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
