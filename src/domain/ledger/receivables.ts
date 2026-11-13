import { daysBetween } from '../clock';
import { contractSources, notConnected } from '../connections';
import { memberView } from '../detectors/members';
import { parseMembership } from '../import/membership';
import type { AppState, Invoice, IsoDate } from '../types';
import { trafficFor } from './status';

/** Vertrag, der diese Mitgliedsrechnung bereits abdeckt (nur über `origin`), sonst null. */
export function coveringContract(s: AppState, inv: Invoice): string | null {
  if (inv.connectionId !== 'lexware_nexus' || inv.status === 'void') return null;
  if (!inv.text || parseMembership(inv.text) === null) return null;
  if (!inv.contactExternalId) return null;
  const c = s.contracts.find((k) => k.origin?.some((o) => o.connectionId === 'lexware_nexus' && o.externalId === inv.contactExternalId));
  return c?.id ?? null;
}

/** Offener Betrag einer Rechnung als NEXUS-Forderung (Cent). */
export function invoiceOpenCents(s: AppState, inv: Invoice): number {
  if (inv.status === 'paid' || inv.status === 'void' || coveringContract(s, inv)) return 0;
  const allocated = s.allocations.filter((a) => a.invoiceId === inv.id).reduce((n, a) => n + a.amountCents, 0);
  return Math.max(0, Math.min(inv.openCents, inv.totalCents - allocated));
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
    if (notConnected(contractSources(c), s.connections)) continue;
    const v = memberView(s, c.id, today);
    if (v.status.arrearsCents <= 0 || !v.status.oldestUnpaidDue) continue;
    items.push({
      key: `contract:${c.id}`, kind: 'contract', id: c.id,
      name: v.contact?.name ?? 'Unbekannter Kontakt', contactId: c.contactId,
      label: 'Mitgliedschaft', source: 'Vertrag',
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
