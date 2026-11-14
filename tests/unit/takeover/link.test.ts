import { describe, expect, test } from 'vitest';
import { syncTakeovers, takeoverSubscriptionFor } from '@/domain/takeover/link';
import { detectTakeover } from '@/domain/detectors/takeover';
import { phaseStartUnix, planEndDate, schedulePhases } from '@/domain/takeover/plan';
import { mapStripe, type StripeRaw } from '@/domain/import/stripe';
import { mergeBatch } from '@/domain/import/merge';
import { detectSubscriptionChanges } from '@/domain/detectors/subscriptions';
import type { AppState, Installment, StripeTakeover, Subscription } from '@/domain/types';
import { base, stateWith, tx } from '../helpers';
import { applyEvent } from '@/data/engine';
import { emptyBatch } from '@/domain/import/batch';
import { seq } from '../import/helpers';

const TODAY = '2026-11-13';
const AT = new Date('2026-11-13T09:00:00Z');
const rates: Installment[] = [
  { no: 1, dueDate: '2026-12-31', amountCents: 30000 },
  { no: 2, dueDate: '2027-01-31', amountCents: 30000 },
  { no: 3, dueDate: '2027-02-28', amountCents: 30000 },
];
const takeover = (p: Partial<StripeTakeover> = {}): StripeTakeover => ({
  id: 'stripe-takeover-c1-1', contractId: 'c1', contactId: 'm1', actionId: 'stripe-takeover-c1-1', actionVersion: 1, status: 'set_up',
  token: 'demo-tok', link: 'x/zahlung/demo-tok', mode: 'first_rate', rates, openCents: 90000, stripeCustomerId: 'cus_test_1',
  paymentMethodId: 'pm_test_1', scheduleId: 'sub_sched_test_1', subscriptionExternalId: null, isDemo: false, linkSentAt: '2026-11-10T08:00:00Z', setUpAt: '2026-11-12T08:00:00Z', ...p,
});
const sub = (p: Partial<Subscription> = {}): Subscription => ({
  id: 's1', connectionId: 'stripe_nexus', externalId: 'sub_test_1', stripeCustomerId: 'cus_test_1', customerName: 'Erika Muster', customerEmail: 'erika@example.de',
  productName: 'NEXUS-Mitgliedschaft (Ratenplan)', amountCents: null, priceCents: 30000, currency: 'eur', interval: 'month', startDate: '2026-12-31', anchorDay: 31,
  cancelAt: null, endDate: null, installments: null, status: 'active', disputes: [], contractId: null, confirmedPriceCents: null, confirmedEndDate: null, metadataContractId: 'c1', ...p,
});
const world = (t: Partial<StripeTakeover>, s: Partial<Subscription>, extra: Partial<AppState> = {}): AppState =>
  stateWith({
    contacts: [{ id: 'm1', company: 'nexus', kind: 'member', name: 'Erika Muster', phones: [], emails: ['erika@example.de'] }],
    contracts: [{ ...base, id: 'c1', contactId: 'm1', billing: 'stripe' }],
    takeovers: [takeover(t)], subscriptions: [sub(s)], ...extra,
  });
const planEnd = planEndDate(schedulePhases(rates, '2026-11-12'), '2026-11-12');

describe('syncTakeovers', () => {
  test('Abo des Zeitplans wird automatisch verknüpft, ohne Vorschlag', () => {
    const s0 = world({}, {});
    const r = syncTakeovers(s0, TODAY, AT);
    expect(r.state.subscriptions[0]).toMatchObject({ contractId: 'c1', confirmedPriceCents: null, confirmedEndDate: planEnd });
    expect(r.state.takeovers[0]).toMatchObject({ status: 'active', subscriptionExternalId: 'sub_test_1', activeAt: AT.toISOString() });
    expect(r.state.contracts.length).toBe(s0.contracts.length);
    expect(r.audit).toEqual(['Stripe-Abo verknüpft: Erika Muster']);
  });

  test('importiertes Enddatum aus dem Zeitplan = planEndDate (kein „Enddatum geändert“)', () => {
    const phases = schedulePhases(rates, '2026-11-12');
    const unix = phaseStartUnix(planEndDate(phases, '2026-11-12')) as number;
    const raw: StripeRaw = {
      subscriptions: [{
        id: 'sub_test_1', status: 'active', customer: { id: 'cus_test_1', name: 'Erika Muster', email: 'erika@example.de' }, currency: 'eur',
        start_date: phaseStartUnix('2026-12-31') as number, billing_cycle_anchor: phaseStartUnix('2026-12-31') as number, cancel_at: null,
        metadata: { contractId: 'c1' }, schedule: { id: 'sub_sched_test_1', phases: [{ start_date: 1, end_date: unix }] },
        items: { data: [{ price: { unit_amount: 30000, currency: 'eur', product: 'prod_x', recurring: { interval: 'month', interval_count: 1 } } }] },
      }],
      products: [{ id: 'prod_x', name: 'NEXUS-Mitgliedschaft (Ratenplan)' }], invoices: [], refunds: [], disputes: [],
    };
    const merged = mergeBatch(world({}, {}, { subscriptions: [] }), mapStripe(raw), seq()).state;
    const linked = syncTakeovers(merged, TODAY, AT).state;
    expect(linked.subscriptions[0].endDate).toBe(planEnd);
    expect(linked.subscriptions[0].confirmedEndDate).toBe(planEnd);
    const hints = detectSubscriptionChanges(linked, AT).filter((i) => i.dedupeKey.endsWith(':end'));
    expect(hints).toEqual([]);
  });

  test('vorzeitige Kündigung → abgebrochen und zurück auf legacy', () => {
    const s0 = world({ status: 'active', subscriptionExternalId: 'sub_test_1' }, { status: 'canceled', contractId: 'c1', endDate: '2027-01-05', confirmedEndDate: planEnd });
    const r = syncTakeovers(s0, TODAY, AT);
    expect(r.state.takeovers[0]).toMatchObject({ status: 'aborted', endedAt: AT.toISOString() });
    expect(r.state.contracts[0].billing).toBe('legacy');
    expect(r.audit).toEqual(['Stripe-Abo vorzeitig beendet: Erika Muster, zurück auf Überweisung']);
  });

  test('M10: Abo gekündigt ohne Enddatum, aber alles über Stripe bezahlt → reguläres Ende, kein Rückfall', () => {
    const pay = tx({ id: 'p-stripe', source: 'stripe', connectionId: 'stripe_nexus', externalId: 'in_test_1', amountCents: 120000, bookedOn: '2026-11-12' });
    const s0 = world({ status: 'active', subscriptionExternalId: 'sub_test_1' }, { status: 'canceled', contractId: 'c1', endDate: null, confirmedEndDate: planEnd },
      { payments: [pay], allocations: [{ paymentId: pay.id, contractId: 'c1', amountCents: 120000, method: 'auto' }] });
    const r = syncTakeovers(s0, TODAY, AT);
    expect(r.state.takeovers[0].status).toBe('active');
    expect(r.state.contracts[0].billing).toBe('stripe');
    expect(r.audit).toEqual([]);
  });

  test('reguläres Ende → bleibt aktiv, kein Rückfall', () => {
    const s0 = world({ status: 'active', subscriptionExternalId: 'sub_test_1' }, { status: 'canceled', contractId: 'c1', endDate: '2026-11-10', confirmedEndDate: '2026-11-10' });
    const r = syncTakeovers(s0, TODAY, AT);
    expect(r.state.takeovers[0].status).toBe('active');
    expect(r.state.contracts[0].billing).toBe('stripe');
    expect(r.audit).toEqual([]);
  });

  test('Abbruch → neue Umstellung → verknüpft mit neuem Abo, bleibt aktiv; altes Abo bleibt unverändert', () => {
    const old = takeover({ id: 'stripe-takeover-c1-1', status: 'aborted', subscriptionExternalId: 'sub_old', endedAt: '2026-11-01T00:00:00Z' });
    const neu = takeover({ id: 'stripe-takeover-c1-2', linkSentAt: '2026-11-11T08:00:00Z' });
    const oldSub = sub({ id: 's0', externalId: 'sub_old', status: 'canceled', contractId: 'c1', endDate: '2026-12-01', confirmedEndDate: '2027-02-28' });
    const s0 = world({}, {}, { takeovers: [old, neu], subscriptions: [oldSub, sub({ id: 's1', externalId: 'sub_new' })] });
    const r1 = syncTakeovers(s0, TODAY, AT);
    expect(r1.state.subscriptions.find((x) => x.externalId === 'sub_new')).toMatchObject({ contractId: 'c1', confirmedEndDate: planEnd });
    expect(r1.state.subscriptions.find((x) => x.externalId === 'sub_old')).toEqual(oldSub);
    expect(r1.state.takeovers.find((x) => x.id === 'stripe-takeover-c1-2')).toMatchObject({ status: 'active', subscriptionExternalId: 'sub_new' });
    const r2 = syncTakeovers(r1.state, TODAY, AT);
    expect(r2.state.takeovers.find((x) => x.id === 'stripe-takeover-c1-2')!.status).toBe('active');
    expect(r2.state.contracts[0].billing).toBe('stripe');
    expect(r2.audit).toEqual([]);
  });

  test('Abo eines fremden Kunden verknüpft nicht', () => {
    const r = syncTakeovers(world({}, { stripeCustomerId: 'cus_test_fremd' }), TODAY, AT);
    expect(r.state.takeovers[0].status).toBe('set_up');
    expect(r.state.subscriptions[0].contractId).toBeNull();
  });

  test('Demo-Umstellung verknüpft kein echtes Abo', () => {
    const r = syncTakeovers(world({ isDemo: true }, {}), TODAY, AT);
    expect(r.state.takeovers[0].status).toBe('set_up');
    expect(r.state.subscriptions[0].contractId).toBeNull();
  });

  test('Abo mit fremder Vertrags-ID verknüpft nicht', () => {
    const r = syncTakeovers(world({}, { metadataContractId: 'c-anders' }), TODAY, AT);
    expect(r.state.takeovers[0].status).toBe('set_up');
    expect(r.state.subscriptions[0].contractId).toBeNull();
  });
});

test('importBatch verknüpft und schreibt das Audit (Akteur system)', () => {
  const s0 = world({}, {}, { subscriptions: [] });
  const batch = { ...emptyBatch(), subscriptions: mapStripe({ subscriptions: [{ id: 'sub_test_1', status: 'active', customer: { id: 'cus_test_1', name: 'Erika Muster' }, currency: 'eur', start_date: 1798700400, metadata: { contractId: 'c1' }, items: { data: [] } }], products: [], invoices: [], refunds: [], disputes: [] }).subscriptions };
  const r = applyEvent(s0, { type: 'importBatch', connectionId: 'stripe_nexus', batch, cursor: null, complete: true }, { at: AT, isDemo: false, newId: seq() }).state;
  expect(r.takeovers[0].status).toBe('active');
  expect(r.subscriptions[0].contractId).toBe('c1');
  expect(r.audit.find((a) => a.text === 'Stripe-Abo verknüpft: Erika Muster')).toMatchObject({ actor: 'system' });
  expect(r.contracts.length).toBe(1);
});

describe('takeoverSubscriptionFor: ein Prädikat für Abgleich und Hinweis (M7)', () => {
  const other = takeover({ id: 'stripe-takeover-c1-0', status: 'active', subscriptionExternalId: 'sub_test_1', linkSentAt: '2026-11-01T08:00:00Z' });
  const cases: [string, AppState, boolean][] = [
    ['passendes Abo', world({}, {}), true],
    ['Demo-Umstellung', world({ isDemo: true }, {}), false],
    ['fremder Kunde', world({}, { stripeCustomerId: 'cus_test_9' }), false],
    ['gekündigtes Abo', world({}, { status: 'canceled' }), false],
    ['Abo an anderem Vertrag', world({}, { contractId: 'c2' }), false],
    ['Abo gehört anderer Umstellung', world({}, {}, { takeovers: [takeover(), other] }), false],
  ];
  test.each(cases)('%s', (_n, s, match) => {
    const t = s.takeovers.find((x) => x.id === 'stripe-takeover-c1-1')!;
    expect(takeoverSubscriptionFor(s, t)?.externalId === 'sub_test_1').toBe(match);
    const linked = syncTakeovers(s, TODAY, AT).state.takeovers.find((x) => x.id === t.id)!.status === 'active';
    expect(linked).toBe(match);
    // Hinweis „Abo ohne Umstellung“ schweigt genau dann, wenn der Abgleich das Abo verknüpfen wird (oder es schon zugeordnet/gekündigt ist).
    const orphan = detectTakeover(s, AT).some((i) => i.type === 'takeover_subscription_orphan');
    const assigned = s.subscriptions[0].contractId !== null || s.subscriptions[0].status === 'canceled' || s.takeovers.some((o) => o.subscriptionExternalId === 'sub_test_1');
    expect(orphan).toBe(!match && !assigned);
  });
});
