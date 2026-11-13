import { expect, test } from 'vitest';
import { applyEvent, applyEvents, type EngineContext } from '@/data/engine';
import type { ContractDraft } from '@/domain/import/contract-draft';
import { parsePortalList } from '@/domain/import/portal-list';
import { portalViews } from '@/domain/portal';
import type { AppState, Contact } from '@/domain/types';
import { NOW_0930, tx } from '../helpers';
import { portalListText } from '../../fixtures';
import { portalState, seq } from './helpers';

const ctx = (p: Partial<EngineContext> = {}): EngineContext => ({ at: NOW_0930, isDemo: true, newId: seq(), ...p });
const draft: ContractDraft = { totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 1, startDate: '2026-10-01', catchUpMode: 'first_rate' };
const e = { type: 'createPortalContract', externalId: 'neu@example.de', draft, contactId: null } as const;
const withContact = (s: AppState, c: Partial<Contact>): AppState => ({ ...s, contacts: [...s.contacts, { id: 'k1', company: 'nexus', kind: 'member', name: 'Anders', phones: [], emails: [], ...c }] });

test('legt Vertrag und Kontakt mit Portal-Ref an', () => {
  const r = applyEvent(portalState, e, ctx());
  const k = r.state.contracts.find((c) => c.id === r.created[0])!;
  expect(k).toMatchObject({ billing: 'legacy', origin: [{ connectionId: 'portal_nexus', externalId: 'neu@example.de' }], installments: 6 });
  expect(r.state.contacts.find((c) => c.id === k.contactId)).toMatchObject({ company: 'nexus', kind: 'member', name: 'Paula Neu', emails: ['neu@example.de'], externalRefs: [{ connectionId: 'portal_nexus', externalId: 'neu@example.de' }] });
  expect(portalViews(r.state).find((v) => v.member.externalId === 'neu@example.de')!.status).toBe('contract');
  expect(r.state.audit.at(-1)!.text).toMatch(/^Vertrag angelegt \(Portal\): Paula Neu, 6 × /);
});

test('doppelter Tipp ergibt einen Vertrag', () => {
  const r = applyEvents(portalState, [e, e], ctx());
  expect(r.state.contracts).toHaveLength(1);
  expect(r.state.audit.at(-1)!.text).toBe('Vertrag nicht angelegt: Mitglied hat schon einen Vertrag oder Vorschlag.');
});

test('unbekanntes Mitglied: Audit, nichts angelegt', () => {
  const r = applyEvent(portalState, { ...e, externalId: 'x@nirgends.de' }, ctx());
  expect(r.state.contracts).toHaveLength(0);
  expect(r.state.audit.at(-1)!.text).toBe('Portal-Mitglied nicht gefunden');
});

test('Validierung: kein Vertrag, Fehlertext', () => {
  const r = applyEvent(portalState, { ...e, draft: { ...draft, dueDay: 32 } }, ctx());
  expect(r.state.contracts).toHaveLength(0);
  expect(r.state.contacts).toEqual(portalState.contacts);
  expect(r.state.audit.at(-1)!.text).toContain('Fälligkeitstag muss zwischen 1 und 31 liegen.');
});

test('E-Mail-Kontakt wird genutzt und um Portal-Ref ergänzt', () => {
  const s = withContact(portalState, { emails: ['NEU@example.de'] });
  const r = applyEvent(s, e, ctx());
  expect(r.state.contacts).toHaveLength(1);
  expect(r.state.contracts[0].contactId).toBe('k1');
  expect(r.state.contacts[0].externalRefs).toEqual([{ connectionId: 'portal_nexus', externalId: 'neu@example.de' }]);
});

test('Kontakt mit nur der Zweit-E-Mail wird wiederverwendet', () => {
  const s0: AppState = { ...portalState, portalMembers: portalState.portalMembers.map((m) => (m.externalId === 'neu@example.de' ? { ...m, emails: ['neu@example.de', 'zweit@example.de'] } : m)) };
  const s = withContact(s0, { emails: ['Zweit@example.de'] });
  const r = applyEvent(s, e, ctx());
  expect(r.state.contacts).toHaveLength(1);
  expect(r.state.contracts[0].contactId).toBe('k1');
  expect(r.state.contacts[0].externalRefs).toEqual([{ connectionId: 'portal_nexus', externalId: 'neu@example.de' }]);
});

test('Namenstreffer nur mit Bestätigung wiederverwendet', () => {
  const s = withContact(portalState, { name: 'Paula Neu' });
  const no = applyEvent(s, e, ctx());
  expect(no.state.contacts).toHaveLength(2);
  expect(no.state.contracts[0].contactId).not.toBe('k1');
  const yes = applyEvent(s, { ...e, contactId: 'k1' }, ctx());
  expect(yes.state.contacts).toHaveLength(1);
  expect(yes.state.contracts[0].contactId).toBe('k1');
});

test('neuer Kontakt bekommt alle E-Mails des Mitglieds', () => {
  const s: AppState = { ...portalState, portalMembers: portalState.portalMembers.map((m) => (m.externalId === 'neu@example.de' ? { ...m, emails: ['neu@example.de', 'zweit@example.de'] } : m)) };
  const r = applyEvent(s, e, ctx());
  expect(r.state.contacts.find((c) => c.id === r.state.contracts[0].contactId)!.emails).toEqual(['neu@example.de', 'zweit@example.de']);
});

test('Zahlung danach zuordenbar', () => {
  const st = applyEvent({ ...portalState, payments: [tx({ id: 'p1', amountCents: 10000, payerName: 'Paula Neu', bookedOn: '2026-10-02' })] }, e, ctx()).state;
  const contractId = st.contracts[0].id;
  const r = applyEvent(st, { type: 'confirmPaymentMatch', paymentId: 'p1', contractId }, ctx()).state;
  expect(r.allocations).toContainEqual(expect.objectContaining({ paymentId: 'p1', contractId, amountCents: 10000 }));
});

test('Kein zahlendes Mitglied: idempotent, bleibt nach erneutem Import ausgeblendet', () => {
  const i = { type: 'ignorePortalMember', externalId: 'team@nexusnetzwerk.de' } as const;
  const once = applyEvent(portalState, i, ctx());
  expect(once.state.audit.at(-1)!.text).toBe('Kein zahlendes Mitglied: team');
  const a = applyEvents(portalState, [i, i], ctx()).state;
  expect(a.ignoredPortalMembers).toEqual(['team@nexusnetzwerk.de']);
  expect(a.audit.filter((x) => x.text.startsWith('Kein zahlendes Mitglied')).length).toBe(1);
  const b = applyEvent(a, { type: 'importPortalList', entries: parsePortalList(portalListText).entries }, ctx()).state;
  expect(portalViews(b).find((v) => v.member.externalId === 'team@nexusnetzwerk.de')!.status).toBe('ignored');
});

test('Namenstreffer mit bestehendem Vertrag: kein zweiter Vertrag, nur Verknüpfung', () => {
  const s0 = withContact(portalState, { name: 'Paula Neu', emails: ['andere@example.de'] });
  const s = { ...s0, contracts: [{ ...draft, id: 'v1', contactId: 'k1', billing: 'legacy' as const }] };
  const r = applyEvent(s, { ...e, contactId: 'k1' }, ctx());
  expect(r.state.contracts).toHaveLength(1);
  expect(r.state.contacts).toHaveLength(s.contacts.length);
  expect(r.state.contacts.find((c) => c.id === 'k1')!.externalRefs).toEqual([{ connectionId: 'portal_nexus', externalId: 'neu@example.de' }]);
  expect(r.state.audit.at(-1)!.text).toBe('Vertrag nicht angelegt: Paula Neu hat schon einen Vertrag, Mitglied mit dem Kontakt verknüpft.');
  expect(portalViews(r.state).find((v) => v.member.externalId === 'neu@example.de')!.status).toBe('contract');
});

test('Wieder einblenden: entfernt aus der Ausblendeliste, idempotent', () => {
  const i = { type: 'ignorePortalMember', externalId: 'team@nexusnetzwerk.de' } as const;
  const u = { type: 'unignorePortalMember', externalId: 'team@nexusnetzwerk.de' } as const;
  const hidden = applyEvent(portalState, i, ctx()).state;
  const r = applyEvent(hidden, u, ctx());
  expect(r.state.ignoredPortalMembers).toEqual([]);
  expect(r.state.audit.at(-1)!.text).toBe('Mitglied wieder eingeblendet: team');
  expect(portalViews(r.state).find((v) => v.member.externalId === 'team@nexusnetzwerk.de')!.status).not.toBe('ignored');
  const again = applyEvent(r.state, u, ctx());
  expect(again.state.audit).toHaveLength(r.state.audit.length);
});
