import type { Contact, ExternalRef, Invoice, IsoDate, Payment, Subscription } from '@/domain/types';

/** Erstimport holt nur Daten ab diesem Tag; danach inkrementell. */
export const IMPORT_SINCE: IsoDate = '2026-06-01';

/** Gespeicherter Cursor mit späterem oder ohne `since`: Die Verbindung startet einmal von vorn (IMPORT_SINCE wurde vorverlegt). */
export const cursorOutdated = (since: unknown): boolean => typeof since !== 'string' || since > IMPORT_SINCE;

export type ImportedContact = Omit<Contact, 'id' | 'externalRefs'> & { externalRefs: ExternalRef[] };
export type ImportedInvoice = Omit<Invoice, 'id' | 'contactId'>;
export type ImportedPayment = Omit<Payment, 'id'>;
export type ImportedSubscription = Omit<Subscription, 'id' | 'contractId' | 'confirmedPriceCents' | 'confirmedEndDate' | 'disputes'>;
export interface ImportedDispute { externalId: string; invoiceExternalId: string | null }

export interface ImportBatch {
  contacts: ImportedContact[];
  invoices: ImportedInvoice[];
  payments: ImportedPayment[];
  subscriptions: ImportedSubscription[];
  disputes: ImportedDispute[];
}

export const emptyBatch = (): ImportBatch => ({ contacts: [], invoices: [], payments: [], subscriptions: [], disputes: [] });
