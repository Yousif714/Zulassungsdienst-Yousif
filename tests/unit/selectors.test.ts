import { describe, expect, test } from 'vitest';
import { createDemoState } from '@/data/seed';
import { stripeLexCases, unallocatedBankPayments } from '@/data/selectors';
import { reducer, refresh } from '@/data/store';
import { NOW_0930 as NOW } from './helpers';

const s = refresh(createDemoState(), NOW);

describe('Zuordnen-Selektoren', () => {
  test('offene Bankzahlungen: nur eingehend, NEXUS, ohne Zuordnung', () => {
    const ids = unallocatedBankPayments(s).map((p) => p.id);
    expect(ids).toContain('p-yilmaz-1');
    expect(ids).not.toContain('p-payout-1');
    expect(ids).not.toContain('p-kaya-1');
  });

  test('Stripe bezahlt, Lexware offen: Fall verschwindet nach settleInvoice', () => {
    const cases = stripeLexCases(s);
    expect(cases.map((c) => [c.key, c.invoice.id, c.payment.id])).toEqual([['stripe-lex:i-lex-118', 'i-lex-118', 'p-stripe-118']]);
    const s2 = reducer(s, { type: 'settleInvoice', invoiceId: 'i-lex-118', paymentId: 'p-stripe-118' });
    expect(stripeLexCases(s2)).toEqual([]);
  });
});
