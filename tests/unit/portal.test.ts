import { expect, test } from 'vitest';
import { linkPortalMember, portalProposal, portalSummary, portalViews } from '@/domain/portal';
import type { AppState, Contact, PortalMember } from '@/domain/types';
import { inv, stateWith } from './helpers';
import { lexState } from './import/helpers';

const AT = '2026-11-12T08:30:00.000Z';
const pm = (email: string, name: string, lastSeen = AT, p: Partial<PortalMember> = {}): PortalMember =>
  ({ id: `pm-${email}`, connectionId: 'portal_nexus', externalId: email.toLowerCase(), email, name, firstSeenAt: AT, lastSeenInListAt: lastSeen, ...p });
const contact = (p: Partial<Contact> & Pick<Contact, 'id'>): Contact => ({ company: 'nexus', kind: 'member', name: 'X', phones: [], emails: [], ...p });
const contract = (id: string, contactId: string, p = {}) => ({ id, contactId, totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 5, startDate: '2026-10-05', billing: 'legacy' as const, catchUpMode: 'first_rate' as const, ...p });

test('E-Mail-Treffer unabhängig von Groß-/Kleinschreibung, nur Firma nexus', () => {
  const contacts = [contact({ id: 'k1', name: 'Murat Demir', emails: ['Murat@Example.de'] }), contact({ id: 'k2', company: 'zulassung', name: 'X', emails: ['murat@example.de'] })];
  expect(linkPortalMember(pm('murat@example.de', 'Murat Demir'), contacts)).toEqual({ contactIds: ['k1'], nameMatch: null });
});

test('alle E-Mail-Adressen des Mitglieds zählen', () => {
  const contacts = [contact({ id: 'k1', name: 'Q', emails: ['zweit@example.de'] })];
  expect(linkPortalMember(pm('haupt@example.de', 'Anders', AT, { emails: ['haupt@example.de', 'Zweit@Example.de'] }), contacts).contactIds).toEqual(['k1']);
});

test('externalRef schlägt E-Mail', () => {
  const contacts = [
    contact({ id: 'k1', name: 'A', emails: ['a@b.de'] }),
    contact({ id: 'k9', name: 'B', emails: ['andere@b.de'], externalRefs: [{ connectionId: 'portal_nexus', externalId: 'a@b.de' }] }),
  ];
  expect(linkPortalMember(pm('a@b.de', 'A'), contacts)).toEqual({ contactIds: ['k9'], nameMatch: null });
});

test('Namenstreffer nur als Vorschlag: keine Verknüpfung, Status no_invoice', () => {
  const s = { ...stateWith({ contacts: [contact({ id: 'k1', name: 'Paula Neu', emails: ['andere@x.de'] })] }), portalMembers: [pm('neu@example.de', 'Paula Neu')] };
  expect(portalViews(s)[0]).toMatchObject({ status: 'no_invoice', contactIds: [], nameMatch: { contactId: 'k1', name: 'Paula Neu' } });
});

/** Murat (Vertrag), Nina (Lexware-Vorschlag c-83), Sven (nur Workshop-Rechnung), neu, team (ausgeblendet). */
function fiveState(): AppState {
  const murat = lexState.contacts.find((c) => c.emails.some((e) => e.toLowerCase() === 'murat@example.de'))!;
  const noSven = lexState.contacts.filter((c) => !(c.externalRefs ?? []).some((r) => r.externalId === 'c-81'));
  const sven = contact({ id: 'k-sven', name: 'Sven Test', emails: ['sven@example.de'] });
  return {
    ...lexState,
    contacts: [...noSven, sven],
    invoices: [...lexState.invoices.filter((i) => i.contactExternalId !== 'c-81'), inv('i-ws', 14900, { company: 'nexus', connectionId: 'lexware_nexus', contactId: 'k-sven', number: 'RE-1101', issuedOn: '2026-09-10', dueDate: '2026-09-26', status: 'overdue', text: 'Workshop' })],
    contracts: [contract('k-murat', murat.id)],
    portalMembers: [pm('murat@example.de', 'Murat Demir'), pm('nina@example.de', 'Nina Hahn'), pm('sven@example.de', 'Sven Test'), pm('neu@example.de', 'Neu Mitglied'), pm('team@nexusnetzwerk.de', 'Team')],
    ignoredPortalMembers: ['team@nexusnetzwerk.de'],
  };
}

test('alle fünf Status', () => {
  const s = fiveState();
  const views = portalViews(s);
  expect(views.map((v) => [v.member.externalId, v.status])).toEqual([
    ['neu@example.de', 'no_invoice'], ['sven@example.de', 'invoice_only'], ['nina@example.de', 'proposal'], ['murat@example.de', 'contract'], ['team@nexusnetzwerk.de', 'ignored'],
  ]);
  expect(views.find((v) => v.status === 'invoice_only')!.invoices.map((i) => i.number)).toEqual(['RE-1101']);
  expect(views.find((v) => v.status === 'proposal')!.proposalId).toBe('lexware_nexus:c-83');
  expect(views.find((v) => v.status === 'contract')!.contractId).toBe('k-murat');
  expect(portalSummary(views)).toMatchObject({ total: 4, contract: 1, proposal: 1, invoiceOnly: 1, noInvoice: 1, ignored: 1, notInList: 0, listAt: AT });
});

test('Review 3: mehrere E-Mail-Kontakte, Vertrag an irgendeinem zählt', () => {
  const s = { ...stateWith({ contacts: [contact({ id: 'k1', emails: ['a@b.de'] }), contact({ id: 'k2', emails: ['A@b.de'] })], contracts: [contract('v2', 'k2')] }), portalMembers: [pm('a@b.de', 'A')] };
  expect(portalViews(s)[0]).toMatchObject({ status: 'contract', contractId: 'v2', contactIds: ['k1', 'k2'] });
});

test('Vertrag mit origin portal_nexus zählt auch ohne Kontaktverknüpfung', () => {
  const s = { ...stateWith({ contacts: [], contracts: [contract('v1', 'kx', { origin: [{ connectionId: 'portal_nexus', externalId: 'a@b.de' }] })] }), portalMembers: [pm('a@b.de', 'A')] };
  expect(portalViews(s)[0]).toMatchObject({ status: 'contract', contractId: 'v1' });
});

test('ausgeblendet bleibt ausgeblendet, Vertrag hat Vorrang', () => {
  const base = { ...stateWith({ contacts: [contact({ id: 'k1', emails: ['a@b.de'] })] }), portalMembers: [pm('a@b.de', 'A')], ignoredPortalMembers: ['a@b.de'] };
  expect(portalViews(base)[0].status).toBe('ignored');
  expect(portalViews({ ...base, contracts: [contract('v1', 'k1')] })[0].status).toBe('contract');
});

test('Review 2: nicht mehr in Liste → inLatestList false, notInList zählt', () => {
  const s = { ...stateWith({ contacts: [] }), portalMembers: [pm('a@b.de', 'Anna'), pm('b@b.de', 'Bert', '2026-10-01T08:30:00.000Z')] };
  const v = portalViews(s);
  expect(v.map((x) => [x.member.externalId, x.inLatestList])).toEqual([['a@b.de', true], ['b@b.de', false]]);
  expect(portalSummary(v)).toMatchObject({ total: 2, notInList: 1, listAt: AT });
});

test('portalProposal: Rechnungswerte vorbelegt, unvollständig', () => {
  const v = portalViews(fiveState()).find((x) => x.status === 'invoice_only')!;
  expect(portalProposal(v)).toMatchObject({
    id: 'portal_nexus:sven@example.de', sourceLabel: 'Portal', billing: 'legacy', name: 'Sven Test', email: 'sven@example.de', possibleMatch: null,
    sources: [{ connectionId: 'portal_nexus', externalId: 'sven@example.de' }], contactRefs: [{ connectionId: 'portal_nexus', externalId: 'sven@example.de' }],
    installmentCents: 14900, installments: null, totalCents: null, dueDay: 26, startDate: '2026-09-26', complete: false, references: ['Rechnung RE-1101'],
  });
  expect(portalProposal(v).steps.length).toBeGreaterThan(0);
});

test('portalProposal ohne Rechnung: alle Werte null, Portal-Liste', () => {
  const v = portalViews(fiveState()).find((x) => x.status === 'no_invoice')!;
  expect(portalProposal(v)).toMatchObject({ totalCents: null, installments: null, installmentCents: null, dueDay: null, startDate: null, references: ['Portal-Liste'], complete: false });
});

test('ein Kontakt, zwei Portal-Mitglieder: beide zeigen ihn, sharedWith gesetzt, Summe zählt einmal', () => {
  const s = {
    ...stateWith({ contacts: [contact({ id: 'k1', emails: ['x@b.de'] })], contracts: [contract('v1', 'k1')] }),
    portalMembers: [pm('x@b.de', 'Anna'), pm('y@b.de', 'Anna Zweit', AT, { emails: ['y@b.de', 'x@b.de'] })],
  };
  const v = portalViews(s);
  expect(v.map((x) => [x.member.externalId, x.status, x.contactIds, x.sharedWith])).toEqual([
    ['x@b.de', 'contract', ['k1'], ['pm-y@b.de']], ['y@b.de', 'contract', ['k1'], ['pm-x@b.de']],
  ]);
  expect(portalSummary(v)).toMatchObject({ total: 2, contract: 1 });
});

test('Ref-Treffer nur bei Firma nexus', () => {
  const c = contact({ id: 'k1', company: 'zulassung', externalRefs: [{ connectionId: 'portal_nexus', externalId: 'a@b.de' }] });
  expect(linkPortalMember(pm('a@b.de', 'A'), [c]).contactIds).toEqual([]);
});
