import { describe, it, expect } from 'vitest';
import { createDemoState } from '@/data/seed';
import { applyEvent, refresh } from '@/data/engine';
import { toRows, fromRows, diffState, TABLES } from '@/server/db/tables';

import { NOW_0930 as NOW } from './helpers';

const demo = () => {
  const s = createDemoState();
  const cid = s.contracts[0].id;
  s.exceptions = { [cid]: [{ kind: 'x' } as never] };
  const a = s.allocations[0] ?? { paymentId: 'p1', contractId: cid, amountCents: 100, method: 'auto' as const };
  s.allocations = [...s.allocations, a, { ...a }];
  s.jobRuns = ['job:a', 'job:b'];
  return s;
};

describe('tables', () => {
  it('Rundreise toRows/fromRows ist verlustfrei', () => {
    const s = demo();
    expect(fromRows(toRows(s), s.jobRuns)).toEqual(s);
  });
  it('doppelte Allocation-Paare bekommen laufende Nummern', () => {
    const rows = toRows(demo()).allocations;
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((i) => i.endsWith(':1'))).toBe(true);
  });
  it('fehlende Tabellen fallen auf den Leerzustand zurück', () => {
    const s = fromRows({}, []);
    expect(s.contracts).toEqual([]);
    expect(s.settings.replyThresholdHours).toBe(2);
  });
  it('Schlüsselspalten', () => {
    const s = demo();
    const inv = toRows(s).invoices[0];
    if (inv) expect(inv.external_id).toBe(s.invoices[0].externalId);
    expect(toRows(s).insights.every((r) => r.dedupe_key === r.id)).toBe(true);
    expect(TABLES.exceptions).toBeDefined();
  });
  it('fromRows sortiert nach ord, unabhängig von der Eingabereihenfolge', () => {
    const s = demo();
    s.assistantChat = [{ id: 'm2', text: 'b' }, { id: 'm1', text: 'a' }] as never;
    const rows = toRows(s);
    const shuffled = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, [...v].reverse()]));
    expect(fromRows(shuffled, s.jobRuns)).toEqual(s);
  });
  it('Umordnen erzeugt Upserts (ord ist Teil der Zeile)', () => {
    const s = demo();
    const n = { ...s, contacts: [...s.contacts].reverse() };
    if (s.contacts.length > 1) expect(diffState(s, n).contacts.upsert.length).toBeGreaterThan(0);
  });
  it('diffState(s, s) ist leer', () => {
    const s = demo();
    for (const c of Object.values(diffState(s, s))) expect(c).toEqual({ upsert: [], delete: [] });
  });
  it('dismissInsight erzeugt genau einen Insight-Upsert und Audit-Zeilen', () => {
    const s = refresh(createDemoState(), NOW);
    const key = s.insights.find((i) => i.status === 'open')!.dedupeKey;
    let n = 0;
    const r = applyEvent(s, { type: 'dismissInsight', key }, { at: NOW, isDemo: false, newId: () => `id${++n}` });
    const d = diffState(s, r.state);
    expect(d.insights.upsert).toHaveLength(1);
    expect(d.insights.upsert[0].id).toBe(key);
    expect(d.audit.upsert.length).toBeGreaterThan(0);
    expect(d.audit.upsert[0].id).toBe(String(s.audit.length).padStart(8, '0'));
  });
});
