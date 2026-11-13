import { todayBerlin } from '../clock';
import { coveringContract, invoiceOpenCents } from '../ledger/receivables';
import { matchBankPayment, type Expected, type MatchContext, type MatchInvoice } from '../matching/payments';
import { formatEuro } from '../money';
import type { AppState, Insight } from '../types';
import { memberView } from './members';
import { paymentRef } from './refs';

/** Zuordnungskontext: erwartete Beträge je Vertrag und offene NEXUS-Rechnungen. */
export function buildMatchContext(s: AppState, now: Date): MatchContext {
  const today = todayBerlin(now);
  const expected: Expected = new Map();
  for (const c of s.contracts) {
    const v = memberView(s, c.id, today);
    const next = v.status.nextDue ? v.states.find((st) => st.no === v.status.nextDue!.no) : undefined;
    expected.set(c.id, {
      contactId: c.contactId,
      rateCents: c.installmentCents,
      nextRateCents: next ? next.amountCents - next.paidCents : 0,
      arrearsCents: v.status.arrearsCents,
      openCents: v.status.openCents,
    });
  }
  const invoices: MatchInvoice[] = s.invoices
    .filter((i) => i.connectionId === 'lexware_nexus' && i.status !== 'paid' && i.status !== 'void')
    .map((i) => ({ id: i.id, number: i.number, contactId: i.contactId, openCents: invoiceOpenCents(s, i), contractId: coveringContract(s, i) }));
  return { contacts: s.contacts, ibanLinks: s.ibanLinks, expected, invoices };
}

export function detectUnmatchedPayments(s: AppState, now: Date): Insight[] {
  const mctx = buildMatchContext(s, now);
  const out: Insight[] = [];
  for (const p of s.payments) {
    // Nur NEXUS hat Mitgliedsverträge; Stripe-Zahlungen sind keine Bankzahlungen.
    if (p.source !== 'bank' || p.kind !== 'incoming' || p.company !== 'nexus' || p.ignoredAt || p.amountCents <= 0) continue;
    if (s.allocations.some((a) => a.paymentId === p.id)) continue;
    const m = matchBankPayment(p, mctx);
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
