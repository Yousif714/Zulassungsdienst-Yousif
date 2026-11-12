import { describe, expect, test } from 'vitest';
import { refresh } from '@/data/engine';
import { detectSubscriptionChanges } from '@/domain/detectors/subscriptions';
import type { Subscription } from '@/domain/types';
import { NOW_0930 as NOW } from './helpers';
import { confirmedSub, patchSub, stripeState } from './import/helpers';

describe('detectSubscriptionChanges', () => {
  test.each<[string, Partial<Subscription>, string]>([
    ['Kündigung', { status: 'canceled' }, 'sub:sub_A:canceled'],
    ['Enddatum geändert', { cancelAt: '2027-03-01', endDate: '2027-03-01' }, 'sub:sub_A:end'],
    ['Preisänderung', { priceCents: 35000 }, 'sub:sub_A:price'],
    ['past_due', { status: 'past_due' }, 'sub:sub_A:past_due'],
    ['Chargeback', { disputes: ['dp_1'] }, 'sub:sub_A:dispute'],
  ])('%s → Hinweis, Vertrag unverändert', (_, patch, key) => {
    const s = patchSub(confirmedSub(stripeState, 'sub_A', 'k-ayse'), 'sub_A', patch);
    const i = detectSubscriptionChanges(s).find((x) => x.dedupeKey === key)!;
    expect(i).toMatchObject({ type: 'subscription_changed', company: 'nexus', priority: 'today', nextStep: 'Vertrag prüfen', needsSources: ['stripe_nexus'], refs: [expect.objectContaining({ kind: 'member', id: 'k-ayse' })] });
    expect(refresh(s, NOW, false).contracts).toEqual(s.contracts);
  });
  test('Erstattung → Hinweis', () => expect(detectSubscriptionChanges(confirmedSub(stripeState, 'sub_B', 'k-weber')).some((i) => i.dedupeKey === 'sub:sub_B:refund:re_B1')).toBe(true));
  test('Erstattung ohne Abo-Referenz findet das Abo über die erstattete Zahlung', () => {
    const s = confirmedSub(stripeState, 'sub_B', 'k-weber');
    const noRef = { ...s, payments: s.payments.map((p) => (p.externalId === 're_B1' ? { ...p, subscriptionExternalId: undefined } : p)) };
    expect(detectSubscriptionChanges(noRef).some((i) => i.dedupeKey === 'sub:sub_B:refund:re_B1')).toBe(true);
  });
  test('unbestätigtes Abo → keine Hinweise', () => expect(detectSubscriptionChanges(patchSub(stripeState, 'sub_A', { status: 'canceled' }))).toEqual([]));
  test('unverändertes bestätigtes Abo → keine Hinweise', () => expect(detectSubscriptionChanges(confirmedSub(stripeState, 'sub_F', 'k-f'))).toEqual([]));
});
