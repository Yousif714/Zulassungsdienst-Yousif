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

/** Pfad (ohne Query) → Stripe-Antwort-JSON. Erstattungen und Streitfälle tragen hier schon `invoiceId`. Einzelrechnungen unter `/v1/invoices/{id}`. */
export const stripeRoutes: Record<string, unknown> = {
  ...Object.fromEntries(invoices.data.map((i) => [`/v1/invoices/${i.id}`, i])),
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

/** Query-String der Stripe-Anfragen (muss zur Anfrage des Connectors passen; Reihenfolge fest). */
const stripeQuery = (extra: Record<string, string>, startingAfter?: string): string =>
  `?${new URLSearchParams({ ...extra, limit: '100', ...(startingAfter ? { starting_after: startingAfter } : {}) }).toString()}`;
const stripeSince = Date.parse('2026-08-01T00:00:00Z') / 1000 - 7200;
const invoiceQuery = (after?: string) => `/v1/invoices${stripeQuery({ status: 'paid', 'created[gte]': String(stripeSince) }, after)}`;

/** Stripe mit Mehrseiten-Rechnungen (Seite 1: A1, A2 mit has_more; Seite 2: A3, B1, D1). Exakte Query pro Seite. */
export const stripeRoutesPaged: Record<string, unknown> = {
  ...Object.fromEntries(Object.entries(stripeRoutes).filter(([k]) => k !== '/v1/invoices')),
  [invoiceQuery()]: { object: 'list', data: invoices.data.slice(0, 2), has_more: true },
  [invoiceQuery('in_A2')]: { object: 'list', data: invoices.data.slice(2), has_more: false },
};

const vl = (page: number) =>
  `/v1/voucherlist?${new URLSearchParams({ voucherType: 'invoice', voucherStatus: 'any', voucherDateFrom: '2026-08-01', sort: 'voucherDate,ASC', size: '100', page: String(page) }).toString()}`;
/** Lexware (NEXUS) mit zwei Voucherlist-Seiten: Seite 0 = RE-1043…RE-1100, Seite 1 = RE-1101…RE-1110. */
export const lexwareRoutesPaged: Record<string, unknown> = {
  ...Object.fromEntries(Object.entries(lexwareRoutes).filter(([k]) => k !== '/v1/voucherlist')),
  [vl(0)]: { ...voucherlistNexus, content: voucherlistNexus.content.slice(0, 4), first: true, last: false, totalPages: 2, number: 0 },
  [vl(1)]: { ...voucherlistNexus, content: voucherlistNexus.content.slice(4), first: false, last: true, totalPages: 2, number: 1 },
};
