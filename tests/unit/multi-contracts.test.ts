import { expect, test } from 'vitest';
import { applyEvent, type EngineContext } from '@/data/engine';
import { overdueMembers } from '@/data/selectors';
import { draftLink } from '@/domain/assistant';
import { memberView } from '@/domain/detectors';
import { detectMemberOverdue } from '@/domain/detectors/members';
import { buildMatchContext } from '@/domain/detectors/payments';
import { matchBankPayment } from '@/domain/matching/payments';
import { portalViews } from '@/domain/portal';
import type { Action, AppState, Contact, MemberContract } from '@/domain/types';
import { NOW_0930, base, stateWith, tx } from './helpers';
import { portalState, seq } from './import/helpers';

const TODAY = '2026-11-12';
const ctx = (): EngineContext => ({ at: NOW_0930, isDemo: false, newId: seq() });
const erika: Contact = { id: 'm-x', company: 'nexus', kind: 'member', name: 'Erika Beispiel', phones: [], emails: ['neu@example.de'], externalRefs: [{ connectionId: 'portal_nexus', externalId: 'neu@example.de' }] };
const kT: MemberContract = { ...base, id: 'k-t', contactId: 'm-x', kind: 'ticket', totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 1, startDate: '2026-09-01' };
const kM: MemberContract = { ...base, id: 'k-m', contactId: 'm-x', totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-09-01' };
const s = stateWith({ contacts: [erika], contracts: [kT, kM] });

test('Portal: contractId über den Mitgliedsvertrag, auch wenn der Ticket-Vertrag zuerst steht', () => {
  const st: AppState = { ...portalState, contacts: [...portalState.contacts, erika], contracts: [kT, kM] };
  expect(portalViews(st).find((v) => v.member.externalId === 'neu@example.de')).toMatchObject({ status: 'contract', contractId: 'k-m' });
});

test('Portal-Vertrag anlegen trotz Ticket-Vertrag des Kontakts', () => {
  const st: AppState = { ...portalState, contacts: [...portalState.contacts, erika], contracts: [kT] };
  const draft = { totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 1, startDate: '2026-10-01', catchUpMode: 'first_rate' as const };
  const r = applyEvent(st, { type: 'createPortalContract', externalId: 'neu@example.de', draft, contactId: null }, ctx());
  expect(r.state.contracts).toHaveLength(2);
  expect(r.state.contracts.filter((c) => c.contactId === 'm-x').map((c) => c.kind ?? 'membership').sort()).toEqual(['membership', 'ticket']);
});

test('Assistent: Entwurf öffnen zeigt den Vertrag der Erinnerung', () => {
  const a: Action = { id: 'a1', type: 'send_reminder', company: 'nexus', title: 'Erinnerung', payload: { contactId: 'm-x' }, version: 1, status: 'draft', createdAt: NOW_0930.toISOString(), isDemo: false, insightKey: 'overdue:k-t' };
  expect(draftLink({ ...s, actions: [a] }, 'a1')?.href).toBe('/nexus/mitglieder/k-t');
  expect(draftLink({ ...s, actions: [{ ...a, insightKey: undefined }] }, 'a1')?.href).toBe('/nexus/mitglieder/k-m');
});

test('overdueMembers summiert je Kontakt', () => {
  const arrearsM = memberView(s, 'k-m', TODAY).status.arrearsCents;
  const arrearsT = memberView(s, 'k-t', TODAY).status.arrearsCents;
  expect(arrearsM).toBeGreaterThan(0);
  expect(arrearsT).toBeGreaterThan(0);
  const r = overdueMembers(s, TODAY);
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({ contactId: 'm-x', contractId: 'k-m', arrearsCents: arrearsM + arrearsT });
});

test('Sammelhinweis zählt Kontakte, nicht Verträge', () => {
  const other: Contact = { id: 'm-y', company: 'nexus', kind: 'member', name: 'Max Muster', phones: [], emails: [] };
  const st = stateWith({ contacts: [erika, other], contracts: [kT, kM, { ...kM, id: 'k-y', contactId: 'm-y' }] });
  const all = detectMemberOverdue(st, NOW_0930).find((i) => i.dedupeKey.startsWith('overdue:all:'));
  expect(all?.title.startsWith('2 Mitglieder überfällig')).toBe(true);
});

test('Zahlung über eine Rate: zwei Verträge desselben Kontakts → nie automatisch', () => {
  const both = { ...kT, installmentCents: 30000, totalCents: 180000 };
  const st = stateWith({ contacts: [erika], contracts: [both, kM], ibanLinks: [{ iban: 'DE02120300000000202051', contactId: 'm-x', confirmedAt: NOW_0930.toISOString() }] });
  const r = matchBankPayment(tx({ iban: 'DE02120300000000202051', amountCents: 30000 }), buildMatchContext(st, NOW_0930));
  expect(r.target).toBeNull();
  expect(r.candidates).toHaveLength(2);
});
