import { expect, test } from 'vitest';
import { mapQonto, QONTO_RETURN_TYPES } from '@/domain/import/qonto';
import { qontoTransactions } from '../../fixtures';

const b = mapQonto(qontoTransactions.transactions);
const ext = (id: string) => b.payments.find((p) => p.externalId === id);

test('Eingang', () => expect(ext('t-demir-1')).toMatchObject({ connectionId: 'bank_qonto', source: 'bank', company: 'nexus', amountCents: 30000, bookedOn: '2026-10-02', payerName: 'Murat Demir', iban: 'DE44500105175407324931', reference: 'Mitgliedschaft', kind: 'incoming' }));
test('Ausgang wird nicht importiert', () => expect(ext('t-out')).toBeUndefined());
test('Stripe-Auszahlung erkannt', () => expect(ext('t-stripe')?.kind).toBe('stripe_payout'));
test('„Stripe“ im Verwendungszweck eines Mitglieds → kein Payout', () => expect(ext('t-kaya-ref')?.kind).toBe('incoming'));
test('Rückbuchung als negative Zahlung', () => {
  const raw = qontoTransactions.transactions.find((t) => t.transaction_id === 't-return')!;
  expect(QONTO_RETURN_TYPES).toContain(raw.operation_type);
  expect(ext('t-return')).toMatchObject({ amountCents: -30000, kind: 'incoming', iban: 'DE44500105175407324931' });
  expect(ext('t-return')?.refundOf).toBeUndefined();
});
test('Fremdwährung übersprungen', () => expect(ext('t-usd')).toBeUndefined());
test('vor dem 01.08. (Berlin) übersprungen', () => expect(ext('t-july')).toBeUndefined());
test('nur Zahlungen im Batch', () => expect([b.contacts, b.invoices, b.subscriptions, b.disputes].every((x) => x.length === 0)).toBe(true));
test('nicht ganzzahliger oder nicht positiver Betrag → übersprungen', () => {
  const base = qontoTransactions.transactions[0];
  const m = (id: string, amount_cents: number, side = 'credit') => mapQonto([{ ...base, transaction_id: id, amount_cents, side }]).payments;
  expect(m('x1', 100.5)).toHaveLength(0);
  expect(m('x2', 0)).toHaveLength(0);
  expect(m('x3', -500)).toHaveLength(0);
  expect(m('x4', 100)).toHaveLength(1);
});
test('Lastschrift-Typ als Eingang bleibt normaler Eingang, nur als Ausgang Rückbuchung', () => {
  const base = qontoTransactions.transactions[0];
  const credit = mapQonto([{ ...base, transaction_id: 'dd1', operation_type: 'direct_debit_collection' }]).payments;
  expect(credit[0]).toMatchObject({ amountCents: 30000, kind: 'incoming' });
});
test('Fremdwährung per local_currency (Kontowährung EUR) übersprungen, EUR oder fehlend bleibt', () => {
  const base = qontoTransactions.transactions[0];
  const m = (id: string, extra: Record<string, unknown>) => mapQonto([{ ...base, transaction_id: id, currency: 'EUR', ...extra }]).payments;
  expect(m('lc1', { local_currency: 'USD' })).toHaveLength(0);
  expect(m('lc2', { local_currency: 'EUR' })).toHaveLength(1);
  expect(m('lc3', { local_currency: undefined })).toHaveLength(1);
  expect(m('lc4', { local_currency: null })).toHaveLength(1);
});
