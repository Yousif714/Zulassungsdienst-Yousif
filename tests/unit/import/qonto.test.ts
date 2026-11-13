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
