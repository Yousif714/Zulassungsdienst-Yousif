import { describe, expect, test } from 'vitest';
import { createDemoState } from '@/data/seed';
import { applyEvent, applyEvents, refresh, type EngineContext } from '@/data/engine';
import { reducer } from '@/data/store';
import type { StoreEvent } from '@/domain/events';
import { NOW_0930 as NOW } from './helpers';
import { stripeBatch } from './import/helpers';

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
