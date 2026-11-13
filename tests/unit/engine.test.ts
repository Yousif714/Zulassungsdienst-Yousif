import { describe, expect, test } from 'vitest';
import { createDemoState } from '@/data/seed';
import { applyEvent, applyEvents, refresh, type EngineContext } from '@/data/engine';
import { reducer } from '@/data/store';
import type { StoreEvent } from '@/domain/events';
import { memberView } from '@/domain/detectors/members';
import { invoiceOpenCents } from '@/domain/ledger/receivables';
import { unallocatedBankPayments } from '@/data/selectors';
import { NOW_0930 as NOW, base, isOpen, stateWith, tx, workshop } from './helpers';
import { confirmedSub, stripeBatch, stripeState } from './import/helpers';

const IBAN = 'DE02120300000000202051';
const s = refresh(createDemoState(), NOW);
const seq = () => { let n = 0; return () => `id-${++n}`; };
const ctx = (p: Partial<EngineContext> = {}): EngineContext => ({ at: NOW, isDemo: true, newId: seq(), ...p });
const anyOpenKey = s.insights.find((i) => i.status === 'open')!.dedupeKey;
// IDs (UUID bzw. Test-Sequenz) und Zeitstempel der Demo-Uhr herausrechnen
const strip = (st: typeof s) => JSON.stringify(st).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|id-\d+/g, 'ID').replace(/"(at|createdAt|resolvedAt)":"[^"]*"/g, '"$1":""');

describe('Engine', () => {
  test('simulateTransfer legt Zahlung mit neuer ID an und meldet sie', () => {
    const r = applyEvent(s, { type: 'simulateTransfer', iban: IBAN, payerName: 'Selin Yilmaz', amountCents: 30000 }, ctx());
    expect(r.created).toEqual(['id-1']);
    expect(r.state.payments.at(-1)!.id).toBe('id-1');
  });

  test('Echtmodus schreibt isDemo=false ins Protokoll', () => {
    const r = applyEvent(s, { type: 'dismissInsight', key: anyOpenKey }, ctx({ isDemo: false }));
    expect(r.state.audit.at(-1)!.isDemo).toBe(false);
  });

  test('assistantOutbound übernimmt die mitgegebene ID', () => {
    const r = applyEvent(s, { type: 'assistantOutbound', id: 'x', text: 'Hi' }, ctx());
    expect(r.state.assistantChat.at(-1)!.id).toBe('x');
    expect(r.created).toEqual([]);
  });

  test('assistantInbound vergibt eine neue ID', () => {
    const r = applyEvent(s, { type: 'assistantInbound', from: '+4917099999', text: 'Hallo' }, ctx());
    expect(r.created).toEqual(['id-1']);
    expect(r.state.assistantChat.at(-1)!.id).toBe('id-1');
  });

  test('applyEvents sammelt created in Reihenfolge', () => {
    const es: StoreEvent[] = [
      { type: 'assistantInbound', from: '+4917099999', text: 'a' },
      { type: 'simulateTransfer', iban: IBAN, payerName: 'Selin Yilmaz', amountCents: 30000 },
    ];
    expect(applyEvents(s, es, ctx()).created).toEqual(['id-1', 'id-2']);
  });

  test('reducer ist verhaltensgleich zu applyEvent mit Demo-Kontext', () => {
    const es: StoreEvent[] = [
      { type: 'simulateTransfer', iban: IBAN, payerName: 'Selin Yilmaz', amountCents: 30000 },
      { type: 'updateSettings', patch: { replyThresholdHours: 4 } },
      { type: 'dismissInsight', key: anyOpenKey },
    ];
    const viaReducer = es.reduce((st, e) => reducer(st, e), s);
    const viaEngine = applyEvents(s, es, ctx({ at: NOW })).state;
    expect(strip(viaEngine)).toEqual(strip(viaReducer));
  });
});

describe('Abgleich-Ereignisse', () => {
  const imp = (cursor: string | null, complete: boolean): StoreEvent => ({ type: 'importBatch', connectionId: 'stripe_nexus', batch: stripeBatch, cursor, complete });
  const conn = (st: typeof s) => st.connections.find((c) => c.id === 'stripe_nexus')!;

  test('importBatch: verbunden, Stand jetzt, Cursor gespeichert, Audit nur bei Neuem', () => {
    const r = applyEvent(s, imp('c1', false), ctx({ isDemo: false })).state;
    expect(conn(r)).toMatchObject({ status: 'connected', lastSuccessAt: NOW.toISOString(), sync: { cursor: 'c1', complete: false, failures: 0 } });
    expect(r.audit.at(-1)!.text).toMatch(/^Abgleich Stripe NEXUS: /);
    const again = applyEvent(r, imp('c1', true), ctx({ isDemo: false })).state;
    expect(again.audit.length).toBe(r.audit.length);
    expect(conn(again).sync).toMatchObject({ complete: true });
  });

  test('syncFailed: Fehler + Zähler, Daten bleiben, Audit nur beim Wechsel', () => {
    const base = applyEvent(s, imp(null, true), ctx()).state;
    const fail = { type: 'syncFailed', connectionId: 'stripe_nexus', error: 'Stripe: HTTP 500' } as const;
    const r = applyEvent(base, fail, ctx()).state;
    expect(conn(r)).toMatchObject({ status: 'error', lastError: 'Stripe: HTTP 500', lastSuccessAt: conn(base).lastSuccessAt, sync: { failures: 1 } });
    expect(r.payments).toEqual(base.payments);
    expect(r.subscriptions).toEqual(base.subscriptions);
    const r2 = applyEvent(r, fail, ctx()).state;
    expect(conn(r2).sync!.failures).toBe(2);
    expect(r2.audit.length).toBe(r.audit.length);
    const ok = applyEvent(r2, imp(null, true), ctx()).state;
    expect(conn(ok)).toMatchObject({ status: 'connected', sync: { failures: 0 } });
    expect(conn(ok).lastError).toBeUndefined();
  });
});

describe('refresh: Stripe-Zuordnung', () => {
  test('refresh ordnet Stripe-Zahlungen zu; unbestätigte erzeugen keinen unmatched-Hinweis', () => {
    const r = refresh(stripeState, NOW, false);
    expect(r.allocations).toEqual([]);
    expect(r.insights.some((i) => i.type === 'unmatched_payment')).toBe(false);
    const c = refresh(confirmedSub(stripeState, 'sub_A', 'k-ayse'), NOW, false);
    expect(c.allocations.filter((a) => a.contractId === 'k-ayse')).toHaveLength(3);
    expect(c.audit.filter((a) => a.text === 'Automatisch zugeordnet (Stripe): Ayşe Öztürk')).toHaveLength(3);
    expect(c.insights.some((i) => i.type === 'unmatched_payment')).toBe(false);
  });
  test('zweiter refresh ordnet nichts doppelt zu', () => {
    const once = refresh(confirmedSub(stripeState, 'sub_A', 'k-ayse'), NOW, false);
    expect(refresh(once, NOW, false).allocations).toEqual(once.allocations);
  });
});

describe('Zuordnung Vertrag/Rechnung (Paket 2b-2)', () => {
  const yilmaz = { ...base, id: 'k-yilmaz', contactId: 'm-yilmaz' };
  test('Rechnungsnummer + Betrag → automatisch auf die Rechnung, Forderung 0', () => {
    const r = refresh(stateWith({ invoices: [workshop], payments: [tx({ id: 'q1', iban: 'DE00X', reference: 'RE-1101', amountCents: 14900 })] }), NOW);
    expect(r.allocations).toContainEqual({ paymentId: 'q1', invoiceId: 'i-ws', amountCents: 14900, method: 'auto' });
    expect(invoiceOpenCents(r, r.invoices.find((i) => i.id === 'i-ws')!)).toBe(0);
    expect(r.audit.at(-1)!.text).toBe('Automatisch zugeordnet: Rechnung RE-1101');
  });
  test('Bestätigen auf Rechnung lernt die IBAN normalisiert; zweite Zahlung → automatisch', () => {
    let r = stateWith({ invoices: [{ ...workshop, contactId: 'm-yilmaz', totalCents: 29800, openCents: 29800 }], payments: [tx({ id: 'q1', iban: 'de12 3456', payerName: 'Firma XY', amountCents: 14900 })] });
    r = reducer(r, { type: 'confirmPaymentMatch', paymentId: 'q1', invoiceId: 'i-ws' });
    expect(r.ibanLinks).toContainEqual(expect.objectContaining({ iban: 'DE123456', contactId: 'm-yilmaz' }));
    r = refresh({ ...r, payments: [...r.payments, tx({ id: 'q2', externalId: 'q2', iban: 'DE12 3456', amountCents: 14900 })] }, NOW);
    expect(r.allocations.find((a) => a.paymentId === 'q2')).toMatchObject({ invoiceId: 'i-ws', method: 'auto' });
  });
  test('Bestätigen lernt die IBAN je Kontakt: zweiter Kontakt wird zusätzlich verlinkt, gleicher nicht doppelt', () => {
    const pay = (id: string) => tx({ id, externalId: id, iban: 'DE55 1111', payerName: 'Firma XY', amountCents: 30000 });
    let r = stateWith({ contracts: [yilmaz, { ...base, id: 'k-kaya', contactId: 'm-kaya' }], payments: [pay('q1'), pay('q2'), pay('q3')] });
    r = reducer(r, { type: 'confirmPaymentMatch', paymentId: 'q1', contractId: 'k-yilmaz' });
    r = reducer(r, { type: 'confirmPaymentMatch', paymentId: 'q2', contractId: 'k-kaya' });
    r = reducer(r, { type: 'confirmPaymentMatch', paymentId: 'q3', contractId: 'k-kaya' });
    expect(r.ibanLinks.filter((l) => l.iban === 'DE551111').map((l) => l.contactId).sort()).toEqual(['m-kaya', 'm-yilmaz']);
  });
  test('Bestätigen auf nicht offene oder fremde Rechnung wird abgelehnt', () => {
    const paid = { ...workshop, status: 'paid' as const, openCents: 0 };
    const r = reducer(stateWith({ invoices: [paid], payments: [tx({ id: 'q1' })] }), { type: 'confirmPaymentMatch', paymentId: 'q1', invoiceId: 'i-ws' });
    expect(r.allocations).toEqual([]);
  });
  test('mehrdeutig → keine Auto-Zuordnung, Hinweis bleibt', () => {
    const r = refresh(stateWith({
      contracts: [yilmaz, { ...yilmaz, id: 'k-yilmaz-2' }],
      ibanLinks: [{ iban: 'DE00X', contactId: 'm-yilmaz', confirmedAt: '2026-10-01T10:00:00Z' }],
      payments: [tx({ id: 'q1', iban: 'DE00X', amountCents: 30000 })],
    }), NOW);
    expect(r.allocations).toEqual([]);
    expect(isOpen(r, 'unmatched:q1')).toBe(true);
  });
  test('Keine Mitgliedszahlung: ausgeblendet, kein Hinweis, keine Auto-Zuordnung, idempotent', () => {
    let r = refresh(stateWith({ payments: [tx({ id: 'q1', iban: 'DE00X', payerName: 'Fremd', amountCents: 5000 })] }), NOW);
    expect(isOpen(r, 'unmatched:q1')).toBe(true);
    r = refresh(reducer(r, { type: 'dismissPayment', paymentId: 'q1' }), NOW);
    expect(r.payments[0].ignoredAt).toBeDefined();
    expect(unallocatedBankPayments(r)).toHaveLength(0);
    expect(isOpen(r, 'unmatched:q1')).toBe(false);
    expect(reducer(r, { type: 'dismissPayment', paymentId: 'q1' }).payments).toEqual(r.payments);
  });
  test('Rückbuchung vor Zuordnung → keine Gutschrift; nach Bestätigung folgt sie dem Ziel', () => {
    const open = refresh(stateWith({ contracts: [yilmaz], payments: [
      tx({ id: 'q1', externalId: 't1', iban: 'DE00X', payerName: 'Selin Yilmaz', amountCents: 30000 }),
      tx({ id: 'q2', externalId: 't2', iban: 'DE00X', amountCents: -30000, refundOf: 't1' })] }), NOW);
    expect(open.allocations.filter((a) => a.paymentId === 'q2')).toEqual([]);
    expect(isOpen(open, 'unmatched:q2')).toBe(false);
    const after = reducer(open, { type: 'confirmPaymentMatch', paymentId: 'q1', contractId: 'k-yilmaz' });
    expect(refresh(after, NOW).allocations.find((a) => a.paymentId === 'q2')).toMatchObject({ contractId: 'k-yilmaz', amountCents: -30000 });
  });
  test('Stripe-Auszahlung nie gutgeschrieben', () => {
    const r = refresh(stateWith({ contracts: [yilmaz], ibanLinks: [{ iban: 'DE00X', contactId: 'm-yilmaz', confirmedAt: 'x' }],
      payments: [tx({ id: 'q1', iban: 'DE00X', kind: 'stripe_payout', amountCents: 30000 })] }), NOW);
    expect(r.allocations).toEqual([]);
    expect(isOpen(r, 'unmatched:q1')).toBe(false);
  });
  test('simulateTransfer normalisiert die IBAN', () => {
    const r = applyEvent(stateWith(), { type: 'simulateTransfer', iban: 'de12 3456', payerName: 'X Y', amountCents: 100 }, ctx());
    expect(r.state.payments.at(-1)!.iban).toBe('DE123456');
  });
  const orig = tx({ id: 'q1', externalId: 't1', iban: 'DE00X', payerName: 'Selin Yilmaz', amountCents: 30000 });
  const back = tx({ id: 'q2', externalId: 't2', iban: 'DE00X', amountCents: -30000, refundOf: 't1' });
  test('Original neu auf anderes Ziel bestätigt → Rückbuchung zieht mit', () => {
    const other = { ...base, id: 'k-other', contactId: 'm-kaya' };
    let r = stateWith({ contracts: [yilmaz, other], payments: [orig, back] });
    r = reducer(r, { type: 'confirmPaymentMatch', paymentId: 'q1', contractId: 'k-yilmaz' });
    expect(r.allocations.find((a) => a.paymentId === 'q2')).toMatchObject({ contractId: 'k-yilmaz' });
    r = reducer(r, { type: 'confirmPaymentMatch', paymentId: 'q1', contractId: 'k-other' });
    expect(r.allocations.filter((a) => a.paymentId === 'q2')).toEqual([{ paymentId: 'q2', contractId: 'k-other', amountCents: -30000, method: 'auto' }]);
  });
  test('Rückbuchung zieht höchstens den zugeordneten Betrag ab (Überzahlung auf Rechnung)', () => {
    const o = tx({ id: 'q1', externalId: 't1', iban: 'DE00X', payerName: 'Selin Yilmaz', amountCents: 20000 });
    const b = tx({ id: 'q2', externalId: 't2', iban: 'DE00X', amountCents: -20000, refundOf: 't1' });
    const r = refresh(reducer(stateWith({ invoices: [workshop], payments: [o, b] }), { type: 'confirmPaymentMatch', paymentId: 'q1', invoiceId: 'i-ws' }), NOW);
    expect(r.allocations.find((a) => a.paymentId === 'q1')!.amountCents).toBe(14900);
    expect(r.allocations.find((a) => a.paymentId === 'q2')).toMatchObject({ invoiceId: 'i-ws', amountCents: -14900 });
    expect(invoiceOpenCents(r, r.invoices.find((i) => i.id === 'i-ws')!)).toBe(14900);
  });
  test('Rechnungs-Zuordnung ändert nie den Rückstand eines Vertrags', () => {
    const inv = { ...workshop, contactId: 'm-yilmaz' };
    const s0 = stateWith({ contracts: [yilmaz], invoices: [inv], payments: [tx({ id: 'q1', iban: 'DE00X', payerName: 'Selin Yilmaz', amountCents: 14900 })] });
    const before = memberView(s0, 'k-yilmaz', '2026-11-12').status;
    const after = memberView(reducer(s0, { type: 'confirmPaymentMatch', paymentId: 'q1', invoiceId: 'i-ws' }), 'k-yilmaz', '2026-11-12').status;
    expect(after.arrearsCents).toBe(before.arrearsCents);
    expect(after).toEqual(before);
  });
  test('Bestätigen von Beträgen <= 0 wird abgelehnt', () => {
    const r = reducer(stateWith({ contracts: [yilmaz], payments: [orig, back] }), { type: 'confirmPaymentMatch', paymentId: 'q2', contractId: 'k-yilmaz' });
    expect(r.allocations.filter((a) => a.paymentId === 'q2')).toEqual([]);
  });
  test('Überzahlung auf Rechnung: höchstens der offene Betrag wird zugeordnet', () => {
    const r = reducer(stateWith({ invoices: [workshop], payments: [tx({ id: 'q1', amountCents: 20000 })] }), { type: 'confirmPaymentMatch', paymentId: 'q1', invoiceId: 'i-ws' });
    expect(r.allocations).toEqual([{ paymentId: 'q1', invoiceId: 'i-ws', amountCents: 14900, method: 'confirmed' }]);
  });
  test('refresh ist idempotent und überschreibt Bestätigtes nie', () => {
    const s0 = stateWith({ invoices: [workshop], contracts: [yilmaz], payments: [orig, back, tx({ id: 'q3', externalId: 't3', reference: 'RE-1101', amountCents: 14900 })] });
    const c = reducer(s0, { type: 'confirmPaymentMatch', paymentId: 'q1', contractId: 'k-yilmaz' });
    const once = refresh(c, NOW);
    const twice = refresh(once, NOW);
    expect(twice.allocations).toEqual(once.allocations);
    expect(twice.allocations.filter((a) => a.paymentId === 'q3')).toHaveLength(1);
    expect(twice.allocations.filter((a) => a.paymentId === 'q2')).toHaveLength(1);
    expect(twice.allocations.find((a) => a.paymentId === 'q1')).toMatchObject({ contractId: 'k-yilmaz', method: 'confirmed' });
  });
});
