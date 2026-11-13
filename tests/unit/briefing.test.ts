import { describe, expect, test } from 'vitest';
import { MONEY_SOURCES, buildBriefing, renderBriefingText } from '@/domain/briefing';
import { createDemoState } from '@/data/seed';
import { refresh } from '@/data/store';
import type { StoredInsight } from '@/domain/types';
import { invoicePaidCents } from '@/domain/ledger/receivables';
import { NOW_0930 as NOW, conn, inv, ins, sptx, stateWith } from './helpers';

const stored = (key: string, p: Partial<StoredInsight> = {}): StoredInsight => ({ ...ins(key), status: 'open', createdAt: '2026-11-12T06:00:00Z', ...p });

const state = () =>
  stateWith({
    insights: [
      stored('a', { priority: 'now', title: 'Schmidt wartet', nextStep: 'Antwort senden' }),
      stored('b'), stored('c'), stored('d'),
      stored('k1', { type: 'coach_quick_reply', priority: 'info', title: 'Schnellantwort', nextStep: 'Vorlage anlegen' }),
    ],
    events: [
      { id: 'e2', title: 'Zulassung Essen', startAt: '2026-11-12T12:00:00Z', endAt: '2026-11-12T13:00:00Z' },
      { id: 'e1', title: 'Team-Call', startAt: '2026-11-12T09:00:00Z', endAt: '2026-11-12T10:00:00Z' },
      { id: 'e3', title: 'Morgen', startAt: '2026-11-13T09:00:00Z', endAt: '2026-11-13T10:00:00Z' },
    ],
    invoices: [inv('1', 10000, { dueDate: '2026-11-01', status: 'overdue' }), inv('2', 5000)],
  });

describe('Briefing', () => {
  test('Morgen', () => {
    const b = buildBriefing(state(), 'morning', NOW);
    expect(b.top.length).toBeLessThanOrEqual(3);
    expect(b.top.every((t) => !t.type.startsWith('coach_'))).toBe(true);
    expect(b.coach).toHaveLength(1);
    expect(b.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(b.money.find((m) => m.company === 'zulassung')).toEqual({ company: 'zulassung', openCents: 15000, overdueCents: 10000, stale: false });
    const t = renderBriefingText(b);
    expect(t).toMatch(/^Guten Morgen/);
    expect(t).toContain('Stand: 09:30');
    expect(t).toContain('1. Schmidt wartet · Antwort senden');
    expect(t).toContain('Geld Zulassungsdienst: offen 150,00 €, überfällig 100,00 €');
  });
  test('Abend mit Coach-Tipps am Ende', () => {
    const t = renderBriefingText(buildBriefing(state(), 'evening', NOW));
    expect(t).toMatch(/^Guten Abend\. Rückblick:/);
    expect(t.split('\n').pop()).toContain('Schnellantwort');
  });
  test('Wochenrückblick', () => {
    const b = buildBriefing(state(), 'weekly', NOW);
    expect(b.title).toBe('Wochenrückblick');
    expect(renderBriefingText(b)).toMatch(/^Wochenrückblick:/);
  });
  test('veraltete Quelle', () => {
    const s = stateWith({ connections: [conn({ id: 'lexware_zulassung', status: 'error' })] });
    const b = buildBriefing(s, 'morning', NOW);
    expect(b.staleSources).toContain('lexware_zulassung');
    expect(renderBriefingText(b)).toContain('Geld Zulassungsdienst: Datenstand zu alt');
  });
});

describe('Briefing mit Demo-Daten', () => {
  test('Morgen', () => {
    const b = buildBriefing(refresh(createDemoState(), NOW), 'morning', NOW);
    expect(b.top.length).toBeLessThanOrEqual(3);
    const t = renderBriefingText(b);
    expect(t).toMatch(/^Guten Morgen/);
    expect(t).toContain('Stand: 09:30');
  });
});

describe('Briefing Zulassung mit Sparkasse-Zuordnung', () => {
  const z600 = inv('i-z6', 60000, { dueDate: '2026-10-01', status: 'overdue' });
  const alloc42 = { paymentId: 'sp1', invoiceId: 'i-z6', amountCents: 42000, method: 'confirmed' as const };
  const zMoney = (s: ReturnType<typeof stateWith>) => buildBriefing(s, 'morning', NOW).money.find((m) => m.company === 'zulassung')!;
  test('Briefing Zulassung: offen 180 € statt 600 €', () => {
    expect(zMoney(stateWith({ invoices: [z600], payments: [sptx({ amountCents: 42000 })], allocations: [alloc42] }))).toMatchObject({ openCents: 18000, overdueCents: 18000 });
  });
  test('Lexware setzt danach bezahlt → offen 0, nicht negativ, keine Doppelzählung', () => {
    const s = stateWith({ invoices: [{ ...z600, status: 'paid', openCents: 0 }], payments: [sptx({ amountCents: 60000 })], allocations: [{ ...alloc42, amountCents: 60000 }] });
    expect(zMoney(s)).toMatchObject({ openCents: 0, overdueCents: 0 });
    expect(invoicePaidCents(s, s.invoices[0])).toBe(60000);
  });
  test('Lexware meldet Teilbetrag, Zuordnung größer → kleinerer Wert gewinnt', () => {
    const s = stateWith({ invoices: [{ ...z600, openCents: 10000 }], payments: [sptx({ amountCents: 42000 })], allocations: [alloc42] });
    expect(zMoney(s).openCents).toBe(10000);
  });
  test('MONEY_SOURCES.zulassung bleibt nur Lexware', () => expect(MONEY_SOURCES.zulassung).toEqual(['lexware_zulassung']));
});
