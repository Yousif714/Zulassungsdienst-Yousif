import { addDaysIso, todayBerlin } from '../clock';
import { LEXWARE_OF } from '../connections';
import { coveringContract, invoiceOpenCents } from '../ledger/receivables';
import { matchBankPayment, type Expected, type MatchContext, type MatchInvoice } from '../matching/payments';
import { formatEuro } from '../money';
import type { AppState, Company, Insight, Invoice } from '../types';
import { memberView } from './members';
import { paymentRef } from './refs';

/** Zulassung: so weit zurück werden in Lexware schon bezahlte Rechnungen als Ziel geführt. */
export const PAID_LOOKBACK_DAYS = 180;

/** Zuordnungskontext einer Firma: nur deren Kontakte, IBAN-Zuordnungen, Verträge und Lexware-Rechnungen. */
export function buildMatchContext(s: AppState, now: Date, company: Company = 'nexus'): MatchContext {
  const today = todayBerlin(now);
  const contacts = s.contacts.filter((c) => c.company === company);
  const contactIds = new Set(contacts.map((c) => c.id));
  const expected: Expected = new Map();
  if (company === 'nexus') {
    for (const c of s.contracts.filter((x) => contactIds.has(x.contactId))) {
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
  }
  const fromLexware = s.invoices.filter((i) => i.company === company && i.connectionId === LEXWARE_OF[company] && i.status !== 'void');
  const toMatch = (i: Invoice, openCents: number): MatchInvoice => ({
    id: i.id, number: i.number, contactId: i.contactId, openCents, contractId: coveringContract(s, i), dueDate: i.dueDate, totalCents: i.totalCents,
  });
  // NEXUS: auch von Verträgen abgedeckte Rechnungen (openCents 0), damit der Treffer zum Vertrag führt.
  const invoices: MatchInvoice[] = company === 'nexus'
    ? fromLexware.filter((i) => i.status !== 'paid').map((i) => toMatch(i, invoiceOpenCents(s, i)))
    : fromLexware.filter((i) => invoiceOpenCents(s, i) > 0).map((i) => toMatch(i, invoiceOpenCents(s, i)));
  if (company === 'zulassung') {
    const since = addDaysIso(today, -PAID_LOOKBACK_DAYS);
    for (const i of fromLexware) {
      if (i.status === 'paid' && i.issuedOn >= since && !s.allocations.some((a) => a.invoiceId === i.id)) invoices.push({ ...toMatch(i, 0), paidInLexware: true });
    }
  }
  return { company, contacts, ibanLinks: s.ibanLinks.filter((l) => contactIds.has(l.contactId)), expected, invoices };
}

export function detectUnmatchedPayments(s: AppState, now: Date): Insight[] {
  const contexts = new Map<Company, MatchContext>();
  const out: Insight[] = [];
  for (const p of s.payments) {
    // Stripe-Zahlungen sind keine Bankzahlungen.
    if (p.source !== 'bank' || p.kind !== 'incoming' || p.ignoredAt || p.amountCents <= 0) continue;
    if (s.allocations.some((a) => a.paymentId === p.id)) continue;
    if (!contexts.has(p.company)) contexts.set(p.company, buildMatchContext(s, now, p.company));
    const m = matchBankPayment(p, contexts.get(p.company)!);
    if (m.confidence === 'high') continue;
    const who = p.payerName ?? 'Unbekannt';
    out.push({
      dedupeKey: `unmatched:${p.id}`,
      type: 'unmatched_payment',
      company: p.company,
      priority: 'today',
      title: `Zahlung von ${who} über ${formatEuro(p.amountCents)} nicht zugeordnet`,
      body: `${m.reason}${p.reference ? ` Verwendungszweck: ${p.reference}` : ''}`,
      amountCents: p.amountCents,
      refs: [paymentRef(p.id, who, p.company)],
      nextStep: 'Zahlung zuordnen',
      // Zulassung bewusst nicht bank_sparkasse: der 7-Tage-Frist-Zustand würde offene Fälle sonst ausblenden.
      needsSources: [p.company === 'zulassung' ? 'lexware_zulassung' : 'bank_qonto'],
    });
  }
  return out;
}
