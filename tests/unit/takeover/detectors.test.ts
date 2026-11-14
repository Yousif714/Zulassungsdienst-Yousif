import { describe, expect, test } from 'vitest';
import { runDetectors } from '@/domain/detectors';
import { detectTakeover, takeoverRef, unusedLinks, upcomingRates } from '@/domain/detectors/takeover';
import { detectMemberOverdue } from '@/domain/detectors/members';
import { reminderBlockedReason } from '@/domain/takeover/status';
import type { Action, AppState, Installment, Insight, MemberContract, Payment, StripeTakeover, Subscription } from '@/domain/types';
import { base, stateWith } from '../helpers';

// Legacy-Vertrag aus `base`: 4 × 300,00 €, fällig am 01.10., 01.11., 01.12.2026 und 01.01.2027.
const lena = { id: 'm-lena', company: 'nexus' as const, kind: 'member' as const, name: 'Lena Kaya', phones: [], emails: ['lena@example.de'] };
const planRates: Installment[] = [
  { no: 1, dueDate: '2026-12-31', amountCents: 30000 },
  { no: 2, dueDate: '2027-01-31', amountCents: 30000 },
];
const takeover = (p: Partial<StripeTakeover> = {}): StripeTakeover => ({
  id: 'stripe-takeover-c1-1', contractId: 'c1', contactId: 'm-lena', actionId: 'stripe-takeover-c1-1', actionVersion: 1, status: 'link_sent',
  token: 'tok', link: 'https://app.example.de/zahlung/tok', mode: 'first_rate', rates: planRates, openCents: 60000, stripeCustomerId: 'cus_test_1',
  paymentMethodId: null, scheduleId: null, subscriptionExternalId: null, isDemo: false, linkSentAt: '2026-11-05T08:00:00Z', ...p,
});
const legacy: MemberContract = { ...base, id: 'c1', contactId: 'm-lena' };
const viaStripe: MemberContract = { ...legacy, billing: 'stripe', plan: { takeoverId: 'stripe-takeover-c1-1', paidCents: 60000, rates: planRates } };
const setUp = takeover({ status: 'set_up', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1', setUpAt: '2026-11-20T08:00:00Z' });
const bank = (p: Partial<Payment> = {}): Payment => ({ id: 'p-lena', company: 'nexus', source: 'bank', connectionId: 'bank_qonto', externalId: 'qonto-1', amountCents: 30000, bookedOn: '2026-12-02', kind: 'incoming', payerName: 'Lena Kaya', ...p });
const world = (p: Partial<AppState> = {}): AppState => stateWith({ contacts: [lena], contracts: [legacy], ...p });
const at = (iso: string) => new Date(iso);
const keys = (l: Insight[]) => l.map((i) => i.dedupeKey);

describe('takeoverRef', () => {
  test('zeigt auf die Übernahme-Seite', () =>
    expect(takeoverRef('Erinnerungen')).toEqual({ kind: 'member', id: 'umstellung', href: '/nexus/umstellung', label: 'Erinnerungen' }));
});

describe('Doppelzahlung', () => {
  const paid = (bookedOn: string) =>
    world({ contracts: [viaStripe], takeovers: [setUp], payments: [bank({ bookedOn })], allocations: [{ paymentId: 'p-lena', contractId: 'c1', amountCents: 30000, method: 'auto' }] });

  test('Doppelzahlung nach eingerichtet', () => {
    const i = detectTakeover(paid('2026-12-02'), at('2026-12-02T10:00:00Z')).find((x) => x.type === 'double_payment')!;
    expect(i).toMatchObject({
      dedupeKey: 'double-pay:p-lena', company: 'nexus', priority: 'today', amountCents: 30000,
      title: 'Doppelzahlung: Lena Kaya hat 300,00 € überwiesen',
      body: 'Die Raten laufen seit 20.11.2026 über Stripe. Bitte von Hand erstatten.',
      nextStep: 'Von Hand erstatten', needsSources: ['bank_qonto'],
    });
    expect(i.refs[0]).toMatchObject({ kind: 'member', id: 'c1', href: '/nexus/mitglieder/c1' });
  });
  test('am Tag der Einrichtung zählt schon', () =>
    expect(keys(detectTakeover(paid('2026-11-20'), at('2026-12-02T10:00:00Z')))).toContain('double-pay:p-lena'));
  test('keine Doppelzahlung vor eingerichtet', () =>
    expect(keys(detectTakeover(paid('2026-11-19'), at('2026-12-02T10:00:00Z')))).not.toContain('double-pay:p-lena'));
  test('keine Doppelzahlung, solange der Link nur verschickt ist', () => {
    const s = world({ takeovers: [takeover()], payments: [bank()], allocations: [{ paymentId: 'p-lena', contractId: 'c1', amountCents: 30000, method: 'auto' }] });
    expect(detectTakeover(s, at('2026-12-02T10:00:00Z')).filter((x) => x.type === 'double_payment')).toEqual([]);
  });
  test('Rückbuchung nach eingerichtet ist keine Doppelzahlung, die Überweisung bleibt genau ein Hinweis', () => {
    const s = paid('2026-12-02');
    const ret = bank({ id: 'p-ret', externalId: 'qonto-ret', amountCents: -30000, bookedOn: '2026-12-05' });
    const withReturn = { ...s, payments: [...s.payments, ret], allocations: [...s.allocations, { paymentId: 'p-ret', contractId: 'c1', amountCents: -30000, method: 'auto' as const }] };
    const hints = detectTakeover(withReturn, at('2026-12-06T10:00:00Z')).filter((x) => x.type === 'double_payment');
    expect(hints.map((i) => i.dedupeKey)).toEqual(['double-pay:p-lena']);
    expect(hints[0].title).toBe('Doppelzahlung: Lena Kaya hat 300,00 € überwiesen');
  });
  test('Erstattung (refundOf) ist keine Doppelzahlung', () => {
    const s = paid('2026-12-02');
    const refund = { ...s, payments: [bank({ refundOf: 'qonto-0' })] };
    expect(detectTakeover(refund, at('2026-12-06T10:00:00Z')).filter((x) => x.type === 'double_payment')).toEqual([]);
  });
  test('Stripe-Zahlung ist keine Doppelzahlung', () => {
    const s = { ...paid('2026-12-02'), payments: [bank({ source: 'stripe', connectionId: 'stripe_nexus' })] };
    expect(detectTakeover(s, at('2026-12-02T10:00:00Z')).filter((x) => x.type === 'double_payment')).toEqual([]);
  });
});

describe('Link nicht genutzt', () => {
  const s = world({ takeovers: [takeover()] });
  test('Link 7 Tage ungenutzt (Einstellung 7), nicht nach 6', () => {
    const i = detectTakeover(s, at('2026-11-12T10:00:00Z')).find((x) => x.type === 'takeover_link_unused')!;
    expect(i).toMatchObject({
      dedupeKey: 'takeover-link:stripe-takeover-c1-1', company: 'nexus', priority: 'info',
      title: 'Lena Kaya: Stripe-Link seit 7 Tagen nicht genutzt', nextStep: 'Erinnerung an den Link freigeben', needsSources: ['stripe_nexus'],
    });
    expect(i.refs).toContainEqual(takeoverRef('Umstellung'));
    expect(unusedLinks(s, '2026-11-12').map((t) => t.id)).toEqual(['stripe-takeover-c1-1']);
    expect(detectTakeover(s, at('2026-11-11T10:00:00Z')).filter((x) => x.type === 'takeover_link_unused')).toEqual([]);
    expect(unusedLinks(s, '2026-11-11')).toEqual([]);
  });
  test('Einstellung 3 → schon nach 3 Tagen', () =>
    expect(unusedLinks({ ...s, settings: { ...s.settings, takeoverLinkNudgeDays: 3 } }, '2026-11-08').map((t) => t.id)).toEqual(['stripe-takeover-c1-1']));
  test('nach dem Einrichten kein Hinweis mehr', () =>
    expect(unusedLinks(world({ contracts: [viaStripe], takeovers: [setUp] }), '2026-11-30')).toEqual([]));
  test('nur die jüngste Umstellung zählt', () => {
    const old = takeover({ id: 'stripe-takeover-c1-1', status: 'withdrawn', linkSentAt: '2026-10-01T08:00:00Z' });
    const fresh = takeover({ id: 'stripe-takeover-c1-2', linkSentAt: '2026-11-10T08:00:00Z' });
    expect(unusedLinks(world({ takeovers: [old, fresh] }), '2026-11-12')).toEqual([]);
  });
});

describe('Plan geändert', () => {
  const changed = world({ takeovers: [takeover({ status: 'plan_changed', paymentMethodId: 'pm_test_1' })] });
  test('Hinweis zur Neu-Freigabe', () => {
    const i = detectTakeover(changed, at('2026-11-12T10:00:00Z')).find((x) => x.type === 'takeover_plan_changed')!;
    expect(i).toMatchObject({ dedupeKey: 'takeover-changed:stripe-takeover-c1-1', priority: 'today', title: 'Lena Kaya: Plan hat sich geändert, Umstellung neu freigeben', needsSources: ['stripe_nexus'] });
  });
  test('kein Hinweis bei offenem Entwurf', () => {
    const draft: Action = { id: 'stripe-takeover-c1-2', type: 'stripe_takeover', company: 'nexus', title: 'x', payload: {}, version: 1, status: 'draft', createdAt: '2026-11-12T09:00:00Z', isDemo: false };
    expect(detectTakeover({ ...changed, actions: [draft] }, at('2026-11-12T10:00:00Z')).filter((x) => x.type === 'takeover_plan_changed')).toEqual([]);
  });
});

describe('Erinnerung vor der Rate', () => {
  const upcoming = (s: AppState, iso: string) => detectTakeover(s, at(iso)).filter((x) => x.type === 'rate_upcoming');
  test('Erinnerung 3 Tage vorher, nicht 4, nicht ab eingerichtet, nicht wenn bezahlt', () => {
    const s = world();
    const [i, ...rest] = upcoming(s, '2026-11-28T10:00:00Z');
    expect(rest).toEqual([]);
    expect(i).toMatchObject({
      dedupeKey: 'upcoming:c1:2026-12-01', company: 'nexus', priority: 'today', amountCents: 30000,
      title: 'Lena Kaya: Rate über 300,00 € am 01.12.2026 fällig', nextStep: 'Erinnerung freigeben', needsSources: ['bank_qonto'],
    });
    expect(i.refs).toContainEqual(takeoverRef('Erinnerungen'));
    expect(upcomingRates(s, '2026-11-28')).toEqual([{ contractId: 'c1', dueDate: '2026-12-01', amountCents: 30000 }]);
    expect(upcoming(s, '2026-11-27T10:00:00Z')).toEqual([]);
    expect(upcoming(world({ contracts: [viaStripe], takeovers: [setUp] }), '2026-11-28T10:00:00Z')).toEqual([]);
    const allPaid = world({ payments: [bank({ amountCents: 90000, bookedOn: '2026-11-01' })], allocations: [{ paymentId: 'p-lena', contractId: 'c1', amountCents: 90000, method: 'auto' }] });
    expect(upcoming(allPaid, '2026-11-28T10:00:00Z')).toEqual([]);
  });
  test('Teilzahlung: nur der Rest der Rate', () => {
    const part = world({ payments: [bank({ amountCents: 70000, bookedOn: '2026-11-01' })], allocations: [{ paymentId: 'p-lena', contractId: 'c1', amountCents: 70000, method: 'auto' }] });
    expect(upcomingRates(part, '2026-11-28')).toEqual([{ contractId: 'c1', dueDate: '2026-12-01', amountCents: 20000 }]);
  });
  test('am Fälligkeitstag selbst noch', () => expect(upcomingRates(world(), '2026-12-01')).toEqual([{ contractId: 'c1', dueDate: '2026-12-01', amountCents: 30000 }]));
  test('Einstellung takeoverReminderDays 5 → schon 5 Tage vorher', () => {
    const s = world();
    const five = { ...s, settings: { ...s.settings, takeoverReminderDays: 5 } };
    expect(upcomingRates(five, '2026-11-26')).toEqual([{ contractId: 'c1', dueDate: '2026-12-01', amountCents: 30000 }]);
    expect(upcomingRates(five, '2026-11-25')).toEqual([]);
    expect(upcomingRates(s, '2026-11-26')).toEqual([]);
  });
  test('mit verschicktem Link: Hinweis im Text', () =>
    expect(upcoming(world({ takeovers: [takeover()] }), '2026-11-28T10:00:00Z')[0].body).toBe('Noch offen: 300,00 €. Der Stripe-Link ist schon verschickt.'));
});

describe('Stripe-Abo mit Vertrags-ID ohne passende Umstellung', () => {
  const sub = (p: Partial<Subscription> = {}): Subscription => ({
    id: 's-o', connectionId: 'stripe_nexus', externalId: 'sub_test_orphan', stripeCustomerId: 'cus_test_9', customerName: 'Max Muster', customerEmail: 'max@example.de',
    productName: 'NEXUS-Mitgliedschaft (Ratenplan)', amountCents: null, priceCents: 30000, currency: 'eur', interval: 'month', startDate: '2026-12-31', anchorDay: 31,
    cancelAt: null, endDate: null, installments: null, status: 'active', disputes: [], contractId: null, confirmedPriceCents: null, confirmedEndDate: null, metadataContractId: 'c-unbekannt', ...p,
  });
  test('verwaistes Abo → Hinweis', () => {
    const i = detectTakeover(world({ subscriptions: [sub()] }), at('2026-11-12T10:00:00Z')).find((x) => x.type === 'takeover_subscription_orphan')!;
    expect(i).toMatchObject({
      dedupeKey: 'takeover-orphan:sub_test_orphan', company: 'nexus', priority: 'today', amountCents: 30000,
      title: 'Max Muster: Stripe-Abo ohne passende Umstellung', needsSources: ['stripe_nexus'],
    });
    expect(i.refs).toContainEqual(takeoverRef('Umstellung'));
  });
  test('fremder Kunde mit eigener Vertrags-ID → Hinweis', () =>
    expect(keys(detectTakeover(world({ contracts: [viaStripe], takeovers: [setUp], subscriptions: [sub({ metadataContractId: 'c1' })] }), at('2026-11-12T10:00:00Z')))).toContain('takeover-orphan:sub_test_orphan'));
  test('verknüpftes Abo → kein Hinweis', () => {
    const linked = world({
      contracts: [viaStripe],
      takeovers: [takeover({ status: 'active', setUpAt: '2026-11-20T08:00:00Z', subscriptionExternalId: 'sub_test_orphan' })],
      subscriptions: [sub({ metadataContractId: 'c1', stripeCustomerId: 'cus_test_1', contractId: 'c1' })],
    });
    expect(detectTakeover(linked, at('2026-11-12T10:00:00Z')).filter((x) => x.type === 'takeover_subscription_orphan')).toEqual([]);
  });
  test('eigenes Abo einer eingerichteten Umstellung, noch nicht verknüpft → kein Hinweis (wartet auf den Abgleich)', () => {
    const s = world({ contracts: [viaStripe], takeovers: [setUp], subscriptions: [sub({ metadataContractId: 'c1', stripeCustomerId: 'cus_test_1' })] });
    expect(detectTakeover(s, at('2026-11-12T10:00:00Z')).filter((x) => x.type === 'takeover_subscription_orphan')).toEqual([]);
  });
  test('Demo-Umstellung verknüpft nie → Hinweis', () => {
    const s = world({ contracts: [viaStripe], takeovers: [{ ...setUp, isDemo: true }], subscriptions: [sub({ metadataContractId: 'c1', stripeCustomerId: 'cus_test_1' })] });
    expect(keys(detectTakeover(s, at('2026-11-12T10:00:00Z')))).toContain('takeover-orphan:sub_test_orphan');
  });
  test('ohne Vertrags-ID oder gekündigt → kein Hinweis', () => {
    const s = world({ subscriptions: [sub({ metadataContractId: null }), sub({ id: 's-c', externalId: 'sub_test_canceled', status: 'canceled' })] });
    expect(detectTakeover(s, at('2026-11-12T10:00:00Z')).filter((x) => x.type === 'takeover_subscription_orphan')).toEqual([]);
  });
});

test('runDetectors enthält die Umstellungs-Hinweise', () => {
  const now = at('2026-11-28T10:00:00Z');
  const s = world();
  const fresh = { ...s, connections: s.connections.map((c) => ({ ...c, lastSuccessAt: new Date(now.getTime() - 60_000).toISOString() })) };
  expect(keys(runDetectors(fresh, now))).toContain('upcoming:c1:2026-12-01');
});

describe('Rückstand bei laufender Stripe-Abbuchung (I1)', () => {
  test('member_overdue bei set_up → „In Stripe prüfen“ statt Erinnerung', () => {
    const s = world({ contracts: [viaStripe], takeovers: [setUp] });
    const i = detectMemberOverdue(s, at('2027-01-05T10:00:00Z')).find((x) => x.dedupeKey === 'overdue:c1')!;
    expect(i.nextStep).toBe('In Stripe prüfen');
    expect(i.body).toContain('Raten laufen über Stripe');
  });
  test('ohne Umstellung bleibt „Erinnerung vorbereiten“', () => {
    const i = detectMemberOverdue(world(), at('2026-11-12T10:00:00Z')).find((x) => x.dedupeKey === 'overdue:c1')!;
    expect(i.nextStep).toBe('Erinnerung vorbereiten');
  });
  test('reminderBlockedReason nur bei set_up/active', () => {
    expect(reminderBlockedReason(world({ takeovers: [setUp] }), 'c1')).toBe('Raten laufen über Stripe – keine Erinnerung nötig.');
    expect(reminderBlockedReason(world({ takeovers: [takeover({ status: 'active' })] }), 'c1')).not.toBeNull();
    expect(reminderBlockedReason(world({ takeovers: [takeover()] }), 'c1')).toBeNull();
    expect(reminderBlockedReason(world(), 'c1')).toBeNull();
  });
});
