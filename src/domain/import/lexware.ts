import type { Company, Invoice, IsoDate } from '../types';
import type { ImportedContact, ImportedInvoice } from './batch';

export type LexwareConnection = 'lexware_nexus' | 'lexware_zulassung';

export const lexwareCompany: Record<LexwareConnection, Company> = {
  lexware_nexus: 'nexus',
  lexware_zulassung: 'zulassung',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

/** Euro (Dezimalzahl) → ganze Cent ohne Gleitkommafehler (Dezimalverschiebung über Exponent-Schreibweise). */
function euroToCents(euro: unknown): number {
  const x = Number(euro);
  if (!Number.isFinite(x)) return 0;
  const shifted = Number(`${x}e2`);
  return Math.round(Number.isFinite(shifted) ? shifted : x * 100);
}

/** Lexware liefert Zeitstempel wie `2026-09-01T00:00:00.000+02:00` (Ortszeit Berlin); der Datumsteil ist der Kalendertag. */
const day = (v: unknown): IsoDate => String(v ?? '').slice(0, 10);

function mapStatus(s: unknown): Invoice['status'] {
  switch (s) {
    case 'paid':
    case 'paidoff':
      return 'paid';
    case 'overdue':
      return 'overdue';
    case 'voided':
      return 'void';
    default:
      return 'open'; // open (draft filtert der Connector vorher heraus)
  }
}

function invoiceText(d: Obj): string {
  const parts: unknown[] = [d.title, d.introduction];
  for (const li of (d.lineItems as Obj[] | undefined) ?? []) parts.push(li.name, li.description);
  parts.push(d.remark);
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join('\n');
}

export function mapLexwareInvoice(detail: unknown, conn: LexwareConnection): ImportedInvoice {
  const d = detail as Obj;
  const status = mapStatus(d.voucherStatus);
  const totalCents = euroToCents(d.totalPrice?.totalGrossAmount);
  const issuedOn = day(d.voucherDate);
  const text = invoiceText(d);
  return {
    company: lexwareCompany[conn],
    source: 'lexware',
    connectionId: conn,
    externalId: d.id,
    number: d.voucherNumber,
    totalCents,
    openCents: status === 'open' || status === 'overdue' ? (d.openAmount != null ? euroToCents(d.openAmount) : totalCents) : 0,
    issuedOn,
    dueDate: d.dueDate ? day(d.dueDate) : issuedOn,
    status,
    ...(text ? { text } : {}),
    ...(d.address?.contactId ? { contactExternalId: d.address.contactId } : {}),
    ...(d.updatedDate ? { sourceUpdatedAt: d.updatedDate } : {}),
  };
}

const flat = (groups: unknown, skip: string[] = []): string[] =>
  Object.entries((groups as Obj | undefined) ?? {}).filter(([k]) => !skip.includes(k)).map(([, v]) => v).flatMap((v) => (Array.isArray(v) ? v : [])).filter((s): s is string => typeof s === 'string' && s !== '');

export function mapLexwareContacts(json: unknown[], conn: LexwareConnection): ImportedContact[] {
  const company = lexwareCompany[conn];
  return (json as Obj[]).map((c) => {
    const isCompany = !!c.company;
    const name = isCompany
      ? String(c.company.name ?? '')
      : [c.person?.firstName, c.person?.lastName].filter(Boolean).join(' ');
    // Lexware-Feld company.contactPersons[].firstName/lastName: gegen Doku prüfen
    const persons: string[] = isCompany && Array.isArray(c.company.contactPersons)
      ? c.company.contactPersons.map((x: Obj) => [x.firstName, x.lastName].filter(Boolean).join(' ')).filter(Boolean)
      : [];
    return {
      company,
      kind: company === 'nexus' ? 'member' : isCompany ? 'dealer' : 'private',
      name,
      phones: flat(c.phoneNumbers, ['fax']),
      emails: [...new Set(flat(c.emailAddresses).map((e) => e.toLowerCase()))],
      externalRefs: [{ connectionId: conn, externalId: c.id }],
      ...(persons.length ? { contactPersons: persons } : {}),
    };
  });
}
