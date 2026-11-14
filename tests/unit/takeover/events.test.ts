import { describe, expect, test } from 'vitest';
import { applyEvent, applyEvents, type EngineContext } from '@/data/engine';
import type { StoreEvent } from '@/domain/events';
import type { Action, AppState, Contact, MemberContract, StripeTakeover } from '@/domain/types';
import { base, stateWith, tx } from '../helpers';

function uuidIds(): () => string {
  let n = 0;
  return () => { n += 1; return `6f1c2b3a-0000-4000-8000-${n.toString(16).padStart(12, '0')}`; };
}
const mkCtx = (isDemo = false): EngineContext => ({ at: new Date('2026-11-13T09:00:00Z'), isDemo, newId: uuidIds() });

const people: Contact[] = [
  { id: 'm1', company: 'nexus', kind: 'member', name: 'Erika Muster', phones: [], emails: ['erika@example.de'] },
  { id: 'm2', company: 'nexus', kind: 'member', name: 'Max Beispiel', phones: [], emails: ['max@example.de'] },
  { id: 'm3', company: 'nexus', kind: 'member', name: 'Lea Probe', phones: [], emails: [] },
  { id: 'm4', company: 'nexus', kind: 'member', name: 'Tom Test', phones: [], emails: [] },
  { id: 'm5', company: 'nexus', kind: 'member', name: 'Ina Ticket', phones: [], emails: [] },
  { id: 'm6', company: 'nexus', kind: 'member', name: 'Kai Zwei', phones: [], emails: [] },
];
const contract = (id: string, contactId: string, p: Partial<MemberContract> = {}): MemberContract => ({ ...base, id, contactId, ...p });
const paid = (contractId: string, amountCents: number, id = `p-${contractId}`) => ({
  payment: tx({ id, externalId: `x-${id}`, bookedOn: '2026-11-05', amountCents }),
  allocation: { paymentId: id, contractId, amountCents, method: 'manual' as const },
});

/** Vertrag c1 (Erika), Bank verbunden, 450 € gezahlt → offen 750 €. */
function initial(extra: Partial<AppState> = {}): AppState {
  const p = paid('c1', 45000);
  return stateWith({ contacts: people, contracts: [contract('c1', 'm1')], payments: [p.payment], allocations: [p.allocation], ...extra });
}

const takeoverActions = (s: AppState) => s.actions.filter((a) => a.type === 'stripe_takeover');
const action = (s: AppState, id = 'stripe-takeover-c1-1') => s.actions.find((x) => x.id === id)!;
const lastAudit = (s: AppState) => s.audit[s.audit.length - 1];

function run(s: AppState, es: StoreEvent[], ctx = mkCtx()): AppState {
  return applyEvents(s, es, ctx).state;
}
const execute = (id: string, version: number, output?: Record<string, string>, simulated?: boolean): StoreEvent[] => [
  { type: 'approveAction', id, version, via: 'app' },
  { type: 'actionStarted', id },
  { type: 'actionExecuted', id, result: 'ok', ...(output ? { output } : {}), ...(simulated ? { simulated } : {}) },
];
const OUT = { stripeCustomerId: 'cus_test_1', linkBase: 'https://nexus.example.de' };

/** Vorbereitet und mit Stripe-Kunde ausgeführt → Link verschickt. */
function linkSent(output: Record<string, string> = OUT): AppState {
  return run(initial(), [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }, ...execute('stripe-takeover-c1-1', 1, output)]);
}

describe('Umstellung vorbereiten', () => {
  test('prepareTakeover legt Entwurf mit Raten aus dem Stand an', () => {
    const r = applyEvent(initial(), { type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }, mkCtx());
    const a = r.state.actions.find((x) => x.id === 'stripe-takeover-c1-1')!;
    expect(a).toMatchObject({ type: 'stripe_takeover', status: 'draft', version: 1, isDemo: false });
    expect(a.payload.rates).toEqual([{ no: 1, dueDate: '2026-12-01', amountCents: 45000 }, { no: 2, dueDate: '2027-01-01', amountCents: 30000 }]);
    expect(a.payload).toMatchObject({ contractId: 'c1', contactId: 'm1', name: 'Erika Muster', email: 'erika@example.de', mode: 'first_rate', openCents: 75000 });
    expect(lastAudit(r.state)).toMatchObject({ actor: 'owner', text: 'Umstellung vorbereitet: Erika Muster', actionId: 'stripe-takeover-c1-1' });
  });

  test('erneut mit anderem Modus → neue Version, keine zweite Aktion', () => {
    const s = run(initial(), [
      { type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' },
      { type: 'prepareTakeover', contractId: 'c1', mode: 'spread' },
    ]);
    expect(takeoverActions(s)).toHaveLength(1);
    const a = action(s);
    expect(a).toMatchObject({ status: 'draft', version: 2 });
    expect(a.payload.mode).toBe('spread');
    expect(a.payload.rates).toEqual([{ no: 1, dueDate: '2026-12-01', amountCents: 37500 }, { no: 2, dueDate: '2027-01-01', amountCents: 37500 }]);
  });

  test('erneut mit gleichem Modus → nichts geändert, Version bleibt', () => {
    const once = run(initial(), [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }]);
    const twice = run(once, [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }]);
    expect(takeoverActions(twice)).toHaveLength(1);
    expect(action(twice).version).toBe(1);
    expect(twice.audit).toHaveLength(once.audit.length);
  });

  test('Sperrgrund: nichts angelegt, Audit nennt Grund', () => {
    const s0 = initial({ contracts: [contract('c1', 'm1', { billing: 'stripe' })] });
    const r = applyEvent(s0, { type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }, mkCtx());
    expect(takeoverActions(r.state)).toHaveLength(0);
    expect(lastAudit(r.state)).toMatchObject({ actor: 'owner', text: 'Umstellung nicht vorbereitet: Zahlt bereits über Stripe.' });
  });

  test('unbekannter Vertrag: nichts angelegt, kein Absturz', () => {
    const r = applyEvent(initial(), { type: 'prepareTakeover', contractId: 'gibt-es-nicht', mode: 'first_rate' }, mkCtx());
    expect(takeoverActions(r.state)).toHaveLength(0);
    expect(lastAudit(r.state).text).toBe('Umstellung nicht vorbereitet: Vertrag nicht gefunden.');
  });

  test('offene Aktion ist kein Entwurf mehr → keine zweite Umstellung, Audit „Umstellung läuft bereits“', () => {
    const s = run(initial(), [
      { type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' },
      { type: 'approveAction', id: 'stripe-takeover-c1-1', version: 1, via: 'app' },
      { type: 'prepareTakeover', contractId: 'c1', mode: 'spread' },
    ]);
    expect(takeoverActions(s)).toHaveLength(1);
    expect(action(s)).toMatchObject({ status: 'approved', version: 1 });
    expect(action(s).payload.mode).toBe('first_rate');
    expect(lastAudit(s).text).toBe('Umstellung läuft bereits: Erika Muster');
  });

  test('createAction mit stripe_takeover wird im Reducer ignoriert', () => {
    const forged: Action = {
      id: 'stripe-takeover-c1-1', type: 'stripe_takeover', company: 'nexus', title: 'Umstellung auf Stripe: Erika Muster',
      payload: { contractId: 'c1', rates: [{ no: 1, dueDate: '2026-12-01', amountCents: 1 }] }, version: 1, status: 'draft', createdAt: '2026-11-13T09:00:00.000Z', isDemo: false,
    };
    const s = run(initial(), [{ type: 'createAction', action: forged }]);
    expect(takeoverActions(s)).toHaveLength(0);
  });

  test('editAction ändert stripe_takeover nicht', () => {
    const s1 = run(initial(), [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }]);
    const before = action(s1);
    const s2 = run(s1, [{ type: 'editAction', id: 'stripe-takeover-c1-1', payload: { ...before.payload, rates: [{ no: 1, dueDate: '2026-12-01', amountCents: 1 }] } }]);
    expect(action(s2).payload.rates).toEqual(before.payload.rates);
    expect(action(s2).version).toBe(1);
  });
});

describe('Umstellung ausführen', () => {
  test('Ausführung mit output → link_sent, Token 64 Hex, Link aus linkBase', () => {
    const s = linkSent();
    expect(s.takeovers).toHaveLength(1);
    const t = s.takeovers[0];
    expect(t).toMatchObject({
      id: 'stripe-takeover-c1-1', status: 'link_sent', isDemo: false, stripeCustomerId: 'cus_test_1', actionId: 'stripe-takeover-c1-1', actionVersion: 1,
      contractId: 'c1', contactId: 'm1', mode: 'first_rate', openCents: 75000, paymentMethodId: null, scheduleId: null, subscriptionExternalId: null,
      linkSentAt: '2026-11-13T09:00:00.000Z',
    });
    expect(t.rates).toEqual([{ no: 1, dueDate: '2026-12-01', amountCents: 45000 }, { no: 2, dueDate: '2027-01-01', amountCents: 30000 }]);
    expect(t.token).toMatch(/^[0-9a-f]{64}$/);
    expect(t.link).toBe(`https://nexus.example.de/zahlung/${t.token}`);
    expect(action(s).status).toBe('executed');
    expect(s.contracts[0].billing).toBe('legacy');
  });

  test.each([
    ['Demo-Kontext', true, undefined],
    ['Echtbetrieb mit Demo-Ausführer (simulated)', false, true],
  ] as const)('Ausführung ohne output, %s → Token demo-…, isDemo', (_name, demoCtx, simulated) => {
    const s = run(initial(), [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }, ...execute('stripe-takeover-c1-1', 1, undefined, simulated)], mkCtx(demoCtx));
    const t = s.takeovers[0];
    expect(t).toMatchObject({ status: 'link_sent', isDemo: true, stripeCustomerId: null, scheduleId: null });
    expect(t.token).toMatch(/^demo-[0-9a-f]{64}$/);
    expect(t.link).toBe(`/zahlung/${t.token}`);
    expect(s.contracts[0].billing).toBe('legacy');
  });

  test('simulated mit Stripe-Kunde im output bleibt Demo (isDemo nie aus output)', () => {
    const s = run(initial(), [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }, ...execute('stripe-takeover-c1-1', 1, OUT, true)]);
    expect(s.takeovers[0]).toMatchObject({ isDemo: true, stripeCustomerId: 'cus_test_1' });
    expect(s.takeovers[0].token).toMatch(/^demo-[0-9a-f]{64}$/);
  });

  test('Echtbetrieb ohne Ergebnisdaten → keine Umstellung, Audit, Vertrag bleibt legacy', () => {
    const s = run(initial(), [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }, ...execute('stripe-takeover-c1-1', 1)]);
    expect(s.takeovers).toHaveLength(0);
    expect(s.contracts[0].billing).toBe('legacy');
    expect(lastAudit(s)).toMatchObject({ text: 'Umstellung ohne Ergebnisdaten – bitte prüfen: Umstellung auf Stripe: Erika Muster', actionId: 'stripe-takeover-c1-1' });
  });

  test('Echtbetrieb: Abgleich found ohne output → keine Umstellung, Audit', () => {
    const s = run(initial(), [
      { type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' },
      { type: 'approveAction', id: 'stripe-takeover-c1-1', version: 1, via: 'app' },
      { type: 'actionStarted', id: 'stripe-takeover-c1-1' },
      { type: 'actionExecuted', id: 'stripe-takeover-c1-1', result: 'timeout' },
      { type: 'actionReconciled', id: 'stripe-takeover-c1-1', found: true },
    ]);
    expect(s.takeovers).toHaveLength(0);
    expect(s.contracts[0].billing).toBe('legacy');
    expect(lastAudit(s).text).toBe('Umstellung ohne Ergebnisdaten – bitte prüfen: Umstellung auf Stripe: Erika Muster');
  });

  test('takeoverSetUp → eingerichtet, billing stripe, plan mit paidCents', () => {
    const s1 = linkSent();
    const s2 = run(s1, [{ type: 'takeoverSetUp', takeoverId: 'stripe-takeover-c1-1', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' }]);
    const t = s2.takeovers[0];
    expect(t).toMatchObject({ status: 'set_up', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1', setUpAt: '2026-11-13T09:00:00.000Z' });
    expect(s2.contracts[0].billing).toBe('stripe');
    expect(s2.contracts[0].plan).toEqual({ takeoverId: 'stripe-takeover-c1-1', paidCents: 45000, rates: t.rates });
    expect(lastAudit(s2)).toMatchObject({ actor: 'system', text: 'Umstellung eingerichtet: Erika Muster, 2 Raten (Zeitplan sub_sched_test_1)' });

    const s3 = run(s2, [{ type: 'takeoverSetUp', takeoverId: 'stripe-takeover-c1-1', scheduleId: 'sub_sched_test_2', paymentMethodId: 'pm_test_2' }]);
    expect(s3.takeovers[0]).toEqual(t);
    expect(s3.contracts[0]).toEqual(s2.contracts[0]);
    expect(s3.audit).toHaveLength(s2.audit.length);
  });

  test('takeoverSetUp nach Zurückziehen ändert nichts', () => {
    const s1 = run(linkSent(), [{ type: 'withdrawTakeover', contractId: 'c1' }]);
    expect(s1.takeovers[0]).toMatchObject({ status: 'withdrawn', endedAt: '2026-11-13T09:00:00.000Z' });
    const s2 = run(s1, [{ type: 'takeoverSetUp', takeoverId: 'stripe-takeover-c1-1', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' }]);
    expect(s2.takeovers[0]).toMatchObject({ status: 'withdrawn', scheduleId: null, paymentMethodId: null });
    expect(s2.contracts[0].billing).toBe('legacy');
    expect(s2.contracts[0].plan).toBeUndefined();
  });

  test('takeoverPlanChanged: nur aus link_sent → plan_changed mit Zahlungsmittel', () => {
    const s1 = run(linkSent(), [{ type: 'takeoverPlanChanged', takeoverId: 'stripe-takeover-c1-1', paymentMethodId: 'pm_test_1' }]);
    expect(s1.takeovers[0]).toMatchObject({ status: 'plan_changed', paymentMethodId: 'pm_test_1', scheduleId: null });
    expect(s1.contracts[0].billing).toBe('legacy');
    expect(lastAudit(s1)).toMatchObject({ actor: 'system', text: 'Umstellung Erika Muster: Plan hat sich geändert, neu freigeben' });
    const s2 = run(s1, [{ type: 'takeoverPlanChanged', takeoverId: 'stripe-takeover-c1-1', paymentMethodId: 'pm_test_2' }]);
    expect(s2.takeovers[0].paymentMethodId).toBe('pm_test_1');
    // Neu vorbereiten nach „Plan geändert“: zweiter Versuch übernimmt Kunde und Zahlungsmittel.
    const s3 = run(s2, [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }]);
    expect(action(s3, 'stripe-takeover-c1-2')).toMatchObject({ status: 'draft', payload: expect.objectContaining({ stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1' }) });
  });

  test('output mit scheduleId (Neu-Freigabe mit hinterlegtem Zahlungsmittel) → direkt eingerichtet', () => {
    const s = linkSent({ ...OUT, scheduleId: 'sub_sched_test_9', paymentMethodId: 'pm_test_9' });
    expect(s.takeovers[0]).toMatchObject({ status: 'set_up', isDemo: false, scheduleId: 'sub_sched_test_9', paymentMethodId: 'pm_test_9', setUpAt: '2026-11-13T09:00:00.000Z' });
    expect(s.contracts[0].billing).toBe('stripe');
    expect(s.contracts[0].plan).toEqual({ takeoverId: 'stripe-takeover-c1-1', paidCents: 45000, rates: s.takeovers[0].rates });
  });

  test('Ausführung zweimal gemeldet (Abgleich nach Ausführung) → nur eine Umstellung', () => {
    const s1 = linkSent();
    const s2 = run(s1, [{ type: 'actionReconciled', id: 'stripe-takeover-c1-1', found: true, output: OUT }]);
    expect(s2.takeovers).toHaveLength(1);
  });

  test('Abgleich mit found → Umstellung wird angelegt', () => {
    const s = run(initial(), [
      { type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' },
      { type: 'approveAction', id: 'stripe-takeover-c1-1', version: 1, via: 'app' },
      { type: 'actionStarted', id: 'stripe-takeover-c1-1' },
      { type: 'actionExecuted', id: 'stripe-takeover-c1-1', result: 'timeout' },
      { type: 'actionReconciled', id: 'stripe-takeover-c1-1', found: true, output: OUT },
    ]);
    expect(s.takeovers).toHaveLength(1);
    expect(s.takeovers[0]).toMatchObject({ status: 'link_sent', stripeCustomerId: 'cus_test_1' });
  });
});

describe('Sammelfreigabe und Alle umstellen', () => {
  function two(): AppState {
    const p2 = paid('c2', 30000);
    const s = initial();
    return { ...s, contracts: [...s.contracts, contract('c2', 'm2')], payments: [...s.payments, p2.payment], allocations: [...s.allocations, p2.allocation] };
  }

  test('approveActions gibt mehrere Entwürfe frei, veraltete Version bleibt Entwurf', () => {
    const s1 = run(two(), [
      { type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' },
      { type: 'prepareTakeover', contractId: 'c2', mode: 'first_rate' },
      { type: 'prepareTakeover', contractId: 'c2', mode: 'spread' }, // c2 jetzt Version 2
    ]);
    const s2 = run(s1, [{ type: 'approveActions', items: [{ id: 'stripe-takeover-c1-1', version: 1 }, { id: 'stripe-takeover-c2-1', version: 1 }] }]);
    expect(action(s2, 'stripe-takeover-c1-1')).toMatchObject({ status: 'approved', approvedVia: 'app' });
    expect(action(s2, 'stripe-takeover-c2-1')).toMatchObject({ status: 'draft', version: 2 });
    expect(lastAudit(s2)).toMatchObject({ actor: 'owner', text: 'Sammelfreigabe: 1 Aktionen' });
  });

  test('prepareAllTakeovers überspringt Stripe-, bezahlte, schon vorbereitete und Nicht-Mitgliedschafts-Verträge', () => {
    const full = paid('c3', 120000);
    const s0 = stateWith({
      contacts: people,
      contracts: [
        contract('c1', 'm1'),
        contract('c2', 'm2', { billing: 'stripe' }),
        contract('c3', 'm3'),
        contract('c4', 'm4'),
        contract('c5', 'm5', { kind: 'ticket' }),
        contract('c6', 'm6', { catchUpMode: 'spread' }),
      ],
      payments: [full.payment], allocations: [full.allocation],
    });
    const s1 = run(s0, [{ type: 'prepareTakeover', contractId: 'c4', mode: 'spread' }]);
    const s2 = run(s1, [{ type: 'prepareAllTakeovers' }]);
    expect(takeoverActions(s2).map((a) => a.id).sort()).toEqual(['stripe-takeover-c1-1', 'stripe-takeover-c4-1', 'stripe-takeover-c6-1']);
    expect(action(s2, 'stripe-takeover-c4-1').version).toBe(1);
    expect(action(s2, 'stripe-takeover-c1-1').payload.mode).toBe('first_rate');
    expect(action(s2, 'stripe-takeover-c6-1').payload.mode).toBe('spread');
    expect(lastAudit(s2)).toMatchObject({ actor: 'owner', text: '2 Umstellungen vorbereitet' });
  });
});

describe('Zurückziehen und Demo-Einrichtung', () => {
  test('withdrawTakeover: offener Entwurf → abgebrochen', () => {
    const s = run(initial(), [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }, { type: 'withdrawTakeover', contractId: 'c1' }]);
    expect(action(s).status).toBe('cancelled');
    expect(s.takeovers).toHaveLength(0);
  });

  test('withdrawTakeover ab eingerichtet: nichts geändert, Audit mit Hinweis', () => {
    const s1 = run(linkSent(), [{ type: 'takeoverSetUp', takeoverId: 'stripe-takeover-c1-1', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' }]);
    const s2 = run(s1, [{ type: 'withdrawTakeover', contractId: 'c1' }]);
    expect(s2.takeovers[0].status).toBe('set_up');
    expect(lastAudit(s2).text).toBe('Zurückziehen nicht möglich: Zeitplan besteht, bitte in Stripe kündigen');
  });

  test('withdrawTakeover aus plan_changed → zurückgezogen', () => {
    const s = run(linkSent(), [
      { type: 'takeoverPlanChanged', takeoverId: 'stripe-takeover-c1-1', paymentMethodId: 'pm_test_1' },
      { type: 'withdrawTakeover', contractId: 'c1' },
    ]);
    expect(s.takeovers[0]).toMatchObject({ status: 'withdrawn', endedAt: '2026-11-13T09:00:00.000Z' });
  });

  const demoTakeover = (demoCtx: boolean, simulated?: boolean) =>
    run(initial(), [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }, ...execute('stripe-takeover-c1-1', 1, undefined, simulated)], mkCtx(demoCtx));

  test('simulateTakeoverSetUp im Demo-Kontext richtet Demo-Umstellung ein', () => {
    const demo = run(demoTakeover(true), [{ type: 'simulateTakeoverSetUp', contractId: 'c1' }], mkCtx(true));
    const t: StripeTakeover = demo.takeovers[0];
    expect(t).toMatchObject({ status: 'set_up', scheduleId: 'demo', paymentMethodId: 'demo', isDemo: true });
    expect(demo.contracts[0]).toMatchObject({ billing: 'stripe', plan: { takeoverId: 'stripe-takeover-c1-1', paidCents: 45000, rates: t.rates } });
  });

  test('simulateTakeoverSetUp im Echtbetrieb mit Demo-Umstellung: Vertrag bleibt legacy, Audit', () => {
    const s0 = demoTakeover(false, true);
    expect(s0.takeovers[0].isDemo).toBe(true);
    const s1 = run(s0, [{ type: 'simulateTakeoverSetUp', contractId: 'c1' }]);
    expect(s1.takeovers[0]).toMatchObject({ status: 'link_sent', scheduleId: null });
    expect(s1.contracts[0].billing).toBe('legacy');
    expect(s1.contracts[0].plan).toBeUndefined();
    expect(lastAudit(s1)).toMatchObject({ actor: 'owner', text: 'Demo-Einrichtung im Echtbetrieb abgelehnt' });
  });

  test('simulateTakeoverSetUp mit echter Umstellung: nichts geändert, Audit', () => {
    const s1 = run(linkSent(), [{ type: 'simulateTakeoverSetUp', contractId: 'c1' }], mkCtx(true));
    expect(s1.takeovers[0]).toMatchObject({ status: 'link_sent', scheduleId: null, isDemo: false });
    expect(s1.contracts[0].billing).toBe('legacy');
    expect(lastAudit(s1).text).toBe('Demo-Einrichtung im Echtbetrieb abgelehnt');
  });
});
