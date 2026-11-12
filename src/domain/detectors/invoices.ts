import { daysBetween, formatIsoDe, todayBerlin } from '../clock';
import { formatEuro } from '../money';
import type { AppState, ConnectionId, Insight, Invoice } from '../types';
import { invoiceRef, paymentRef } from './refs';

const isOpen = (i: Invoice) => i.status === 'open' || i.status === 'overdue';

export function detectStripePaidLexwareOpen(s: AppState): Insight[] {
  const out: Insight[] = [];
  for (const inv of s.invoices) {
    if (inv.source !== 'lexware' || !isOpen(inv) || inv.settledByPaymentId) continue;
    const pay = s.payments.find((p) => p.source === 'stripe' && p.reference === inv.number);
    if (!pay) continue;
    out.push({
      dedupeKey: `stripe-lex:${inv.id}`,
      type: 'stripe_paid_lexware_open',
      company: inv.company,
      priority: 'today',
      title: `Rechnung ${inv.number} wurde per Stripe bezahlt, ist in Lexware aber noch offen`,
      body: `Stripe-Zahlung über ${formatEuro(pay.amountCents)} am ${formatIsoDe(pay.bookedOn)}, Rechnung über ${formatEuro(inv.totalCents)}.`,
      amountCents: inv.openCents,
      refs: [invoiceRef(inv, inv.number), paymentRef(pay.id, pay.payerName ?? pay.externalId)],
      nextStep: 'Rechnung zuordnen',
      needsSources: ['stripe_nexus', 'lexware_nexus'],
    });
  }
  return out;
}

export function detectDoubleInvoices(s: AppState): Insight[] {
  const out: Insight[] = [];
  const live = s.invoices.filter((i) => i.status !== 'void' && i.contactId);
  for (const lex of live.filter((i) => i.source === 'lexware')) {
    for (const st of live.filter((i) => i.source === 'stripe')) {
      if (lex.contactId !== st.contactId || lex.totalCents !== st.totalCents) continue;
      if (Math.abs(daysBetween(lex.issuedOn, st.issuedOn)) > 7) continue;
      out.push({
        dedupeKey: `double:${lex.id}:${st.id}`,
        type: 'double_invoice',
        company: lex.company,
        priority: 'today',
        title: `Mögliche Doppelrechnung über ${formatEuro(lex.totalCents)}`,
        body: `Lexware ${lex.number} und Stripe ${st.number} lauten auf denselben Betrag und Kontakt.`,
        amountCents: lex.totalCents,
        refs: [invoiceRef(lex, lex.number), invoiceRef(st, st.number)],
        nextStep: 'Rechnungen prüfen',
        needsSources: [lex.connectionId, st.connectionId],
      });
    }
  }
  return out;
}

export function detectInvoiceOverdue(s: AppState, now: Date): Insight[] {
  const today = todayBerlin(now);
  const groups = new Map<string, Invoice[]>();
  for (const i of s.invoices) {
    if (!isOpen(i) || i.openCents <= 0 || i.dueDate >= today) continue;
    const k = i.contactId ?? 'unbekannt';
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const out: Insight[] = [];
  for (const [key, list] of groups) {
    const sum = list.reduce((n, i) => n + i.openCents, 0);
    const name = s.contacts.find((c) => c.id === key)?.name ?? 'Unbekannter Kontakt';
    const oldest = list.reduce((a, b) => (a.dueDate <= b.dueDate ? a : b));
    const sources = [...new Set(list.map((i) => i.connectionId))] as ConnectionId[];
    out.push({
      dedupeKey: `inv-over:${key}`,
      type: 'invoice_overdue',
      company: list[0].company,
      priority: 'info',
      title: `${name}: ${list.length} ${list.length === 1 ? 'Rechnung' : 'Rechnungen'} überfällig, zusammen ${formatEuro(sum)}`,
      body: `Älteste Fälligkeit ${formatIsoDe(oldest.dueDate)} (${daysBetween(oldest.dueDate, today)} Tage überfällig).`,
      amountCents: sum,
      refs: list.map((i) => invoiceRef(i, i.number)),
      nextStep: 'Erinnerung vorbereiten',
      needsSources: sources,
    });
  }
  return out;
}
