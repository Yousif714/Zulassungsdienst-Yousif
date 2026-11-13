import type { Invoice, InvoiceReadResult, InvoiceReading } from '@/domain/types';
import { inv } from '../helpers';

/** Erfundene Rechnung mit Ratenvereinbarung (keine echten Daten). */
export const readInv = (p: Partial<Invoice> = {}): Invoice => inv('i-r1', 60000, {
  company: 'nexus', connectionId: 'lexware_nexus', externalId: 'lex-r1', contactId: 'm-x', contactExternalId: 'c-77',
  number: 'RE-9001', issuedOn: '2026-10-01', dueDate: '2026-10-15', status: 'open',
  text: 'Ticket NEXUS Summit, zahlbar in 6 Monatsraten à 100,00 €', sourceUpdatedAt: '2026-10-01T08:00:00Z', ...p });

export const okResult = (p: Partial<InvoiceReadResult> = {}): InvoiceReadResult => ({
  hasPlan: true, kind: 'ticket', installments: 6, installmentCents: 10000, firstDueDate: '2026-10-15', dueDay: 15,
  quote: 'zahlbar in 6 Monatsraten à 100,00 €', certain: true, note: null, ...p });

export const reading = (p: Partial<InvoiceReading> = {}): InvoiceReading => ({
  id: 'r1', invoiceId: 'i-r1', sourceUpdatedAt: '2026-10-01T08:00:00Z', readAt: '2026-11-12T09:00:00Z', model: 'claude-opus-5-5',
  result: okResult(), outcome: 'none', inputTokens: 1000, outputTokens: 500, costMicroCents: 1_400_000, ...p });
