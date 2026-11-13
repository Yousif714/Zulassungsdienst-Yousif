import { normalizeNameStrict } from './matching/payments';
import { isMembershipContract } from './ledger/contracts';
import { deriveProposals, findContactFor, type ContractProposal } from './import/proposals';
import { isMembership } from './import/membership';
import { formatEuro } from './money';
import type { AppState, Contact, Invoice, OrderConfirmation, PortalMember } from './types';

export type PortalStatus = 'contract' | 'proposal' | 'invoice_only' | 'no_invoice' | 'ignored';

export interface PortalView {
  member: PortalMember; status: PortalStatus; inLatestList: boolean;
  contactIds: string[]; nameMatch: { contactId: string; name: string } | null;
  contractId: string | null; proposalId: string | null; invoices: Invoice[];
  /** Nicht stornierte NEXUS-Auftragsbestätigungen der Kontakte (nach Datum). Nie Forderungen. */
  orderConfirmations: OrderConfirmation[];
  /** „AB AB-… vorhanden, Rechnung fehlt“: ABs da, aber keine Lexware-Rechnung (auch keine Mitgliedschafts-Rechnung). */
  abHint: string | null;
  /** IDs der anderen Portal-Mitglieder, die denselben Kontakt treffen. */
  sharedWith: string[];
}

const memberEmails = (m: PortalMember): string[] => [...new Set((m.emails ?? [m.email]).map((e) => e.trim().toLowerCase()).filter((e) => e !== ''))];

/** Zuordnung: 1. externalRef `portal_nexus:<id>`, 2. alle NEXUS-Kontakte mit gleicher E-Mail, 3. nur Namensvorschlag. */
export function linkPortalMember(m: PortalMember, contacts: Contact[]): { contactIds: string[]; nameMatch: { contactId: string; name: string } | null } {
  const byRef = contacts.filter((c) => c.company === 'nexus' && (c.externalRefs ?? []).some((r) => r.connectionId === 'portal_nexus' && r.externalId === m.externalId));
  if (byRef.length > 0) return { contactIds: byRef.map((c) => c.id), nameMatch: null };
  const nexus = contacts.filter((c) => c.company === 'nexus');
  const mails = new Set(memberEmails(m));
  const byEmail = nexus.filter((c) => c.emails.some((e) => mails.has(e.trim().toLowerCase())));
  if (byEmail.length > 0) return { contactIds: byEmail.map((c) => c.id), nameMatch: null };
  const n = normalizeNameStrict(m.name);
  const byName = n === '' ? undefined : nexus.find((c) => normalizeNameStrict(c.name) === n);
  return { contactIds: [], nameMatch: byName ? { contactId: byName.id, name: byName.name } : null };
}

const ORDER: PortalStatus[] = ['no_invoice', 'invoice_only', 'proposal', 'contract', 'ignored'];

export function portalViews(s: AppState): PortalView[] {
  const latest = s.portalMembers.reduce((max, m) => (m.lastSeenInListAt > max ? m.lastSeenInListAt : max), '');
  const proposals = deriveProposals(s);
  const nexusContacts = s.contacts.filter((c) => c.company === 'nexus');
  const hidden = new Set(s.ignoredPortalMembers);
  const proposalContact = new Map(proposals.map((p) => [p.id, findContactFor(p, nexusContacts)]));
  const views = s.portalMembers.map((member): PortalView => {
    const { contactIds, nameMatch } = linkPortalMember(member, s.contacts);
    const ids = new Set(contactIds);
    const mails = new Set(memberEmails(member));
    // Portal-Status nur über den Mitgliedsvertrag (Ticket- und Ratenverträge zählen nicht).
    const contract = s.contracts.find((c) => isMembershipContract(c) && (ids.has(c.contactId) || (c.origin ?? []).some((o) => o.connectionId === 'portal_nexus' && o.externalId === member.externalId)));
    const proposal = proposals.find((p) => {
      const f = proposalContact.get(p.id)!;
      return ((f.match === 'ref' || f.match === 'email') && f.contactId !== null && ids.has(f.contactId)) || (p.email !== null && mails.has(p.email.toLowerCase()));
    });
    const invoices = s.invoices.filter((i) => i.connectionId === 'lexware_nexus' && i.contactId !== null && ids.has(i.contactId) && i.status !== 'void' && !isMembership(i.text ?? ''));
    const anyInvoice = s.invoices.some((i) => i.connectionId === 'lexware_nexus' && i.contactId !== null && ids.has(i.contactId) && i.status !== 'void');
    const orderConfirmations = (s.orderConfirmations ?? [])
      .filter((x) => x.connectionId === 'lexware_nexus' && x.status !== 'void' && x.contactId !== null && ids.has(x.contactId))
      .sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.number.localeCompare(b.number));
    const abHint = orderConfirmations.length > 0 && !anyInvoice ? `AB ${orderConfirmations.map((x) => x.number).join(', ')} vorhanden, Rechnung fehlt` : null;
    const status: PortalStatus = contract ? 'contract' : hidden.has(member.externalId) ? 'ignored' : proposal ? 'proposal' : invoices.length > 0 ? 'invoice_only' : 'no_invoice';
    return { member, status, inLatestList: member.lastSeenInListAt === latest, contactIds, nameMatch, contractId: contract?.id ?? null, proposalId: proposal?.id ?? null, invoices, orderConfirmations, abHint, sharedWith: [] };
  });
  for (const v of views) v.sharedWith = views.filter((o) => o !== v && o.contactIds.some((id) => v.contactIds.includes(id))).map((o) => o.member.id);
  return views.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.member.name.localeCompare(b.member.name, 'de'));
}

export function portalSummary(v: PortalView[]): { total: number; contract: number; proposal: number; invoiceOnly: number; noInvoice: number; ignored: number; notInList: number; listAt: string | null } {
  // Ein Kontakt, den mehrere Mitglieder treffen, zählt je Status nur einmal.
  const key = (x: PortalView) => x.contractId ?? x.proposalId ?? (x.contactIds.length > 0 ? [...x.contactIds].sort().join('+') : x.member.id);
  const count = (st: PortalStatus) => new Set(v.filter((x) => x.status === st).map(key)).size;
  const listAt = v.reduce<string | null>((max, x) => (max === null || x.member.lastSeenInListAt > max ? x.member.lastSeenInListAt : max), null);
  return {
    total: v.filter((x) => x.status !== 'ignored').length, contract: count('contract'), proposal: count('proposal'), invoiceOnly: count('invoice_only'), noInvoice: count('no_invoice'), ignored: count('ignored'),
    notInList: v.filter((x) => x.status !== 'ignored' && !x.inLatestList).length, listAt,
  };
}

/** Vorschlag für einen Vertrag aus dem Portal-Mitglied; bei `invoice_only` mit Werten aus den Rechnungen vorbelegt. */
export function portalProposal(v: PortalView): ContractProposal {
  const ref = { connectionId: 'portal_nexus' as const, externalId: v.member.externalId };
  const base = {
    id: `portal_nexus:${v.member.externalId}`, name: v.member.name, email: v.member.email, billing: 'legacy' as const,
    sources: [ref], contactRefs: [ref], sourceLabel: 'Portal' as const, complete: false, possibleMatch: null,
  };
  if (v.status !== 'invoice_only' || v.invoices.length === 0) {
    return { ...base, totalCents: null, installments: null, installmentCents: null, dueDay: null, startDate: null, references: ['Portal-Liste'], steps: ['Mitglied steht in der Portal-Liste, Vertragswerte bitte ergänzen.'] };
  }
  const byDate = [...v.invoices].sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
  const oldest = byDate[0];
  const newest = byDate[byDate.length - 1];
  return {
    ...base, totalCents: null, installments: null, installmentCents: newest.totalCents, dueDay: Number(oldest.dueDate.slice(8, 10)), startDate: oldest.dueDate,
    references: byDate.map((i) => `Rechnung ${i.number}`),
    steps: [`Rate ${formatEuro(newest.totalCents)} aus Rechnung ${newest.number}, Fälligkeitstag und Start aus Rechnung ${oldest.number}. Anzahl und Gesamt bitte ergänzen.`],
  };
}
