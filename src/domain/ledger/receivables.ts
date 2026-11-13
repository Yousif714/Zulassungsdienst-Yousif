import { daysBetween } from '../clock';
import { contractSources, notConnected } from '../connections';
import { memberView } from '../detectors/members';
import { parseMembership } from '../import/membership';
import type { AppState, Invoice, IsoDate, Payment } from '../types';
import { contractKindLabel, contractOnHold, invoiceRef, isMembershipContract } from './contracts';
import { distributeOldestFirst } from './distribute';
import { trafficFor } from './status';

/** Vertrag, der diese Mitgliedsrechnung bereits abdeckt (nur über `origin`), sonst null. */
export function coveringContract(s: AppState, inv: Invoice): string | null {
  if (inv.connectionId !== 'lexware_nexus') return null;
  // Ratenvertrag aus dieser Rechnung (Claude-Lesung): deckt sie immer ab, auch ohne Mitgliedschaftstext.
  const ref = invoiceRef(inv);
  const fromInvoice = s.contracts.find((k) => k.origin?.some((o) => o.connectionId === ref.connectionId && o.externalId === ref.externalId));
  if (fromInvoice) return fromInvoice.id;
  if (inv.status === 'void') return null;
  if (!inv.text || parseMembership(inv.text) === null) return null;
  if (!inv.contactExternalId) return null;
  const c = s.contracts.find((k) => isMembershipContract(k) && k.origin?.some((o) => o.connectionId === 'lexware_nexus' && o.externalId === inv.contactExternalId));
  return c?.id ?? null;
}

const allocatedCents = (s: AppState, inv: Invoice) => s.allocations.filter((a) => a.invoiceId === inv.id).reduce((n, a) => n + a.amountCents, 0);

/** Offener Betrag einer Rechnung als NEXUS-Forderung (Cent). */
export function invoiceOpenCents(s: AppState, inv: Invoice): number {
  if (inv.status === 'paid' || inv.status === 'void' || coveringContract(s, inv)) return 0;
  return Math.max(0, Math.min(inv.openCents, inv.totalCents - allocatedCents(s, inv)));
}

/** Bereits bezahlter Betrag einer Rechnung (Cent): offen/überfällig Gesamtbetrag minus Rest, bezahlt alles, storniert nichts. */
export function invoicePaidCents(s: AppState, inv: Invoice): number {
  if (inv.status === 'void') return 0;
  if (inv.status === 'paid') return inv.totalCents;
  return Math.max(0, inv.totalCents - invoiceOpenCents(s, inv));
}

/** Offene Zulassung-Rechnungen eines Kontakts (Rest > 0), älteste Fälligkeit zuerst, mit Gesamtrest. */
export function customerOpenInvoices(s: AppState, contactId: string): { invoiceIds: string[]; openCents: number } {
  const open = s.invoices
    .filter((i) => i.company === 'zulassung' && i.contactId === contactId)
    .map((i) => ({ i, openCents: invoiceOpenCents(s, i) }))
    .filter((x) => x.openCents > 0)
    .sort((a, b) => a.i.dueDate.localeCompare(b.i.dueDate) || a.i.number.localeCompare(b.i.number));
  return { invoiceIds: open.map((x) => x.i.id), openCents: open.reduce((n, x) => n + x.openCents, 0) };
}

/** Was einer Zahlung noch zugeordnet werden kann: offen → offener Betrag; Zulassung, in Lexware bezahlt → Gesamtbetrag minus Zuordnungen; sonst 0. */
export function invoiceAllocatableCents(s: AppState, inv: Invoice): number {
  if (inv.status === 'paid') return inv.company === 'zulassung' ? Math.max(0, inv.totalCents - allocatedCents(s, inv)) : 0;
  return invoiceOpenCents(s, inv);
}

/** Zahlung auf offene Rechnungen verteilen, älteste zuerst; `restCents` = Überzahlung. */
export function splitPaymentOverInvoices(s: AppState, amountCents: number, invoiceIds: string[]): { shares: { invoiceId: string; amountCents: number }[]; restCents: number } {
  const open = s.invoices
    .filter((i) => invoiceIds.includes(i.id))
    .map((i) => ({ id: i.id, dueDate: i.dueDate, number: i.number, openCents: invoiceOpenCents(s, i) }))
    .filter((i) => i.openCents > 0);
  const { shares, restCents } = distributeOldestFirst(amountCents, open);
  return { shares: shares.map((x) => ({ invoiceId: x.id, amountCents: x.amountCents })), restCents };
}

/** Nicht zugeordneter Rest einer Zahlung (Cent, nie negativ). */
export function paymentRestCents(s: AppState, p: Payment): number {
  const allocated = s.allocations.filter((a) => a.paymentId === p.id).reduce((n, a) => n + a.amountCents, 0);
  return Math.max(0, p.amountCents - allocated);
}

export interface Receivable {
  key: string;
  kind: 'contract' | 'invoice';
  id: string;
  name: string;
  contactId: string | null;
  label: string;
  source: 'Vertrag' | 'Lexware';
  amountCents: number;
  dueDate: IsoDate;
  daysOverdue: number;
  traffic: 'green' | 'yellow' | 'red';
}

export function nexusReceivables(s: AppState, today: IsoDate): { items: Receivable[]; totalCents: number; overdueCents: number } {
  const items: Receivable[] = [];
  for (const c of s.contracts) {
    if (notConnected(contractSources(c), s.connections) || contractOnHold(s, c)) continue;
    const v = memberView(s, c.id, today);
    if (v.status.arrearsCents <= 0 || !v.status.oldestUnpaidDue) continue;
    items.push({
      key: `contract:${c.id}`, kind: 'contract', id: c.id,
      name: v.contact?.name ?? 'Unbekannter Kontakt', contactId: c.contactId,
      label: contractKindLabel(c.kind), source: 'Vertrag',
      amountCents: v.status.arrearsCents, dueDate: v.status.oldestUnpaidDue,
      daysOverdue: v.status.daysOverdue, traffic: v.status.traffic,
    });
  }
  for (const inv of s.invoices) {
    if (inv.connectionId !== 'lexware_nexus') continue;
    const open = invoiceOpenCents(s, inv);
    if (open <= 0) continue;
    const daysOverdue = Math.max(0, daysBetween(inv.dueDate, today));
    items.push({
      key: `invoice:${inv.id}`, kind: 'invoice', id: inv.id,
      name: s.contacts.find((x) => x.id === inv.contactId)?.name ?? 'Unbekannter Kontakt', contactId: inv.contactId,
      label: inv.number, source: 'Lexware',
      amountCents: open, dueDate: inv.dueDate, daysOverdue,
      traffic: trafficFor(inv.dueDate < today ? open : 0, daysOverdue),
    });
  }
  items.sort((a, b) => b.daysOverdue - a.daysOverdue || b.amountCents - a.amountCents || a.name.localeCompare(b.name, 'de'));
  return {
    items,
    totalCents: items.reduce((n, i) => n + i.amountCents, 0),
    overdueCents: items.filter((i) => i.dueDate < today).reduce((n, i) => n + i.amountCents, 0),
  };
}
