import { describe, expect, test } from 'vitest';
import { refresh } from '@/data/engine';
import { detectSubscriptionChanges } from '@/domain/detectors/subscriptions';
import type { StripeTakeover, Subscription } from '@/domain/types';
import { NOW_0930 as NOW, base, stateWith } from './helpers';
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
    const i = detectSubscriptionChanges(s, NOW).find((x) => x.dedupeKey === key)!;
    expect(i).toMatchObject({ type: 'subscription_changed', company: 'nexus', priority: 'today', nextStep: 'Vertrag prüfen', needsSources: ['stripe_nexus'], refs: [expect.objectContaining({ kind: 'member', id: 'k-ayse' })] });
    expect(refresh(s, NOW, false).contracts).toEqual(s.contracts);
  });
  describe('reguläres Abo-Ende (bestätigtes Enddatum erreicht)', () => {
    const ended = (end: string, confirmedEnd: string | null = end) =>
      patchSub(confirmedSub(stripeState, 'sub_A', 'k-ayse'), 'sub_A', { status: 'canceled', cancelAt: end, endDate: end, confirmedEndDate: confirmedEnd });
    const keys = (s: ReturnType<typeof ended>) => detectSubscriptionChanges(s, NOW).map((i) => i.dedupeKey);
    test('Enddatum erreicht → kein Kündigungs-Hinweis', () => expect(keys(ended('2026-11-01'))).not.toContain('sub:sub_A:canceled'));
    test('am Endtag selbst → kein Kündigungs-Hinweis', () => expect(keys(ended('2026-11-12'))).not.toContain('sub:sub_A:canceled'));
    test('vor dem Enddatum gekündigt → Hinweis', () => expect(keys(ended('2027-03-01'))).toContain('sub:sub_A:canceled'));
    test('Enddatum weicht vom bestätigten ab → Hinweis', () => expect(keys(ended('2026-11-01', '2027-03-01'))).toContain('sub:sub_A:canceled'));
    test('ohne Enddatum → Hinweis', () =>
      expect(detectSubscriptionChanges(patchSub(confirmedSub(stripeState, 'sub_A', 'k-ayse'), 'sub_A', { status: 'canceled', cancelAt: null, endDate: null, confirmedEndDate: null }), NOW).map((i) => i.dedupeKey)).toContain('sub:sub_A:canceled'));
  });
  test('Erstattung → Hinweis', () => expect(detectSubscriptionChanges(confirmedSub(stripeState, 'sub_B', 'k-weber'), NOW).some((i) => i.dedupeKey === 'sub:sub_B:refund:re_B1')).toBe(true));
  test('Erstattung ohne Abo-Referenz findet das Abo über die erstattete Zahlung', () => {
    const s = confirmedSub(stripeState, 'sub_B', 'k-weber');
    const noRef = { ...s, payments: s.payments.map((p) => (p.externalId === 're_B1' ? { ...p, subscriptionExternalId: undefined } : p)) };
    expect(detectSubscriptionChanges(noRef, NOW).some((i) => i.dedupeKey === 'sub:sub_B:refund:re_B1')).toBe(true);
  });
  test('unbestätigtes Abo → keine Hinweise', () => expect(detectSubscriptionChanges(patchSub(stripeState, 'sub_A', { status: 'canceled' }), NOW)).toEqual([]));
  test('unverändertes bestätigtes Abo → keine Hinweise', () => expect(detectSubscriptionChanges(confirmedSub(stripeState, 'sub_F', 'k-f'), NOW)).toEqual([]));
});

describe('Abo einer Umstellung: Preis gegen den Plan', () => {
  const rates = [
    { no: 1, dueDate: '2026-12-01', amountCents: 45000 },
    { no: 2, dueDate: '2027-01-01', amountCents: 30000 },
    { no: 3, dueDate: '2027-02-01', amountCents: 30000 },
  ];
  const t: StripeTakeover = {
    id: 'stripe-takeover-c1-1', contractId: 'c1', contactId: 'm1', actionId: 'stripe-takeover-c1-1', actionVersion: 1, status: 'active',
    token: 'tok', link: 'x/zahlung/tok', mode: 'first_rate', rates, openCents: 105000, stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1',
    scheduleId: 'sub_sched_test_1', subscriptionExternalId: 'sub_test_1', isDemo: false, linkSentAt: '2026-11-05T08:00:00Z', setUpAt: '2026-11-10T08:00:00Z',
  };
  const sub = (priceCents: number): Subscription => ({
    id: 's1', connectionId: 'stripe_nexus', externalId: 'sub_test_1', stripeCustomerId: 'cus_test_1', customerName: 'Erika Muster', customerEmail: 'erika@example.de',
    productName: 'NEXUS-Mitgliedschaft (Ratenplan)', amountCents: null, priceCents, currency: 'eur', interval: 'month', startDate: '2026-12-01', anchorDay: 1,
    cancelAt: null, endDate: '2027-03-01', installments: null, status: 'active', disputes: [], contractId: 'c1', confirmedPriceCents: null, confirmedEndDate: '2027-03-01', metadataContractId: 'c1',
  });
  const world = (priceCents: number, status: StripeTakeover['status'] = 'active') =>
    stateWith({
      contacts: [{ id: 'm1', company: 'nexus', kind: 'member', name: 'Erika Muster', phones: [], emails: ['erika@example.de'] }],
      contracts: [{ ...base, id: 'c1', contactId: 'm1', billing: status === 'aborted' ? 'legacy' : 'stripe', plan: { takeoverId: t.id, paidCents: 15000, rates } }],
      takeovers: [{ ...t, status }], subscriptions: [sub(priceCents)],
    });
  const keys = (s: ReturnType<typeof world>) => detectSubscriptionChanges(s, NOW).map((i) => i.dedupeKey);
  test('Ratenwechsel laut Plan ist kein „Preis geändert“', () => {
    expect(keys(world(30000))).not.toContain('sub:sub_test_1:price');
    expect(keys(world(45000))).not.toContain('sub:sub_test_1:price');
  });
  test('Preis außerhalb des Plans → „Preis geändert“', () => {
    const i = detectSubscriptionChanges(world(99900), NOW).find((x) => x.dedupeKey === 'sub:sub_test_1:price')!;
    expect(i.title).toBe('Erika Muster: Preis des Abos geändert');
  });
  test('abgebrochene Umstellung: Plan-Preis ebenfalls kein „Preis geändert“', () => expect(keys(world(30000, 'aborted'))).not.toContain('sub:sub_test_1:price'));
});
