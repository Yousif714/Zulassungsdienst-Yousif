import { describe, expect, test } from 'vitest';
import {
  TAKEOVER_STATUS_LABEL, currentTakeover, nextTakeoverAttempt, openTakeoverAction, runsViaStripe, takeoverActionId, takeoverBlockReason, takeoverStatus,
} from '@/domain/takeover/status';
import type { Action, ActionStatus, Payment, StripeTakeover } from '@/domain/types';
import { base, conn, stateWith, tx } from '../helpers';

const TODAY = '2026-11-13';
const pay = (id: string, bookedOn: string, amountCents: number): Payment => tx({ id, externalId: `x-${id}`, bookedOn, amountCents });

function act(id: string, status: ActionStatus, contractId = 'c1'): Action {
  return { id, type: 'stripe_takeover', company: 'nexus', title: 'Umstellung auf Stripe: X', payload: { contractId }, version: 1, status, createdAt: '2026-11-13T09:00:00.000Z', isDemo: true };
}
function tk(p: Partial<StripeTakeover> = {}): StripeTakeover {
  return {
    id: '6f1c2b3a-0000-4000-8000-000000000001', contractId: 'c1', contactId: 'm1', actionId: 'stripe-takeover-c1-1', actionVersion: 1, status: 'link_sent',
    token: 'a'.repeat(64), link: `https://nexus.example.de/zahlung/${'a'.repeat(64)}`, mode: 'first_rate', rates: [], openCents: 90000,
    stripeCustomerId: null, paymentMethodId: null, scheduleId: null, subscriptionExternalId: null, isDemo: true, linkSentAt: '2026-11-13T09:00:00.000Z', ...p,
  };
}

describe('Umstellungs-Status', () => {
  test('Labels exakt', () => {
    expect(TAKEOVER_STATUS_LABEL).toEqual({
      prepared: 'vorbereitet', link_sent: 'Link verschickt', set_up: 'eingerichtet', active: 'aktiv',
      plan_changed: 'Plan geändert', withdrawn: 'zurückgezogen', aborted: 'abgebrochen',
    });
  });

  test('takeoverActionId und nextTakeoverAttempt zählt frühere Aktionen', () => {
    expect(takeoverActionId('c1', 3)).toBe('stripe-takeover-c1-3');
    expect(nextTakeoverAttempt(stateWith(), 'c1')).toBe(1);
    const s = stateWith({ actions: [act('stripe-takeover-c1-1', 'cancelled'), act('stripe-takeover-c1-2', 'executed'), act('stripe-takeover-c10-1', 'draft', 'c10')] });
    expect(nextTakeoverAttempt(s, 'c1')).toBe(3);
    expect(nextTakeoverAttempt(s, 'c10')).toBe(2);
  });

  test('openTakeoverAction: draft, approved, executing, uncertain, failed sind offen', () => {
    for (const st of ['draft', 'approved', 'executing', 'uncertain', 'failed'] as const) {
      expect(openTakeoverAction(stateWith({ actions: [act('stripe-takeover-c1-1', st)] }), 'c1')?.id).toBe('stripe-takeover-c1-1');
    }
    for (const st of ['executed', 'cancelled'] as const) {
      expect(openTakeoverAction(stateWith({ actions: [act('stripe-takeover-c1-1', st)] }), 'c1')).toBeUndefined();
    }
    expect(openTakeoverAction(stateWith({ actions: [act('stripe-takeover-c10-1', 'draft', 'c10')] }), 'c1')).toBeUndefined();
  });

  test('currentTakeover: jüngste nach linkSentAt, nur eigener Vertrag', () => {
    const older = tk({ id: '6f1c2b3a-0000-4000-8000-00000000000a', status: 'withdrawn', linkSentAt: '2026-11-01T09:00:00.000Z' });
    const newer = tk({ id: '6f1c2b3a-0000-4000-8000-00000000000b', status: 'link_sent', linkSentAt: '2026-11-10T09:00:00.000Z' });
    const other = tk({ id: '6f1c2b3a-0000-4000-8000-00000000000c', contractId: 'c2', linkSentAt: '2026-11-12T09:00:00.000Z' });
    expect(currentTakeover(stateWith({ takeovers: [newer, older, other] }), 'c1')?.id).toBe(newer.id);
    expect(currentTakeover(stateWith(), 'c1')).toBeUndefined();
  });

  test('takeoverStatus: offene Aktion → prepared, sonst jüngste Umstellung, sonst null', () => {
    expect(takeoverStatus(stateWith(), 'c1')).toBeNull();
    expect(takeoverStatus(stateWith({ takeovers: [tk({ status: 'plan_changed' })] }), 'c1')).toBe('plan_changed');
    expect(takeoverStatus(stateWith({ takeovers: [tk({ status: 'plan_changed' })], actions: [act('stripe-takeover-c1-2', 'draft')] }), 'c1')).toBe('prepared');
    expect(takeoverStatus(stateWith({ actions: [act('stripe-takeover-c1-1', 'executed')] }), 'c1')).toBeNull();
  });

  test('runsViaStripe nur bei set_up und active', () => {
    const cases = { link_sent: false, set_up: true, active: true, plan_changed: false, withdrawn: false, aborted: false } as const;
    for (const [status, want] of Object.entries(cases)) {
      expect(runsViaStripe(stateWith({ takeovers: [tk({ status: status as StripeTakeover['status'] })] }), 'c1')).toBe(want);
    }
    expect(runsViaStripe(stateWith(), 'c1')).toBe(false);
  });
});

describe('takeoverBlockReason', () => {
  const contracts = [base];
  test('Sperrgründe in fester Reihenfolge', () => {
    // Stripe hat Vorrang vor allem anderen (auch vor fehlender Bank)
    const noBank = stateWith({ contracts: [{ ...base, billing: 'stripe' }] });
    noBank.connections = noBank.connections.map((c) => (c.id === 'bank_qonto' ? conn({ id: 'bank_qonto', status: 'missing' }) : c));
    expect(takeoverBlockReason(noBank, 'c1', TODAY)).toBe('Zahlt bereits über Stripe.');

    const bankMissing = stateWith({ contracts });
    bankMissing.connections = bankMissing.connections.map((c) => (c.id === 'bank_qonto' ? conn({ id: 'bank_qonto', status: 'missing' }) : c));
    expect(takeoverBlockReason(bankMissing, 'c1', TODAY)).toBe('Bank nicht verbunden: Der Restbetrag wird erst nach der Bankanbindung berechnet.');

    const paid = stateWith({
      contracts, payments: [pay('p1', '2026-10-01', 120000)], allocations: [{ paymentId: 'p1', contractId: 'c1', amountCents: 120000, method: 'manual' }],
      takeovers: [tk({ status: 'link_sent' })],
    });
    expect(takeoverBlockReason(paid, 'c1', TODAY)).toBe('Nichts mehr offen.');

    for (const status of ['link_sent', 'set_up', 'active'] as const) {
      expect(takeoverBlockReason(stateWith({ contracts, takeovers: [tk({ status })] }), 'c1', TODAY)).toBe('Umstellung läuft bereits.');
    }
  });
  test('kein Sperrgrund: offener Entwurf, frühere Umstellung zurückgezogen oder Plan geändert', () => {
    expect(takeoverBlockReason(stateWith({ contracts }), 'c1', TODAY)).toBeNull();
    expect(takeoverBlockReason(stateWith({ contracts, actions: [act('stripe-takeover-c1-1', 'draft')] }), 'c1', TODAY)).toBeNull();
    for (const status of ['plan_changed', 'withdrawn', 'aborted'] as const) {
      expect(takeoverBlockReason(stateWith({ contracts, takeovers: [tk({ status })] }), 'c1', TODAY)).toBeNull();
    }
  });
});
