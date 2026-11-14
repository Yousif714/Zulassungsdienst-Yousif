import { describe, expect, test } from 'vitest';
import { applyEvent, type EngineContext } from '@/data/engine';
import { memberView } from '@/domain/detectors';
import type { NewInvoiceReading } from '@/domain/events';
import { invoicesToRead, readingProposalId } from '@/domain/import/invoice-reading';
import { deriveProposals } from '@/domain/import/proposals';
import { invoiceOpenCents } from '@/domain/ledger/receivables';
import type { AppState } from '@/domain/types';
import { NOW_0930, stateWith, tx } from '../helpers';
import { seq } from './helpers';
import { okResult, readInv, reading } from './reading-fixtures';

const ctx = (p: Partial<EngineContext> = {}): EngineContext => ({ at: NOW_0930, isDemo: false, newId: seq(), ...p });
const withLexContact = (s: AppState): AppState => ({ ...s, contacts: [...s.contacts.filter((c) => c.id !== 'm-x'),
  { id: 'm-x', company: 'nexus', kind: 'member', name: 'Erika Beispiel', phones: [], emails: ['erika@example.de'], externalRefs: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] }] });
const lesung = (p: Partial<NewInvoiceReading> = {}): NewInvoiceReading => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { outcome, contractId, ...r } = reading();
  return { ...r, ...p };
};
const s0 = () => withLexContact(stateWith({ invoices: [readInv()] }));
const claude = (s: AppState) => s.connections.find((c) => c.id === 'claude_invoices');

test('legt bei apply den Vertrag an, markiert, Rechnung nicht mehr offen', () => {
  const { state, created } = applyEvent(s0(), { type: 'invoicesRead', readings: [lesung()] }, ctx());
  const k = state.contracts.find((c) => c.id === created[0])!;
  expect(k).toMatchObject({ contactId: 'm-x', kind: 'ticket', totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 15, startDate: '2026-10-15',
    billing: 'legacy', catchUpMode: 'first_rate', readBy: { invoiceId: 'i-r1', invoiceNumber: 'RE-9001', confirmed: false }, origin: [{ connectionId: 'lexware_nexus', externalId: 'invoice:lex-r1' }] });
  expect(state.invoiceReadings.at(-1)).toMatchObject({ outcome: 'applied', contractId: k.id });
  expect(invoiceOpenCents(state, state.invoices[0])).toBe(0);
  expect(claude(state)?.status).toBe('connected');
  expect(state.audit.at(-1)?.text).toBe('Claude: 1 Rechnungen gelesen, 1 Ratenverträge angelegt, 0 Vorschläge');
});

test('Mitgliedschaft aus Lesung trägt zusätzlich die Kontakt-Referenz', () => {
  const { state, created } = applyEvent(s0(), { type: 'invoicesRead', readings: [lesung({ result: okResult({ kind: 'membership' }) })] }, ctx());
  expect(state.contracts.find((c) => c.id === created[0])?.origin).toEqual([
    { connectionId: 'lexware_nexus', externalId: 'invoice:lex-r1' }, { connectionId: 'lexware_nexus', externalId: 'c-77' }]);
});

test('Review 2: zwei Lesungen derselben Rechnung → ein Vertrag', () => {
  const { state } = applyEvent(s0(), { type: 'invoicesRead', readings: [lesung({ id: 'a' }), lesung({ id: 'b' })] }, ctx());
  expect(state.contracts.filter((c) => c.readBy?.invoiceId === 'i-r1')).toHaveLength(1);
  expect(state.invoiceReadings.map((r) => r.outcome)).toEqual(['applied', 'none']);
});

test('Review 3: zugeordnete Zahlung wandert auf den Vertrag und bei Löschen zurück', () => {
  const s = { ...s0(), payments: [tx({ id: 'p1', amountCents: 10000, bookedOn: '2026-10-16' })], allocations: [{ paymentId: 'p1', invoiceId: 'i-r1', amountCents: 10000, method: 'confirmed' as const }] };
  const a = applyEvent(s, { type: 'invoicesRead', readings: [lesung()] }, ctx());
  const id = a.created[0];
  expect(a.state.allocations).toEqual([{ paymentId: 'p1', contractId: id, amountCents: 10000, method: 'confirmed' }]);
  expect(memberView(a.state, id, '2026-11-12').states[0].paidCents).toBe(10000);
  const d = applyEvent(a.state, { type: 'deleteReadContract', contractId: id }, ctx());
  expect(d.state.contracts.some((c) => c.id === id)).toBe(false);
  expect(d.state.allocations).toEqual([{ paymentId: 'p1', invoiceId: 'i-r1', amountCents: 10000, method: 'confirmed' }]);
  expect(d.state.dismissedProposals).toContain(readingProposalId(readInv()));
});

test('verworfen bleibt verworfen: nach Löschen legt eine neue Lesung keinen Vertrag an', () => {
  const a = applyEvent(s0(), { type: 'invoicesRead', readings: [lesung()] }, ctx());
  const d = applyEvent(a.state, { type: 'deleteReadContract', contractId: a.created[0] }, ctx());
  const r = applyEvent(d.state, { type: 'invoicesRead', readings: [lesung({ id: 'r2', sourceUpdatedAt: '2026-11-01T08:00:00Z' })] }, ctx());
  expect(r.state.contracts).toHaveLength(0);
  expect(r.state.invoiceReadings.at(-1)?.outcome).toBe('none');
});

test('Fehler zählen; 3. Fehler → none mit Hinweis', () => {
  const err = (id: string) => lesung({ id, result: null, error: 'Zeitüberschreitung', inputTokens: 0, outputTokens: 0, costMicroCents: 0 });
  const { state } = applyEvent(s0(), { type: 'invoicesRead', readings: [err('e1'), err('e2'), err('e3')] }, ctx());
  expect(state.invoiceReadings.map((r) => r.outcome)).toEqual(['error', 'error', 'none']);
  expect(state.invoiceReadings[2].error).toBe('Nach 3 Versuchen aufgegeben: Zeitüberschreitung');
});

test('unsicher → kein Vertrag, Vorschlag; Übernehmen setzt kind und readBy bestätigt', () => {
  const r = applyEvent(s0(), { type: 'invoicesRead', readings: [lesung({ result: okResult({ certain: false, note: 'x' }) })] }, ctx());
  expect(r.state.contracts).toHaveLength(0);
  expect(r.state.invoiceReadings.at(-1)?.outcome).toBe('proposal');
  const p = deriveProposals(r.state).find((x) => x.sourceLabel === 'Lexware (Claude)')!;
  const c = applyEvent(r.state, { type: 'confirmProposal', proposalId: p.id, draft: { totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 15, startDate: '2026-10-15', catchUpMode: 'first_rate' }, contactId: null }, ctx());
  expect(c.state.contracts[0]).toMatchObject({ contactId: 'm-x', kind: 'ticket', readBy: { invoiceId: 'i-r1', confirmed: true }, origin: [{ connectionId: 'lexware_nexus', externalId: 'invoice:lex-r1' }] });
  expect(invoiceOpenCents(c.state, c.state.invoices[0])).toBe(0);
});

test('Passt und Korrigieren setzen confirmed; Korrigieren übernimmt Werte; ungültig bleibt unverändert', () => {
  const a = applyEvent(s0(), { type: 'invoicesRead', readings: [lesung()] }, ctx());
  const id = a.created[0];
  const ok = applyEvent(a.state, { type: 'confirmReadContract', contractId: id }, ctx());
  expect(ok.state.contracts[0].readBy?.confirmed).toBe(true);
  const draft = { totalCents: 60000, installments: 5, installmentCents: 12000, dueDay: 1, startDate: '2026-11-01', catchUpMode: 'first_rate' as const };
  const c = applyEvent(a.state, { type: 'correctContract', contractId: id, draft }, ctx());
  expect(c.state.contracts[0]).toMatchObject({ installments: 5, installmentCents: 12000, dueDay: 1, startDate: '2026-11-01', readBy: { confirmed: true } });
  const bad = applyEvent(a.state, { type: 'correctContract', contractId: id, draft: { ...draft, dueDay: 40 } }, ctx());
  expect(bad.state.contracts[0]).toEqual(a.state.contracts[0]);
  const plain = stateWith({ contracts: [{ id: 'k0', contactId: 'm1', totalCents: 1000, installments: 1, installmentCents: 1000, dueDay: 1, startDate: '2026-10-01', billing: 'legacy', catchUpMode: 'first_rate' }] });
  const del = applyEvent(plain, { type: 'deleteReadContract', contractId: 'k0' }, ctx());
  expect(del.state.contracts).toHaveLength(1);
  expect(del.state.audit.at(-1)?.text).toBe('Nur für von Claude gelesene Verträge');
});

test('error im Ereignis → Verbindung Störung mit Text', () => {
  const { state } = applyEvent(s0(), { type: 'invoicesRead', readings: [], error: 'Schlüssel ungültig' }, ctx());
  expect(claude(state)).toMatchObject({ status: 'error', lastError: 'Schlüssel ungültig' });
});

test('Final-Review I2: Mitgliedsrechnung als „other“ gelesen → Textsuche-Vorschlag verschwindet', () => {
  const m = readInv({ text: 'NEXUS Mitgliedschaft 12 Monate, zahlbar in 6 Monatsraten à 100,00 €' });
  const s = withLexContact(stateWith({ invoices: [m] }));
  expect(deriveProposals(s).map((p) => p.sourceLabel)).toEqual(['Lexware']);
  const a = applyEvent(s, { type: 'invoicesRead', readings: [lesung({ result: okResult({ kind: 'other' }) })] }, ctx());
  expect(a.state.contracts).toHaveLength(1);
  expect(deriveProposals(a.state)).toEqual([]);
});

test('Final-Review I3: verworfener Textsuche-Vorschlag → Claude legt keinen Vertrag an und liest nicht', () => {
  const m = readInv({ text: 'NEXUS Mitgliedschaft 12 Monate, zahlbar in 6 Monatsraten à 100,00 €' });
  const s = withLexContact(stateWith({ invoices: [m], dismissedProposals: ['lexware_nexus:c-77'] }));
  expect(invoicesToRead(s)).toEqual([]);
  const a = applyEvent(s, { type: 'invoicesRead', readings: [lesung({ result: okResult({ kind: 'membership' }) })] }, ctx());
  expect(a.state.contracts).toHaveLength(0);
  expect(a.state.invoiceReadings.at(-1)?.outcome).toBe('none');
});

describe('Vertrag mit Umstellungs-Plan (I3)', () => {
  const draft = { totalCents: 60000, installments: 5, installmentCents: 12000, dueDay: 1, startDate: '2026-11-01', catchUpMode: 'first_rate' as const };
  const rates = [{ no: 1, dueDate: '2026-12-15' as const, amountCents: 30000 }];
  function withTakeover(status: 'set_up' | 'active' | 'aborted'): { s: AppState; id: string } {
    const a = applyEvent(s0(), { type: 'invoicesRead', readings: [lesung({ result: okResult({ kind: 'membership' }) })] }, ctx());
    const id = a.created[0];
    const s: AppState = {
      ...a.state,
      contracts: a.state.contracts.map((c) => (c.id === id ? { ...c, billing: status === 'aborted' ? 'legacy' : 'stripe', readBy: { ...c.readBy!, confirmed: true }, plan: { takeoverId: 'stripe-takeover-x-1', paidCents: 30000, rates } } : c)),
      takeovers: [{
        id: 'stripe-takeover-x-1', contractId: id, contactId: 'm-x', actionId: 'stripe-takeover-x-1', actionVersion: 1, status, token: 't', link: 'https://nexus.example.de/zahlung/t',
        mode: 'first_rate', rates, openCents: 30000, stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1', scheduleId: 'sub_sched_test_1', subscriptionExternalId: null,
        isDemo: false, linkSentAt: '2026-11-01T08:00:00Z', setUpAt: '2026-11-02T08:00:00Z',
      }],
    };
    return { s, id };
  }
  test.each(['set_up', 'active'] as const)('%s: Korrigieren und Löschen abgewiesen, Stand unverändert, Audit', (status) => {
    const { s, id } = withTakeover(status);
    for (const e of [{ type: 'correctContract' as const, contractId: id, draft }, { type: 'deleteReadContract' as const, contractId: id }]) {
      const r = applyEvent(s, e, ctx());
      expect(r.state.contracts).toEqual(s.contracts);
      expect(r.state.allocations).toEqual(s.allocations);
      expect(r.state.audit.at(-1)?.text).toBe('Vertrag läuft über Stripe – erst Zeitplan in Stripe beenden.');
    }
  });
  test('abgebrochen mit Plan: Korrektur entfernt den Plan', () => {
    const { s, id } = withTakeover('aborted');
    const r = applyEvent(s, { type: 'correctContract', contractId: id, draft }, ctx());
    const c = r.state.contracts.find((x) => x.id === id)!;
    expect(c.plan).toBeUndefined();
    expect(c).toMatchObject({ installments: 5, installmentCents: 12000 });
  });
});
