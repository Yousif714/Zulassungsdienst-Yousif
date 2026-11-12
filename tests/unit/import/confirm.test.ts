import { expect, test } from 'vitest';
import { applyEvent, applyEvents, type EngineContext } from '@/data/engine';
import { memberView } from '@/domain/detectors';
import { validateContractDraft, type ContractDraft } from '@/domain/import/contract-draft';
import { deriveProposals } from '@/domain/import/proposals';
import type { AppState, Contact } from '@/domain/types';
import { NOW_0930 } from '../helpers';
import { lexState, seq, stripeState } from './helpers';

const ctx = (p: Partial<EngineContext> = {}): EngineContext => ({ at: NOW_0930, isDemo: false, newId: seq(), ...p });
const draftA: ContractDraft = { totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-09-01', catchUpMode: 'first_rate' };
const draftMurat: ContractDraft = { totalCents: 180000, installments: 6, installmentCents: 30000, dueDay: 1, startDate: '2026-09-01', catchUpMode: 'first_rate' };
const withContact = (s: AppState, c: Partial<Contact> & { id: string; name: string }): AppState => ({
  ...s, contacts: [...s.contacts, { company: 'nexus', kind: 'member', phones: [], emails: [], ...c }],
});

test('validateContractDraft', () => {
  expect(validateContractDraft(draftA)).toEqual([]);
  expect(validateContractDraft({ ...draftA, totalCents: 50000 })).toContain('Die letzte Rate wäre negativ.');
  expect(validateContractDraft({ ...draftA, dueDay: 32 })).toContain('Fälligkeitstag muss zwischen 1 und 31 liegen.');
  expect(validateContractDraft({ ...draftA, installments: 0 })).not.toEqual([]);
  expect(validateContractDraft({ ...draftA, installmentCents: 10.5 })).not.toEqual([]);
  expect(validateContractDraft({ ...draftA, startDate: '2026-02-30' })).not.toEqual([]);
});

test('Übernehmen legt Vertrag mit origin an, ordnet rückwirkend zu, Rückstand aus dem Ledger', () => {
  const r = applyEvent(stripeState, { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: null }, ctx({ isDemo: false }));
  const k = r.state.contracts.find((c) => c.id === r.created[0])!;
  expect(k).toMatchObject({ billing: 'stripe', origin: [{ connectionId: 'stripe_nexus', externalId: 'sub_A' }], installments: 4 });
  expect(r.state.subscriptions.find((x) => x.externalId === 'sub_A')).toMatchObject({ contractId: k.id, confirmedPriceCents: 30000, confirmedEndDate: '2027-01-01' });
  expect(r.state.allocations.filter((a) => a.contractId === k.id).map((a) => a.amountCents)).toEqual([30000, 30000, 30000]);
  expect(memberView(r.state, k.id, '2026-11-12').status.arrearsCents).toBe(0);
  expect(r.state.contacts.find((c) => c.id === k.contactId)).toMatchObject({ name: 'Ayşe Öztürk', emails: ['ayse@example.de'], externalRefs: [{ connectionId: 'stripe_nexus', externalId: 'cus_A' }] });
});

test('zweimal übernehmen → genau ein Vertrag', () => {
  const e = { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: null } as const;
  const r = applyEvents(stripeState, [e, e], ctx());
  expect(r.state.contracts).toHaveLength(1);
  expect(r.state.audit.at(-1)!.text).toBe('Vorschlag nicht mehr offen');
});

test('Kontakt-Wiederverwendung: Ref, E-Mail; Name nur mit Ja', () => {
  const lex = applyEvent(lexState, { type: 'confirmProposal', proposalId: 'lexware_nexus:c-77', draft: draftMurat, contactId: null }, ctx()).state;
  expect(lex.contacts.filter((c) => c.name === 'Murat Demir')).toHaveLength(1);
  const byName = withContact(stripeState, { id: 'old', name: 'Ayşe Öztürk', emails: [] });
  const nein = applyEvent(byName, { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: null }, ctx()).state;
  expect(nein.contracts[0].contactId).not.toBe('old');
  const ja = applyEvent(byName, { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: 'old' }, ctx()).state;
  expect(ja.contracts[0].contactId).toBe('old');
  expect(ja.contacts.find((c) => c.id === 'old')!.externalRefs).toEqual([{ connectionId: 'stripe_nexus', externalId: 'cus_A' }]);
  const byMail = withContact(stripeState, { id: 'mail', name: 'Anderer Name', emails: ['AYSE@example.de'] });
  expect(applyEvent(byMail, { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: null }, ctx()).state.contracts[0].contactId).toBe('mail');
});

test('fremde contactId wird ignoriert', () => {
  const r = applyEvent(withContact(stripeState, { id: 'x', name: 'Jemand' }), { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: 'x' }, ctx()).state;
  expect(r.contracts[0].contactId).not.toBe('x');
});

test('ungültiger Entwurf → nichts angelegt', () => {
  const s = applyEvent(stripeState, { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: { ...draftA, totalCents: 1 }, contactId: null }, ctx()).state;
  expect(s.contracts).toEqual([]);
  expect(s.audit.at(-1)!.text).toMatch(/^Vertrag nicht angelegt: /);
});

test('Verwerfen merkt die ID, Vorschlag weg', () => {
  const r = applyEvent(stripeState, { type: 'dismissProposal', proposalId: 'stripe_nexus:sub_A' }, ctx()).state;
  expect(r.dismissedProposals).toEqual(['stripe_nexus:sub_A']);
  expect(deriveProposals(r).some((p) => p.id === 'stripe_nexus:sub_A')).toBe(false);
  const again = applyEvent(r, { type: 'dismissProposal', proposalId: 'stripe_nexus:sub_A' }, ctx()).state;
  expect(again.dismissedProposals).toHaveLength(1);
});
