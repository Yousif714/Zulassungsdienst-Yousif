import { expect, test } from 'vitest';

import { billingPeriods, mapStripe } from '@/domain/import/stripe';
import { stripeRaw } from '../../fixtures';

const b = mapStripe(stripeRaw);
const sub = (id: string) => b.subscriptions.find((s) => s.externalId === id)!;

test('billingPeriods', () => {
  expect(billingPeriods('2026-09-01', '2027-01-01')).toBe(4);
  expect(billingPeriods('2026-09-15', '2027-02-15')).toBe(5);
  expect(billingPeriods('2026-01-31', '2026-05-31')).toBe(4);
});
test('Abo mit cancel_at', () => expect(sub('sub_A')).toMatchObject({ amountCents: 30000, installments: 4, anchorDay: 1, startDate: '2026-09-01', cancelAt: '2027-01-01', endDate: '2027-01-01', interval: 'month', currency: 'eur', customerEmail: 'ayse@example.de', productName: 'NEXUS-Mitgliedschaft 4 Monate' }));
test('Abo mit Schedule, Rate = amount_paid', () => expect(sub('sub_B')).toMatchObject({ amountCents: 25000, priceCents: 27500, installments: 5, cancelAt: null, endDate: '2027-02-15' }));
test('gekündigtes Abo', () => expect(sub('sub_C').status).toBe('canceled'));
test('ohne Enddatum: Anzahl aus dem Produktnamen, sonst null', () => {
  expect(sub('sub_E').installments).toBeNull();
  expect(sub('sub_C').installments).toBe(6);
});
test('Fremdwährung bleibt erhalten', () => expect(sub('sub_F').currency).toBe('usd'));
test('bezahlte Abo-Rechnung → Zahlung', () => expect(b.payments.find((p) => p.externalId === 'in_A2')).toEqual({
  company: 'nexus', source: 'stripe', connectionId: 'stripe_nexus', externalId: 'in_A2', amountCents: 30000, bookedOn: '2026-10-01',
  payerName: 'Ayşe Öztürk', reference: expect.any(String), kind: 'incoming', subscriptionExternalId: 'sub_A' }));
test('Erstattung → negative Zahlung mit refundOf', () => expect(b.payments.find((p) => p.externalId === 're_B1')).toMatchObject({ amountCents: -5000, refundOf: 'in_B1', bookedOn: '2026-09-20' }));
test('Streitfall', () => expect(b.disputes).toEqual([{ externalId: 'dp_1', invoiceExternalId: 'in_A3' }]));
test('Rechnung eines Nicht-Mitgliedschafts-Abos wird Zahlung seines Abos', () => expect(b.payments.find((p) => p.externalId === 'in_D1')).toMatchObject({ subscriptionExternalId: 'sub_D' }));
test('Rechnung ohne Abo-Bezug wird nicht importiert', () => {
  const raw = { ...stripeRaw, invoices: [...stripeRaw.invoices, { id: 'in_X', status: 'paid', amount_paid: 100, created: 1, lines: { data: [] } }] };
  expect(mapStripe(raw).payments.some((p) => p.externalId === 'in_X')).toBe(false);
});
test('keine Rechnungen und Kontakte aus Stripe', () => { expect(b.invoices).toEqual([]); expect(b.contacts).toEqual([]); });

const withRaw = (extra: Partial<typeof stripeRaw>) => mapStripe({ ...stripeRaw, ...extra });
const refund = (o: object) => ({ id: 're_X', amount: 100, currency: 'eur', created: 1, status: 'succeeded', invoiceId: 'in_B1', ...o });
test('nicht erfolgreiche Erstattung → keine Zahlung', () => {
  for (const status of ['pending', 'failed', 'canceled']) {
    expect(withRaw({ refunds: [refund({ status })] }).payments.some((p) => p.externalId === 're_X')).toBe(false);
  }
});
test('Erstattung zu Rechnung ohne Abo-Bezug → keine Zahlung', () => {
  expect(withRaw({ refunds: [refund({ invoiceId: 'in_unbekannt' })] }).payments.some((p) => p.externalId === 're_X')).toBe(false);
  expect(withRaw({ refunds: [refund({ invoiceId: null })] }).payments.some((p) => p.externalId === 're_X')).toBe(false);
});
test('nur EUR wird Zahlung', () => {
  const usdInv = { ...(stripeRaw.invoices[0] as object), id: 'in_USD', currency: 'usd' };
  expect(withRaw({ invoices: [...stripeRaw.invoices, usdInv] }).payments.some((p) => p.externalId === 'in_USD')).toBe(false);
  expect(withRaw({ refunds: [refund({ currency: 'usd' })] }).payments.some((p) => p.externalId === 're_X')).toBe(false);
});

test('metadata.contractId wird gelesen', () => {
  const raw = { ...stripeRaw, subscriptions: [{ ...(stripeRaw.subscriptions[0] as object), id: 'sub_M', metadata: { contractId: 'c1' } }, { ...(stripeRaw.subscriptions[0] as object), id: 'sub_N' }] };
  const m = mapStripe(raw);
  expect(m.subscriptions.find((s) => s.externalId === 'sub_M')!.metadataContractId).toBe('c1');
  expect(m.subscriptions.find((s) => s.externalId === 'sub_N')!.metadataContractId).toBeNull();
});
