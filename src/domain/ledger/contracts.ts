import type { Allocation, AppState, ContractKind, ExternalRef, Invoice, MemberContract } from '../types';

export const CONTRACT_KIND_LABEL: Record<ContractKind, 'Mitgliedschaft' | 'Ticket-Raten' | 'Ratenzahlung'> = {
  membership: 'Mitgliedschaft', ticket: 'Ticket-Raten', other: 'Ratenzahlung',
};

/** Anzeige der Vertragsart; fehlt = Mitgliedschaft (alte Daten). */
export const contractKindLabel = (kind: ContractKind | undefined): string => CONTRACT_KIND_LABEL[kind ?? 'membership'];

export const isMembershipContract = (c: MemberContract): boolean => (c.kind ?? 'membership') === 'membership';

export const contractsOfContact = (s: AppState, contactId: string): MemberContract[] => s.contracts.filter((c) => c.contactId === contactId);

/** Der Mitgliedsvertrag eines Kontakts (Ticket- und Ratenverträge zählen nicht). */
export const membershipContractOf = (s: AppState, contactId: string): MemberContract | undefined =>
  s.contracts.find((c) => c.contactId === contactId && isMembershipContract(c));

/** Herkunfts-Referenz eines aus einer Rechnung gelesenen Vertrags. */
export const invoiceRef = (inv: Pick<Invoice, 'externalId'>): ExternalRef => ({ connectionId: 'lexware_nexus', externalId: `invoice:${inv.externalId}` });

export function sourceInvoiceOf(s: AppState, c: MemberContract): Invoice | undefined {
  const ref = (c.origin ?? []).find((o) => o.connectionId === 'lexware_nexus' && o.externalId.startsWith('invoice:'));
  if (!ref) return undefined;
  const ext = ref.externalId.slice('invoice:'.length);
  return s.invoices.find((i) => i.connectionId === 'lexware_nexus' && i.externalId === ext);
}

/** Quellrechnung storniert: Vertrag ruht bis zur Entscheidung des Inhabers (Spec 9a). */
export const contractOnHold = (s: AppState, c: MemberContract): boolean => sourceInvoiceOf(s, c)?.status === 'void';

type Target = { invoiceId: string } | { contractId: string };
const hits = (a: Allocation, t: Target) => ('invoiceId' in t ? a.invoiceId === t.invoiceId : a.contractId === t.contractId);

/** Hängt Zuordnungen von einer Rechnung/einem Vertrag auf das Ziel um; Betrag und Methode bleiben. */
export function retargetAllocations(allocs: Allocation[], from: Target, to: Target): Allocation[] {
  return allocs.map((a) => {
    if (!hits(a, from)) return a;
    const { paymentId, amountCents, method } = a;
    return 'invoiceId' in to ? { paymentId, invoiceId: to.invoiceId, amountCents, method } : { paymentId, contractId: to.contractId, amountCents, method };
  });
}
