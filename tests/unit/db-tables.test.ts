import { describe, it, expect } from 'vitest';
import { createDemoState } from '@/data/seed';
import { applyEvent, refresh } from '@/data/engine';
import { toRows, fromRows, diffState, TABLES } from '@/server/db/tables';
import { createEmptyState } from '@/data/empty-state';
import type { OrderConfirmation, PortalMember, Subscription } from '@/domain/types';

import { NOW_0930 as NOW, stateWith } from './helpers';

const demo = () => {
  const s = createDemoState();
  const cid = s.contracts[0].id;
  s.exceptions = { [cid]: [{ kind: 'x' } as never] };
  const a = s.allocations[0] ?? { paymentId: 'p1', contractId: cid, amountCents: 100, method: 'auto' as const };
  s.allocations = [...s.allocations, a, { ...a }];
  return s;
};

describe('tables', () => {
  it('Rundreise toRows/fromRows ist verlustfrei', () => {
    const s = demo();
    expect(fromRows(toRows(s))).toEqual(s);
  });
  it('IBAN-Links: gleiche IBAN bei zwei Kontakten ergibt zwei Zeilen mit eindeutiger id; alte Zeile (id = IBAN) wird ersetzt', () => {
    const l = (contactId: string) => ({ iban: 'DE55', contactId, confirmedAt: 'x' });
    const prev = { ...demo(), ibanLinks: [l('a')] };
    const next = { ...prev, ibanLinks: [l('a'), l('b')] };
    const rows = toRows(next).iban_links;
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(fromRows(toRows(next)).ibanLinks).toEqual(next.ibanLinks);
    const d = diffState(prev, next).iban_links;
    expect(d.upsert.length).toBeGreaterThanOrEqual(1);
    // Zeilen im bisherigen Format (id = IBAN) bleiben lesbar
    const old = toRows(prev);
    old.iban_links = [{ id: 'DE55', ord: 0, data: l('a') }];
    expect(fromRows(old).ibanLinks).toEqual([l('a')]);
  });
  it('doppelte Allocation-Paare bekommen laufende Nummern', () => {
    const rows = toRows(demo()).allocations;
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((i) => i.endsWith(':1'))).toBe(true);
  });
  it('fehlende Tabellen fallen auf den Leerzustand zurück', () => {
    const s = fromRows({});
    expect(s.contracts).toEqual([]);
    expect(s.settings.replyThresholdHours).toBe(2);
  });
  it('leere Tabellen (frische Datenbank) liefern trotzdem alle Verbindungen des Katalogs als „missing“', () => {
    const s = fromRows({ connections: [], settings: [] });
    expect(s.connections.map((c) => c.id)).toEqual(createEmptyState().connections.map((c) => c.id));
    expect(s.connections.every((c) => c.status === 'missing')).toBe(true);
  });
  it('gespeicherte Verbindungen bleiben, fehlende Katalog-Einträge werden ergänzt', () => {
    const [first] = createEmptyState().connections;
    const stored = { ...first, status: 'connected' as const };
    const s = fromRows({ connections: [{ id: stored.id, ord: 0, data: stored }] });
    expect(s.connections[0]).toEqual(stored);
    expect(s.connections).toHaveLength(createEmptyState().connections.length);
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
    expect(fromRows(shuffled)).toEqual(s);
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

const SUB: Subscription = {
  id: 'sub-1', connectionId: 'stripe_nexus', externalId: 'sub_A', stripeCustomerId: 'cus_1', customerName: 'Max', customerEmail: null,
  productName: 'Mitgliedschaft', amountCents: 5000, priceCents: 5000, currency: 'eur', interval: 'month', startDate: '2026-08-01', anchorDay: 1,
  cancelAt: null, endDate: null, installments: null, status: 'active', disputes: [], contractId: null, confirmedPriceCents: null, confirmedEndDate: null,
};

describe('Verträge-Tabellen', () => {
  it('subscriptions mit Schlüsselspalten, dismissedProposals als eigene Zeilen', () => {
    const s = { ...createEmptyState(), subscriptions: [SUB], dismissedProposals: ['stripe_nexus:sub_X'] };
    const r = toRows(s);
    expect(r.subscriptions[0]).toMatchObject({ id: SUB.id, connection_id: 'stripe_nexus', external_id: 'sub_A' });
    expect(r.dismissed_proposals).toEqual([{ id: 'stripe_nexus:sub_X', ord: 0, data: 'stripe_nexus:sub_X' }]);
    expect(fromRows(r)).toEqual(s);
  });
  it('fehlende neue Tabellen → leere Listen', () => {
    const s = fromRows({});
    expect(s.subscriptions).toEqual([]);
    expect(s.dismissedProposals).toEqual([]);
  });
});

describe('Zuordnung auf Rechnung', () => {
  it('eigene Zeilen-ID, Rundreise', () => {
    const s = stateWith({ allocations: [{ paymentId: 'p', invoiceId: 'i1', amountCents: 1, method: 'auto' }] });
    expect(toRows(s).allocations[0].id).toBe('p:inv:i1:0');
    expect(fromRows(toRows(s)).allocations).toEqual(s.allocations);
  });
});

it('Portal-Mitglieder und Ausgeblendete überstehen toRows/fromRows', () => {
  const m: PortalMember = { id: 'pm1', connectionId: 'portal_nexus', externalId: 'a@b.de', email: 'a@b.de', name: 'A', firstSeenAt: '2026-11-12T08:30:00.000Z', lastSeenInListAt: '2026-11-12T08:30:00.000Z' };
  const s = { ...createEmptyState(), portalMembers: [m], ignoredPortalMembers: ['x@y.de'] };
  const rows = toRows(s);
  expect(rows.portal_members[0]).toMatchObject({ id: 'pm1', connection_id: 'portal_nexus', external_id: 'a@b.de' });
  expect(rows.ignored_portal_members[0]).toMatchObject({ id: 'x@y.de', data: 'x@y.de' });
  expect(fromRows(rows)).toMatchObject({ portalMembers: [m], ignoredPortalMembers: ['x@y.de'] });
});

it('Auftragsbestätigungen überstehen toRows/fromRows, eigene Tabelle mit Schlüsselspalten', () => {
  const ab: OrderConfirmation = { id: 'ab1', company: 'nexus', connectionId: 'lexware_nexus', externalId: 'oc-1', contactExternalId: 'c-1', contactId: null, number: 'AB-1', totalCents: 120000, issuedOn: '2026-07-01', status: 'open', text: 'Mitgliedschaft 12 Monate' };
  const s = { ...createEmptyState(), orderConfirmations: [ab] };
  const rows = toRows(s);
  expect(TABLES.orderConfirmations).toBe('order_confirmations');
  expect(rows.order_confirmations[0]).toMatchObject({ id: 'ab1', connection_id: 'lexware_nexus', external_id: 'oc-1' });
  expect(fromRows(rows).orderConfirmations).toEqual([ab]);
  expect(fromRows({}).orderConfirmations).toEqual([]);
});
