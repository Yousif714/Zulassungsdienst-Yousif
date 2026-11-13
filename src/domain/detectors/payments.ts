import { todayBerlin } from '../clock';
import { matchBankPayment, type Expected } from '../matching/payments';
import { formatEuro } from '../money';
import type { AppState, Insight } from '../types';
import { memberView } from './members';
import { paymentRef } from './refs';

/** Erwartete Beträge je Mitglied (nächste offene Rate, Rückstand) für die Zahlungszuordnung. */
export function expectedAmounts(s: AppState, now: Date): Expected {
  const today = todayBerlin(now);
  const expected: Expected = new Map();
  for (const c of s.contracts) {
    const v = memberView(s, c.id, today);
    const next = v.status.nextDue ? v.states.find((st) => st.no === v.status.nextDue!.no) : undefined;
    expected.set(c.contactId, {
      nextRateCents: next ? next.amountCents - next.paidCents : 0,
      arrearsCents: v.status.arrearsCents,
    });
  }
  return expected;
}

export function detectUnmatchedPayments(s: AppState, now: Date): Insight[] {
  const expected = expectedAmounts(s, now);
  const out: Insight[] = [];
  for (const p of s.payments) {
    // Nur NEXUS hat Mitgliedsverträge; Stripe-Zahlungen sind keine Bankzahlungen.
    if (p.source !== 'bank' || p.kind !== 'incoming' || p.company !== 'nexus') continue;
    if (s.allocations.some((a) => a.paymentId === p.id)) continue;
    const m = matchBankPayment(p, { contacts: s.contacts, ibanLinks: s.ibanLinks, expected });
    if (m.confidence === 'high') continue;
    const who = p.payerName ?? 'Unbekannt';
    out.push({
      dedupeKey: `unmatched:${p.id}`,
      type: 'unmatched_payment',
      company: 'nexus',
      priority: 'today',
      title: `Zahlung von ${who} über ${formatEuro(p.amountCents)} nicht zugeordnet`,
      body: `${m.reason}${p.reference ? ` Verwendungszweck: ${p.reference}` : ''}`,
      amountCents: p.amountCents,
      refs: [paymentRef(p.id, who)],
      nextStep: 'Zahlung zuordnen',
      needsSources: ['bank_qonto'],
    });
  }
  return out;
}
