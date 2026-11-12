import disputes from './stripe/disputes.json';
import invoices from './stripe/invoices.json';
import products from './stripe/products.json';
import refunds from './stripe/refunds.json';
import subscriptions from './stripe/subscriptions.json';
import contactsNexus from './lexware/contacts-nexus.json';
import contactsZulassung from './lexware/contacts-zulassung.json';
import invRE1043 from './lexware/invoice-RE-1043.json';
import invRE1051 from './lexware/invoice-RE-1051.json';
import invRE1060 from './lexware/invoice-RE-1060.json';
import invRE1100 from './lexware/invoice-RE-1100.json';
import invRE1101 from './lexware/invoice-RE-1101.json';
import invRE1102 from './lexware/invoice-RE-1102.json';
import invRE1110 from './lexware/invoice-RE-1110.json';
import invRZ500 from './lexware/invoice-RZ-500.json';
import voucherlistNexus from './lexware/voucherlist-nexus.json';
import voucherlistZulassung from './lexware/voucherlist-zulassung.json';

import type { StripeRaw } from '@/domain/import/stripe';

/** Mittag UTC des Tages als Unix-Sekunden (zeitzonensicher für Europe/Berlin). */
export const unix = (isoDate: string): number => Date.parse(`${isoDate}T12:00:00Z`) / 1000;

/** Stripe-Rohdaten, wie der Connector sie dem Mapper übergibt (Listen ausgepackt). */
export const stripeRaw: StripeRaw = {
  subscriptions: subscriptions.data,
  products: products.data,
  invoices: invoices.data,
  refunds: refunds.data,
  disputes: disputes.data,
};

/** Pfad (ohne Query) → Stripe-Antwort-JSON. Erstattungen und Streitfälle tragen hier schon `invoiceId`. */
export const stripeRoutes: Record<string, unknown> = {
  '/v1/subscriptions': subscriptions,
  '/v1/products': products,
  '/v1/invoices': invoices,
  '/v1/refunds': refunds,
  '/v1/disputes': disputes,
};

type LexDetail = { id: string; voucherNumber: string; updatedDate: string; [k: string]: unknown };
const lexDetails: LexDetail[] = [invRE1043, invRE1051, invRE1060, invRE1100, invRE1101, invRE1102, invRE1110, invRZ500] as LexDetail[];
const nexusNumbers = ['RE-1043', 'RE-1051', 'RE-1060', 'RE-1100', 'RE-1101', 'RE-1102', 'RE-1110'];

/** Lexware-Rechnungsdetail zur Rechnungsnummer (Rohdaten wie von GET /v1/invoices/{id}). */
export const lexDetail = (number: string): LexDetail => {
  const d = lexDetails.find((x) => x.voucherNumber === number);
  if (!d) throw new Error(`Lexware-Fixture fehlt: ${number}`);
  return d;
};
/** Alle Rechnungsdetails einer Firma. */
export const lexInvoices = (company: 'nexus' | 'zulassung'): LexDetail[] => (company === 'nexus' ? nexusNumbers.map(lexDetail) : [lexDetail('RZ-500')]);
/** Kontakt-Rohdaten (`content` der Kontaktliste) einer Firma. */
export const lexContacts = (company: 'nexus' | 'zulassung'): unknown[] => (company === 'nexus' ? contactsNexus : contactsZulassung).content;
/** Lexware-ID der Rechnung zur Nummer. */
export const idOf = (number: string): string => lexDetail(number).id;
/** `updatedDate` der Rechnung zur Nummer. */
export const updatedOf = (number: string): string => lexDetail(number).updatedDate;

/** Pfad → Lexware-Antwort-JSON (Verbindung NEXUS). Zulassung: `lexwareRoutesZulassung`. */
export const lexwareRoutes: Record<string, unknown> = {
  '/v1/voucherlist': voucherlistNexus,
  '/v1/contacts': contactsNexus,
  ...Object.fromEntries(lexInvoices('nexus').map((d) => [`/v1/invoices/${d.id}`, d])),
};
export const lexwareRoutesZulassung: Record<string, unknown> = {
  '/v1/voucherlist': voucherlistZulassung,
  '/v1/contacts': contactsZulassung,
  [`/v1/invoices/${idOf('RZ-500')}`]: lexDetail('RZ-500'),
};
