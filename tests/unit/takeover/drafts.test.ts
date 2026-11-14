import { describe, expect, test } from 'vitest';
import { paymentLinkFor, takeoverLinkFor } from '@/domain/payment-link';
import { ensureTakeoverDrafts } from '@/domain/takeover/drafts';
import type { Action, AppState, Installment, MemberContract, Payment, StripeTakeover } from '@/domain/types';
import { base, stateWith } from '../helpers';

const lena = { id: 'm-lena', company: 'nexus' as const, kind: 'member' as const, name: 'Lena Kaya', phones: [], emails: ['lena@example.de'] };
const legacy: MemberContract = { ...base, id: 'c1', contactId: 'm-lena' };
const planRates: Installment[] = [
  { no: 1, dueDate: '2026-12-31', amountCents: 30000 },
  { no: 2, dueDate: '2027-01-31', amountCents: 30000 },
];
const takeover = (p: Partial<StripeTakeover> = {}): StripeTakeover => ({
  id: 'stripe-takeover-c1-1', contractId: 'c1', contactId: 'm-lena', actionId: 'stripe-takeover-c1-1', actionVersion: 1, status: 'link_sent',
  token: 'tok', link: 'https://app.example.de/zahlung/tok', mode: 'first_rate', rates: planRates, openCents: 60000, stripeCustomerId: 'cus_test_1',
  paymentMethodId: null, scheduleId: null, subscriptionExternalId: null, isDemo: false, linkSentAt: '2026-11-25T08:00:00Z', ...p,
});
const bank = (p: Partial<Payment> = {}): Payment => ({ id: 'p-lena', company: 'nexus', source: 'bank', connectionId: 'bank_qonto', externalId: 'qonto-1', amountCents: 30000, bookedOn: '2026-11-01', kind: 'incoming', payerName: 'Lena Kaya', ...p });
const paidAlloc = (amountCents: number) => ({ paymentId: 'p-lena', contractId: 'c1', amountCents, method: 'auto' as const });
const world = (p: Partial<AppState> = {}): AppState => stateWith({ contacts: [lena], contracts: [legacy], ...p });
const draft = (p: Partial<Action> = {}): Action => ({
  id: 'stripe-takeover-c1-1', type: 'stripe_takeover', company: 'nexus', title: 'Umstellung auf Stripe: Lena Kaya', version: 1, status: 'draft', createdAt: '2026-11-20T08:00:00Z', isDemo: false,
  payload: { contractId: 'c1', contactId: 'm-lena', name: 'Lena Kaya', email: 'lena@example.de', mode: 'first_rate', rates: [{ no: 1, dueDate: '2026-12-01', amountCents: 30000 }], openCents: 90000 }, ...p,
});
const T1 = new Date('2026-11-28T08:00:00Z');

describe('Erinnerung vor der Rate', () => {
  test('3 Tage vor Fälligkeit entsteht genau ein Erinnerungsentwurf', () => {
    const st = ensureTakeoverDrafts(ensureTakeoverDrafts(world(), T1, false), new Date('2026-11-28T09:00:00Z'), false);
    const found = st.actions.filter((a) => a.id === 'upcoming-c1-2026-12-01');
    expect(found).toHaveLength(1);
    expect(st.actions).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: 'send_reminder', status: 'draft', version: 1, insightKey: 'upcoming:c1:2026-12-01', title: 'Erinnerung an Lena Kaya' });
    expect(found[0].payload).toEqual({ threadId: 't-m-lena', channel: 'whatsapp', contactId: 'm-lena', text: 'Hallo Lena, kurze Erinnerung: Am 01.12.2026 ist deine NEXUS-Rate über 300,00 € fällig.' });
  });
  test('mit Umstellung (Link verschickt) enthält die Erinnerung den Stripe-Link', () => {
    const st = ensureTakeoverDrafts(world({ takeovers: [takeover()] }), T1, false);
    const a = st.actions.find((x) => x.id === 'upcoming-c1-2026-12-01')!;
    expect(a.payload.text).toBe('Hallo Lena, kurze Erinnerung: Am 01.12.2026 ist deine NEXUS-Rate über 300,00 € fällig. Bequemer geht es mit automatischer Abbuchung: https://app.example.de/zahlung/tok');
  });
  test('Plan geändert: kein toter Link und kein Demo-Link in der Erinnerung', () => {
    const s = world({ takeovers: [takeover({ status: 'plan_changed' })] });
    expect(takeoverLinkFor(s, 'c1')).toBeNull();
    expect(paymentLinkFor(s, 'c1')).toBe('https://buy.stripe.com/demo/c1');
    const a = ensureTakeoverDrafts(s, T1, false).actions.find((x) => x.id === 'upcoming-c1-2026-12-01')!;
    expect(a.payload.text).toBe('Hallo Lena, kurze Erinnerung: Am 01.12.2026 ist deine NEXUS-Rate über 300,00 € fällig.');
  });
  test('ohne Umstellung kein Demo-Link in der Erinnerung, paymentLinkFor behält den Demo-Fallback', () => {
    const s = world();
    expect(takeoverLinkFor(s, 'c1')).toBeNull();
    expect(paymentLinkFor(s, 'c1')).toBe('https://buy.stripe.com/demo/c1');
    expect(paymentLinkFor(world({ takeovers: [takeover()] }), 'c1')).toBe('https://app.example.de/zahlung/tok');
  });
  test('ab eingerichtet: offener Erinnerungsentwurf wird abgebrochen, kein neuer', () => {
    const open = ensureTakeoverDrafts(world(), T1, false);
    expect(open.actions[0]).toMatchObject({ id: 'upcoming-c1-2026-12-01', status: 'draft' });
    const viaStripe = { ...open, contracts: [{ ...legacy, billing: 'stripe' as const }], takeovers: [takeover({ status: 'set_up', setUpAt: '2026-11-29T08:00:00Z', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' })] };
    const st = ensureTakeoverDrafts(viaStripe, new Date('2026-11-29T09:00:00Z'), false);
    expect(st.actions).toHaveLength(1);
    expect(st.actions[0].status).toBe('cancelled');
  });
  test('Fälligkeit vorbei: offener Erinnerungsentwurf wird abgebrochen', () => {
    const open = ensureTakeoverDrafts(world(), T1, false);
    const st = ensureTakeoverDrafts(open, new Date('2026-12-02T09:00:00Z'), false);
    expect(st.actions.find((a) => a.id === 'upcoming-c1-2026-12-01')!.status).toBe('cancelled');
  });
  test('freigegebene Erinnerung wird nicht neu angelegt und nicht angefasst', () => {
    const open = ensureTakeoverDrafts(world(), T1, false);
    const sent = { ...open, actions: open.actions.map((a) => ({ ...a, status: 'executed' as const })) };
    const st = ensureTakeoverDrafts(sent, new Date('2026-11-29T09:00:00Z'), false);
    expect(st.actions).toHaveLength(1);
    expect(st.actions[0].status).toBe('executed');
  });
});

describe('Erinnerungstext nachziehen', () => {
  test('Link erst nach dem Entwurf verschickt: offener Entwurf bekommt den Link, neue Version', () => {
    const first = ensureTakeoverDrafts(world(), T1, false);
    expect(first.actions[0].payload.text).not.toContain('https://');
    const st = ensureTakeoverDrafts({ ...first, takeovers: [takeover()] }, new Date('2026-11-28T09:00:00Z'), false);
    expect(st.actions).toHaveLength(1);
    expect(st.actions[0]).toMatchObject({ status: 'draft', version: 2 });
    expect(st.actions[0].payload.text).toContain('https://app.example.de/zahlung/tok');
    expect(st.actions[0].payload).toMatchObject({ threadId: 't-m-lena', contactId: 'm-lena' });
  });
  test('idempotent: gleicher Text erzeugt keine neue Version', () => {
    const a = ensureTakeoverDrafts(world({ takeovers: [takeover()] }), T1, false);
    const b = ensureTakeoverDrafts(a, new Date('2026-11-28T09:00:00Z'), false);
    expect(b.actions[0].version).toBe(1);
  });
  test('freigegebener Entwurf wird nicht umgeschrieben', () => {
    const first = ensureTakeoverDrafts(world(), T1, false);
    const sent = { ...first, actions: first.actions.map((a) => ({ ...a, status: 'executed' as const })), takeovers: [takeover()] };
    const st = ensureTakeoverDrafts(sent, new Date('2026-11-28T09:00:00Z'), false);
    expect(st.actions[0]).toMatchObject({ status: 'executed', version: 1 });
    expect(st.actions[0].payload.text).not.toContain('https://');
  });
  test('Link-Erinnerung: abweichender Text im offenen Entwurf wird nachgezogen', () => {
    const s = world({ takeovers: [takeover({ linkSentAt: '2026-11-20T08:00:00Z' })] });
    const first = ensureTakeoverDrafts(s, new Date('2026-11-27T10:00:00Z'), false);
    const nudge = first.actions.find((x) => x.id.startsWith('link-nudge-'))!;
    const stale = { ...first, actions: first.actions.map((a) => (a.id === nudge.id ? { ...a, payload: { ...a.payload, text: 'alt' } } : a)) };
    const st = ensureTakeoverDrafts(stale, new Date('2026-11-27T11:00:00Z'), false);
    const n = st.actions.find((x) => x.id === nudge.id)!;
    expect(n.version).toBe(2);
    expect(n.payload.text).toBe(nudge.payload.text);
  });
});

describe('Link-Erinnerung', () => {
  test('Link seit 7 Tagen ungenutzt → genau ein Entwurf mit Link', () => {
    const s = world({ takeovers: [takeover({ linkSentAt: '2026-11-20T08:00:00Z' })] });
    const st = ensureTakeoverDrafts(ensureTakeoverDrafts(s, new Date('2026-11-27T10:00:00Z'), false), new Date('2026-11-27T11:00:00Z'), false);
    const a = st.actions.filter((x) => x.id === 'link-nudge-stripe-takeover-c1-1');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: 'send_reminder', status: 'draft', insightKey: 'takeover-link:stripe-takeover-c1-1', title: 'Link-Erinnerung an Lena Kaya' });
    expect(a[0].payload.text).toBe('Hallo Lena, hast du meinen Link schon gesehen? Dort kannst du deine NEXUS-Raten automatisch abbuchen lassen: https://app.example.de/zahlung/tok');
  });
  test('nach 6 Tagen noch kein Entwurf', () => {
    const s = world({ takeovers: [takeover({ linkSentAt: '2026-11-21T08:00:00Z' })] });
    expect(ensureTakeoverDrafts(s, new Date('2026-11-27T10:00:00Z'), false).actions.filter((x) => x.id.startsWith('link-nudge-'))).toEqual([]);
  });
});

describe('Umstellungs-Entwurf aktuell halten', () => {
  const start = (extra: Partial<AppState> = {}) => world({ actions: [draft()], ...extra });
  test('Plan ändert sich vor Freigabe → stripe_takeover-Entwurf neue Version', () => {
    // Entwurf kennt 900 € offen; inzwischen kamen 600 € an (Vertrag 1.200 €) → Rest 600 €.
    const s = start({ payments: [bank({ amountCents: 60000 })], allocations: [paidAlloc(60000)] });
    const st = ensureTakeoverDrafts(s, new Date('2026-11-20T09:00:00Z'), false);
    const a = st.actions.find((x) => x.id === 'stripe-takeover-c1-1')!;
    expect(a.status).toBe('draft');
    expect(a.version).toBe(2);
    expect(a.payload.openCents).toBe(60000);
    expect(a.payload.mode).toBe('first_rate');
  });
  test('Plan unverändert → Entwurf bleibt Version 1', () => {
    const s = start();
    const once = ensureTakeoverDrafts(s, new Date('2026-11-20T09:00:00Z'), false);
    const twice = ensureTakeoverDrafts(once, new Date('2026-11-20T10:00:00Z'), false);
    expect(twice.actions.find((x) => x.id === 'stripe-takeover-c1-1')!.version).toBe(once.actions.find((x) => x.id === 'stripe-takeover-c1-1')!.version);
    expect(twice.actions.filter((x) => x.type === 'stripe_takeover')).toHaveLength(1);
  });
  test('voll bezahlt vor Freigabe → stripe_takeover-Entwurf abgebrochen', () => {
    const s = start({ payments: [bank({ amountCents: 120000 })], allocations: [paidAlloc(120000)] });
    const st = ensureTakeoverDrafts(s, new Date('2026-11-20T09:00:00Z'), false);
    expect(st.actions.find((x) => x.id === 'stripe-takeover-c1-1')!.status).toBe('cancelled');
  });
});
