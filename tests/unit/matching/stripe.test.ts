import { describe, expect, test } from 'vitest';
import { stripeAllocations } from '@/domain/matching/stripe';
import type { AppState } from '@/domain/types';
import { confirmedSub, stripeState } from '../import/helpers';

const pid = (s: AppState, ext: string) => s.payments.find((p) => p.externalId === ext)!.id;

describe('stripeAllocations', () => {
  test('Zahlungen bestätigter Abos werden auto zugeordnet, auch rückwirkend und Erstattungen', () => {
    const s = confirmedSub(stripeState, 'sub_B', 'k-weber');
    expect(stripeAllocations(s)).toEqual([
      { paymentId: pid(s, 'in_B1'), contractId: 'k-weber', amountCents: 25000, method: 'auto' },
      { paymentId: pid(s, 're_B1'), contractId: 'k-weber', amountCents: -5000, method: 'auto' },
    ]);
  });
  test('unbestätigtes Abo, Auszahlung, schon zugeordnet → nichts', () => {
    expect(stripeAllocations(stripeState)).toEqual([]);
    const s = confirmedSub(stripeState, 'sub_B', 'k-weber');
    const done = { ...s, allocations: stripeAllocations(s) };
    expect(stripeAllocations(done)).toEqual([]);
    const payout = { ...s, payments: s.payments.map((p) => (p.externalId === 'in_B1' ? { ...p, kind: 'stripe_payout' as const } : p)) };
    expect(stripeAllocations(payout).map((a) => a.paymentId)).toEqual([pid(s, 're_B1')]);
  });
  test('Erstattung findet das Abo über die erstattete Zahlung', () => {
    const s = confirmedSub(stripeState, 'sub_B', 'k-weber');
    const noSub = { ...s, payments: s.payments.map((p) => (p.externalId === 're_B1' ? { ...p, subscriptionExternalId: undefined } : p)) };
    expect(stripeAllocations(noSub).map((a) => a.amountCents)).toEqual([25000, -5000]);
  });
});
