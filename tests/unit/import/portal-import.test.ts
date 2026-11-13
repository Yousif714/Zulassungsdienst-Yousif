import { describe, expect, test } from 'vitest';
import { applyEvent, type EngineContext } from '@/data/engine';
import { mergePortalList, parsePortalList } from '@/domain/import/portal-list';
import type { PortalMember } from '@/domain/types';
import { NOW_0930 } from '../helpers';
import { portalListText } from '../../fixtures';
import { portalState, seq } from './helpers';

const ctx = (p: Partial<EngineContext> = {}): EngineContext => ({ at: NOW_0930, isDemo: true, newId: seq(), ...p });

test('erster Import: 5 Mitglieder, Verbindung verbunden mit Stand', () => {
  const s = portalState;
  expect(s.portalMembers.map((m) => m.externalId)).toEqual(['ayse@example.de', 'murat@example.de', 'nina@example.de', 'neu@example.de', 'team@nexusnetzwerk.de']);
  expect(s.portalMembers.find((m) => m.externalId === 'team@nexusnetzwerk.de')!.name).toBe('team');
  expect(s.connections.find((c) => c.id === 'portal_nexus')).toMatchObject({ status: 'connected', lastSuccessAt: NOW_0930.toISOString() });
  expect(s.audit.at(-1)!.text).toBe('Mitgliederliste übernommen: 5 Mitglieder, 5 neu, 0 nicht mehr in der Liste');
});

test('Review 2: kürzere zweite Liste löscht nichts, markiert Fehlende', () => {
  const later = new Date('2026-11-20T08:00:00Z');
  const r = applyEvent(portalState, { type: 'importPortalList', entries: [{ email: 'AYSE@example.de', name: '' }] }, ctx({ at: later })).state;
  expect(r.portalMembers).toHaveLength(5);
  const ayse = r.portalMembers.find((m) => m.externalId === 'ayse@example.de')!;
  expect(ayse).toMatchObject({ name: 'Ayşe Öztürk', lastSeenInListAt: later.toISOString(), firstSeenAt: NOW_0930.toISOString() });
  expect(ayse.id).toBe(portalState.portalMembers[0].id);
  expect(r.portalMembers.find((m) => m.externalId === 'murat@example.de')!.lastSeenInListAt).toBe(NOW_0930.toISOString());
  expect(r.audit.at(-1)!.text).toBe('Mitgliederliste übernommen: 1 Mitglieder, 0 neu, 4 nicht mehr in der Liste');
});

test('leere oder nur ungültige Liste → nichts geändert', () => {
  const r = applyEvent(portalState, { type: 'importPortalList', entries: [{ email: 'kaputt', name: 'X' }] }, ctx()).state;
  expect(r.portalMembers).toEqual(portalState.portalMembers);
  expect(r.audit.at(-1)!.text).toBe('Mitgliederliste leer, nichts übernommen');
});

describe('mergePortalList', () => {
  const at = '2026-11-20T08:00:00.000Z';
  test('speichert alle E-Mails und Zusatzfelder, Name-Fallback vor @', () => {
    const r = mergePortalList([], [{ email: 'a@x.de', name: '', emails: ['a@x.de', 'b@x.de'], joinedOn: '2026-08-01', joinedText: '06.11.2026 / 01.08.2026', lastActiveOn: null, lastActiveText: 'gestern' }], at, seq());
    expect(r).toMatchObject({ added: 1, missing: 0 });
    expect(r.items[0]).toEqual({ id: 'id-1', connectionId: 'portal_nexus', externalId: 'a@x.de', email: 'a@x.de', emails: ['a@x.de', 'b@x.de'], name: 'a', firstSeenAt: at, lastSeenInListAt: at, joinedOn: '2026-08-01', joinedText: '06.11.2026 / 01.08.2026', lastActiveOn: null, lastActiveText: 'gestern' });
  });
  test('bekanntes Mitglied: Zusatzadresse der neuen Liste findet es, Daten bleiben wenn nicht geliefert', () => {
    const old: PortalMember = { id: 'm1', connectionId: 'portal_nexus', externalId: 'a@x.de', email: 'a@x.de', name: 'Alt', firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenInListAt: '2026-01-01T00:00:00.000Z', joinedText: 'alt' };
    const r = mergePortalList([old], [{ email: 'c@x.de', name: '', emails: ['c@x.de', 'a@x.de'] }], at, seq());
    expect(r.added).toBe(0);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ id: 'm1', externalId: 'a@x.de', name: 'Alt', joinedText: 'alt', lastSeenInListAt: at, firstSeenAt: old.firstSeenAt });
    expect(r.items[0].emails).toEqual(['a@x.de', 'c@x.de']);
  });
  test('Eintrag trifft zwei Mitglieder: beide bleiben getrennt, nur das mit der Hauptadresse wird aktualisiert, keiner fehlt', () => {
    const mk = (id: string, email: string, name: string): PortalMember => ({ id, connectionId: 'portal_nexus', externalId: email, email, name, firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenInListAt: '2026-01-01T00:00:00.000Z' });
    const a = mk('m1', 'a@x.de', 'Anna');
    const b = mk('m2', 'b@x.de', 'Berta');
    const r = mergePortalList([a, b], [{ email: 'b@x.de', name: 'Neu', emails: ['b@x.de', 'a@x.de', 'c@x.de'] }], at, seq());
    expect(r.items).toHaveLength(2);
    expect(r.added).toBe(0);
    expect(r.missing).toBe(0);
    expect(r.items[0]).toEqual(a);
    expect(r.items[1]).toMatchObject({ id: 'm2', name: 'Neu', lastSeenInListAt: at, emails: ['b@x.de', 'c@x.de'] });
    // ohne Hauptadresse-Treffer: das erste
    const r2 = mergePortalList([a, b], [{ email: 'z@x.de', name: '', emails: ['z@x.de', 'b@x.de', 'a@x.de'] }], at, seq());
    expect(r2.items[0]).toMatchObject({ id: 'm1', lastSeenInListAt: at, emails: ['a@x.de', 'z@x.de'] });
    expect(r2.items[1]).toEqual(b);
    expect(r2.missing).toBe(0);
  });
});

test('Idempotenz: dieselbe Liste zweimal ändert nur Zeitstempel', () => {
  const later = new Date('2026-11-20T08:00:00Z');
  const entries = parsePortalList(portalListText).entries;
  const r = applyEvent(portalState, { type: 'importPortalList', entries }, ctx({ at: later })).state;
  const strip = (ms: PortalMember[]) => ms.map(({ lastSeenInListAt: _l, ...m }) => m);
  expect(strip(r.portalMembers)).toEqual(strip(portalState.portalMembers));
  expect(r.portalMembers.every((m) => m.lastSeenInListAt === later.toISOString())).toBe(true);
  expect(r.audit.at(-1)!.text).toBe('Mitgliederliste übernommen: 5 Mitglieder, 0 neu, 0 nicht mehr in der Liste');
});
