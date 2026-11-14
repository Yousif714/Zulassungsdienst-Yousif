import { describe, expect, test } from 'vitest';
import {
  TAKEOVER_STATUS_LABEL, contractLockedReason, currentTakeover, nextTakeoverAttempt, openTakeoverAction, runsViaStripe, takeoverActionId, takeoverBlockReason, takeoverStatus,
  standUnknown,
} from '@/domain/takeover/status';
import { takeoverCandidates } from '@/domain/takeover/prepare';
import type { Action, ActionStatus, MemberContract, Payment, StripeTakeover } from '@/domain/types';
import { base, conn, inv, stateWith, tx } from '../helpers';

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

describe('standUnknown', () => {
  test('Bank fehlt: unbekannt, aber nicht mehr, sobald die Raten über Stripe laufen', () => {
    const withTk = (status?: StripeTakeover['status']) => {
      const st = stateWith({ contracts: [base], takeovers: status ? [tk({ status })] : [] });
      st.connections = st.connections.map((c) => (c.id === 'bank_qonto' ? conn({ id: 'bank_qonto', status: 'missing' }) : c));
      return st;
    };
    expect(standUnknown(withTk(), base)).toBe(true);
    expect(standUnknown(withTk('link_sent'), base)).toBe(true);
    expect(standUnknown(withTk('set_up'), base)).toBe(false);
    expect(standUnknown(withTk('active'), base)).toBe(false);
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

describe('Sperrgründe aus dem Vertrag (I3)', () => {
  const voided = inv('i-void', 120000, { company: 'nexus', connectionId: 'lexware_nexus', externalId: 'lex-void', contactId: 'm1', status: 'void' });
  const onHold: MemberContract = { ...base, origin: [{ connectionId: 'lexware_nexus', externalId: 'invoice:lex-void' }] };
  const unconfirmed: MemberContract = { ...base, readBy: { invoiceId: 'i-r', invoiceNumber: 'RE-1', quote: 'x', confirmed: false } };
  test('nur Mitgliedschaften, Quellrechnung storniert, unbestätigte Lesung', () => {
    expect(takeoverBlockReason(stateWith({ contracts: [{ ...base, kind: 'ticket' }] }), 'c1', TODAY)).toBe('Nur Mitgliedschaften.');
    expect(takeoverBlockReason(stateWith({ contracts: [onHold], invoices: [voided] }), 'c1', TODAY)).toBe('Quellrechnung storniert.');
    expect(takeoverBlockReason(stateWith({ contracts: [unconfirmed] }), 'c1', TODAY)).toBe('Ratenplan erst bestätigen.');
    expect(takeoverBlockReason(stateWith({ contracts: [{ ...unconfirmed, readBy: { ...unconfirmed.readBy!, confirmed: true } }] }), 'c1', TODAY)).toBeNull();
  });
  test('takeoverCandidates schließt ruhende und unbestätigte Verträge aus', () => {
    const s = stateWith({ contracts: [onHold, { ...unconfirmed, id: 'c2' }, { ...base, id: 'c3' }], invoices: [voided] });
    expect(takeoverCandidates(s, new Date('2026-11-13T09:00:00Z')).map((c) => c.id)).toEqual(['c3']);
  });
  test('contractLockedReason: eingerichtet/aktiv/Link verschickt/laufende Aktion sperren Änderung', () => {
    const contracts = [base];
    expect(contractLockedReason(stateWith({ contracts }), 'c1')).toBeNull();
    for (const status of ['set_up', 'active'] as const) {
      expect(contractLockedReason(stateWith({ contracts, takeovers: [tk({ status })] }), 'c1')).toBe('Vertrag läuft über Stripe – erst Zeitplan in Stripe beenden.');
    }
    expect(contractLockedReason(stateWith({ contracts, takeovers: [tk({ status: 'link_sent' })] }), 'c1')).toBe('Umstellung auf Stripe läuft – erst zurückziehen.');
    for (const st of ['approved', 'executing', 'uncertain'] as const) {
      expect(contractLockedReason(stateWith({ contracts, actions: [act('stripe-takeover-c1-1', st)] }), 'c1')).toBe('Umstellung auf Stripe läuft – erst zurückziehen.');
    }
    for (const status of ['plan_changed', 'withdrawn', 'aborted'] as const) {
      expect(contractLockedReason(stateWith({ contracts, takeovers: [tk({ status })] }), 'c1')).toBeNull();
    }
    expect(contractLockedReason(stateWith({ contracts, actions: [act('stripe-takeover-c1-1', 'draft')] }), 'c1')).toBeNull();
  });
});
