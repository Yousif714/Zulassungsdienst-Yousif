import { describe, expect, test } from 'vitest';
import { classifyBankTx, matchBankPayment } from '@/domain/matching/payments';
import { importKey, mergeImported } from '@/domain/matching/imports';
import { IBAN_KAYA, ctx, tx } from '../helpers';

const p1 = tx();
describe('Import', () => {
  test('Schlüssel', () => expect(importKey({ connectionId: 'bank', externalId: 'x1' })).toBe('bank:x1'));
  test('erneuter Import ändert nichts', () => expect(mergeImported([p1], [p1, { ...p1 }]).length).toBe(1));
  test('bestehende gewinnen, neue kommen dazu', () => {
    const r = mergeImported([p1], [{ ...p1, amountCents: 1 }, tx({ externalId: 'x2' })]);
    expect(r.map((x) => x.amountCents)).toEqual([30000, 30000]);
    expect(r).toHaveLength(2);
  });
});
test('Stripe-Auszahlung erkannt', () => {
  expect(classifyBankTx({ payerName: 'Stripe Technologies Europe Ltd' })).toBe('stripe_payout');
  expect(classifyBankTx({ reference: 'STRIPE PAYOUT po_1QxYz' })).toBe('stripe_payout');
  expect(classifyBankTx({ payerName: 'Mehmet Kaya', reference: 'Rate November' })).toBe('incoming');
});
describe('Zuordnung', () => {
  test('hoch: IBAN + nächste Rate', () => expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 30000 }), ctx)).toMatchObject({ contactId: 'm-kaya', confidence: 'high' }));
  test('hoch: IBAN + Rückstand', () => expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 15000 }), ctx).confidence).toBe('high'));
  test('mittel: IBAN, anderer Betrag', () => expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 12345 }), ctx).confidence).toBe('medium'));
  test('mittel: Name + Betrag ohne IBAN', () => expect(matchBankPayment(tx({ iban: 'DE00UNBEKANNT', payerName: 'S. Yilmaz', amountCents: 30000 }), ctx)).toMatchObject({ contactId: 'm-yilmaz', confidence: 'medium' }));
  test('Rückstand 0 zählt nicht als Treffer', () => expect(matchBankPayment(tx({ iban: 'DE00U', payerName: 'Selin Yilmaz', amountCents: 0 }), ctx).confidence).toBe('low'));
  test('niedrig: Dritter', () => expect(matchBankPayment(tx({ iban: 'DE00X', payerName: 'Firma XY GmbH', amountCents: 90000 }), ctx)).toMatchObject({ contactId: null, confidence: 'low' }));
  test('Stripe-Auszahlung nie Mitglied', () => expect(matchBankPayment(tx({ payerName: 'Stripe', kind: 'stripe_payout', amountCents: 30000, iban: IBAN_KAYA }), ctx)).toMatchObject({ contactId: null, confidence: 'low' }));
});
