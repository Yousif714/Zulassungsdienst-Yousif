import { expect, test } from 'vitest';
import { emptyBatch, type ImportBatch } from '@/domain/import/batch';
import { mapLexwareContacts, mapLexwareInvoice, mapLexwareOrderConfirmation } from '@/domain/import/lexware';
import { mapStripe } from '@/domain/import/stripe';
import { mergeBatch } from '@/domain/import/merge';
import { deriveProposals, findContactFor, MONTH_END, proposalId } from '@/domain/import/proposals';
import { readingProposalId } from '@/domain/import/invoice-reading';
import { member, stateWith } from '../helpers';
import { okResult, readInv, reading } from './reading-fixtures';
import { normalizeName, normalizeNameStrict, nameMatches } from '@/domain/matching/payments';
import type { AppState, Contact, Invoice } from '@/domain/types';
import { lexContacts, lexInvoices, lexOrderConfirmation, stripeRaw } from '../../fixtures';
import { confirmedSub, emptyState, lexState, patchSub, seq, stripeState, withContract } from './helpers';

const P = (s: AppState, id: string) => deriveProposals(s).find((p) => p.id === id);
const mk = (id: string, name: string): Contact => ({ id, company: 'nexus', kind: 'member', name, phones: [], emails: [] });

const withText = (s: AppState, number: string, text: string): AppState => ({
  ...s, invoices: s.invoices.map((i) => (i.number === number ? { ...i, text } : i)),
});
const lexContact = (id: string, name: string, email: string | null) => ({
  id, name, kind: 'member' as const, company: 'nexus' as const, phones: [], emails: email ? [email] : [],
  externalRefs: [{ connectionId: 'lexware_nexus' as const, externalId: id }],
});
const memberInvoice = (contactExternalId: string, number: string): Omit<Invoice, 'id' | 'contactId'> => ({
  company: 'nexus', source: 'lexware', connectionId: 'lexware_nexus', externalId: `lx-${number}`, number, contactExternalId,
  totalCents: 60000, openCents: 60000, issuedOn: '2026-10-05', dueDate: '2026-10-19', status: 'open', text: 'Rechnung\nNEXUS-Mitgliedschaft 6 Monate, fällig jeweils zum 5. des Monats',
});
/** Stripe-Zustand plus Lexware-Kontakt mit Mitgliedschaftsrechnung. */
const mergedWithLexContact = (s: AppState, c: { id: string; name: string; email: string | null }): AppState =>
  mergeBatch(s, { ...emptyBatch(), contacts: [lexContact(c.id, c.name, c.email)], invoices: [memberInvoice(c.id, `RE-${c.id}`)] } as ImportBatch, seq()).state;
const mergedWithStripeSub = (s: AppState, o: { externalId: string; customerEmail: string }): AppState => {
  const base = mapStripe(stripeRaw).subscriptions.find((x) => x.externalId === 'sub_A')!;
  return mergeBatch(s, { ...emptyBatch(), subscriptions: [{ ...base, ...o, stripeCustomerId: 'cus_M', customerName: 'Murat Demir' }] }, seq()).state;
};
const zulassungState = mergeBatch(emptyState(), {
  ...emptyBatch(),
  contacts: mapLexwareContacts(lexContacts('zulassung'), 'lexware_zulassung'),
  invoices: lexInvoices('zulassung').map((d) => mapLexwareInvoice(d, 'lexware_zulassung')),
}, seq()).state;

test('Stripe-Abo mit Enddatum, vollständig', () => expect(P(stripeState, 'stripe_nexus:sub_A')).toMatchObject({
  name: 'Ayşe Öztürk', totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-09-01',
  billing: 'stripe', sourceLabel: 'Stripe', complete: true, references: ['Abo sub_A'], contactRefs: [{ connectionId: 'stripe_nexus', externalId: 'cus_A' }] }));
test('Abo ohne Enddatum, USD oder gekündigt → bitte ergänzen', () => {
  expect(P(stripeState, 'stripe_nexus:sub_E')).toMatchObject({ installments: null, totalCents: null, complete: false });
  expect(P(stripeState, 'stripe_nexus:sub_F')!.complete).toBe(false);
  expect(P(stripeState, 'stripe_nexus:sub_C')!.complete).toBe(false);
});
test('kein Vorschlag ohne Mitgliedschaft', () => expect(P(stripeState, 'stripe_nexus:sub_D')).toBeUndefined());
test('F11: Mitgliedschaft auch über erste Rechnungszeile erkannt', () => {
  const s = patchSub(stripeState, 'sub_D', { invoiceLineText: 'NEXUS-Mitgliedschaft 3 Monate' });
  expect(P(s, 'stripe_nexus:sub_D')).toBeDefined();
});
test('F11: Mapper liefert die erste Rechnungszeile', () => {
  expect(stripeState.subscriptions.find((x) => x.externalId === 'sub_A')!.invoiceLineText).toBe('NEXUS-Mitgliedschaft 4 Monate');
});
test('unvollständiges Abo (incomplete) erzeugt keinen Vorschlag', () => expect(P(patchSub(stripeState, 'sub_A', { status: 'incomplete' }), 'stripe_nexus:sub_A')).toBeUndefined());
test('Lexware-Ratenrechnungen', () => expect(P(lexState, 'lexware_nexus:c-77')).toMatchObject({
  installmentCents: 30000, installments: 6, totalCents: 180000, startDate: '2026-09-01', dueDay: 1, billing: 'legacy', complete: true,
  references: ['Rechnung RE-1043', 'Rechnung RE-1051', 'Rechnung RE-1060'] }));
test('Lexware-Gesamtrechnung mit Tag im Text', () => expect(P(lexState, 'lexware_nexus:c-81')).toMatchObject({ totalCents: 120000, installments: 12, installmentCents: 10000, dueDay: 15, startDate: '2026-09-15', complete: true }));
test('Gesamtrechnung ohne Tag → fällig zum Monatsende (31 = letzter Tag), Start = Rechnungsdatum, vollständig', () => expect(P(withText(lexState, 'RE-1100', 'NEXUS-Mitgliedschaft 12 Monate'), 'lexware_nexus:c-81')).toMatchObject({ dueDay: 31, startDate: '2026-09-10', complete: true }));
test('c-83: Gesamtrechnung ohne Tag', () => expect(P(lexState, 'lexware_nexus:c-83')).toMatchObject({ totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 31, startDate: '2026-10-05', complete: true }));
test('Tag vor Rechnungstag → Folgemonat', () => expect(P(withText(lexState, 'RE-1100', 'NEXUS-Mitgliedschaft 12 Monate, fällig jeweils zum 5. des Monats'), 'lexware_nexus:c-81')!.startDate).toBe('2026-10-05'));
test('kein Ratenmuster → alle Werte null', () => {
  const s = mergeBatch(lexState, { ...emptyBatch(), invoices: [{ ...memberInvoice('c-77', 'RE-9'), totalCents: 11100, issuedOn: '2026-11-20' }] }, seq()).state;
  const s2 = { ...s, invoices: s.invoices.filter((i) => i.number !== 'RE-1051') }; // Lücke: 2 Rechnungen, 61 Tage
  expect(P(s2, 'lexware_nexus:c-77')).toMatchObject({ totalCents: null, installments: null, installmentCents: null, dueDay: null, startDate: null, complete: false });
  expect(P(s2, 'lexware_nexus:c-77')!.steps.join(' ')).toMatch(/passen zu keinem Ratenmuster/);
});
test('Storno und Workshop zählen nicht', () => {
  expect(P(lexState, 'lexware_nexus:c-82')).toBeUndefined();
  expect(P(lexState, 'lexware_nexus:c-81')!.references).toEqual(['Rechnung RE-1100']);
});
test('Lexware Zulassung erzeugt nie Vorschläge', () => expect(deriveProposals(zulassungState)).toEqual([]));
test('gleiche E-Mail → ein Vorschlag mit beiden Quellen', () => {
  const s = mergedWithLexContact(stripeState, { id: 'c-90', name: 'Ayse Oeztuerk', email: 'AYSE@example.de' });
  const p = deriveProposals(s).filter((x) => x.sources.some((r) => r.externalId === 'sub_A'));
  expect(p).toHaveLength(1);
  expect(p[0]).toMatchObject({ id: 'lexware_nexus:c-90+stripe_nexus:sub_A', sourceLabel: 'Stripe + Lexware', billing: 'stripe', installmentCents: 30000 });
  expect(p[0].contactRefs).toHaveLength(2);
});
test('gleicher normalisierter Name (Titel, Akzente) → zusammengeführt', () => {
  const s = mergedWithLexContact(stripeState, { id: 'c-92', name: 'Dr. Ayse Öztürk', email: null });
  expect(P(s, 'lexware_nexus:c-92+stripe_nexus:sub_A')).toBeDefined();
});
test('unsicherer Namenstreffer → zwei Vorschläge mit Hinweis', () => {
  const s = mergedWithLexContact(stripeState, { id: 'c-91', name: 'A. Öztürk', email: null });
  expect(P(s, 'lexware_nexus:c-91')!.possibleMatch).toEqual({ id: 'stripe_nexus:sub_A', name: 'Ayşe Öztürk' });
  expect(P(s, 'stripe_nexus:sub_A')!.possibleMatch).toEqual({ id: 'lexware_nexus:c-91', name: 'A. Öztürk' });
});
test('verworfen bleibt verworfen, neue Quelle ergibt neue ID', () => {
  const s = { ...lexState, dismissedProposals: ['lexware_nexus:c-77'] };
  expect(P(s, 'lexware_nexus:c-77')).toBeUndefined();
  const withSub = mergedWithStripeSub(s, { externalId: 'sub_M', customerEmail: 'murat@example.de' });
  expect(P(withSub, 'lexware_nexus:c-77+stripe_nexus:sub_M')).toBeDefined();
});
test('bestätigt: keine erneuten Vorschläge, auch nicht nach neuer Ratenrechnung', () => {
  const s = withContract(lexState, { origin: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] });
  const next = mergeBatch(s, { ...emptyBatch(), invoices: [{ ...memberInvoice('c-77', 'RE-1070'), totalCents: 30000, issuedOn: '2026-12-01' }] }, seq()).state;
  expect(deriveProposals(next).some((p) => p.sources.some((r) => r.externalId === 'c-77'))).toBe(false);
});
test('bestätigtes Abo (contractId) fällt weg', () => expect(P(confirmedSub(stripeState, 'sub_A', 'k-1'), 'stripe_nexus:sub_A')).toBeUndefined());
test('Rechenweg nennt Quelle und Rechnung', () => expect(P(lexState, 'lexware_nexus:c-77')!.steps.join(' ')).toMatch(/3 Rechnungen.*300,00 €.*6 Monate/));
test('Ergebnis nach Name sortiert', () => {
  const names = deriveProposals(lexState).map((p) => p.name);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')));
});
test('proposalId sortiert', () => expect(proposalId([{ connectionId: 'stripe_nexus', externalId: 'sub_A' }, { connectionId: 'lexware_nexus', externalId: 'c-9' }])).toBe('lexware_nexus:c-9+stripe_nexus:sub_A'));
test('findContactFor: Ref vor E-Mail vor Name', () => {
  const p = P(stripeState, 'stripe_nexus:sub_A')!;
  expect(findContactFor(p, [{ ...mk('x', 'Ayşe Öztürk'), externalRefs: [{ connectionId: 'stripe_nexus', externalId: 'cus_A' }] }, { ...mk('y', 'Andere'), emails: ['ayse@example.de'] }])).toEqual({ match: 'ref', contactId: 'x', name: 'Ayşe Öztürk' });
  expect(findContactFor(p, [{ ...mk('y', 'Andere'), emails: ['AYSE@example.de'] }]).match).toBe('email');
  expect(findContactFor(p, [mk('z', 'Ayşe Öztürk')]).match).toBe('name');
  expect(findContactFor(p, []).match).toBe('none');
});
test('findContactFor: Zulassungs-Kontakte werden nie wiederverwendet', () => {
  const p = P(stripeState, 'stripe_nexus:sub_A')!;
  const z = (c: Partial<Contact>): Contact => ({ ...mk('z1', 'Ayşe Öztürk'), company: 'zulassung', ...c });
  expect(findContactFor(p, [z({ emails: ['ayse@example.de'] })]).match).toBe('none');
  expect(findContactFor(p, [z({ externalRefs: [{ connectionId: 'stripe_nexus', externalId: 'cus_A' }] })]).match).toBe('none');
  expect(findContactFor(p, [z({})]).match).toBe('none');
});
test('normalizeName: türkische Buchstaben, NFD, Titel', () => {
  expect(normalizeName('Ayşe Öztürk')).toBe('ayse oeztuerk');
  expect(normalizeName('Ayşe Öztürk'.normalize('NFD'))).toBe('ayse oeztuerk');
  expect(normalizeName('Çelik, Dr. Hakan')).toBe('celik hakan');
  expect(normalizeName('Müller')).toBe('mueller');
  expect(nameMatches('Hakan Çelik', 'H. Celik')).toBe(true);
  expect(normalizeName('Kaya Bau GmbH')).toBe('kaya bau');
  expect(normalizeName('Öztürk & Söhne e.K.')).toBe('oeztuerk soehne');
  expect(normalizeName('Celik und Partner GbR')).toBe('celik partner');
});

test('leere Namen werden nie zusammengeführt', () => {
  const s0 = patchSub(stripeState, 'sub_A', { customerName: '', customerEmail: null });
  const s = mergedWithLexContact(s0, { id: 'c-93', name: '', email: null });
  expect(deriveProposals(s).filter((p) => p.sources.length > 1)).toEqual([]);
  expect(P(s, 'lexware_nexus:c-93')!.possibleMatch).toBeNull();
  expect(findContactFor(P(s, 'stripe_nexus:sub_A')!, [mk('z', '')]).match).toBe('none');
});
test('Hinweis zeigt nicht auf verworfenen Vorschlag', () => {
  const s = { ...mergedWithLexContact(stripeState, { id: 'c-91', name: 'A. Öztürk', email: null }), dismissedProposals: ['lexware_nexus:c-91'] };
  expect(P(s, 'lexware_nexus:c-91')).toBeUndefined();
  expect(P(s, 'stripe_nexus:sub_A')!.possibleMatch).toBeNull();
});
test('Firmenzusätze: „Müller GmbH“ und „Müller UG“ werden nicht zusammengeführt, Kontakt „Müller“ nicht wiederverwendet', () => {
  const s = mergedWithLexContact(stripeState, { id: 'c-94', name: 'Ayşe Öztürk GmbH', email: null });
  expect(P(s, 'stripe_nexus:sub_A')!.sourceLabel).toBe('Stripe');
  expect(P(s, 'lexware_nexus:c-94')).toBeDefined();
  const p = { ...P(stripeState, 'stripe_nexus:sub_A')!, name: 'Müller GmbH', email: null, contactRefs: [] };
  expect(findContactFor(p, [mk('a', 'Müller'), mk('b', 'Müller UG')]).match).toBe('none');
  expect(findContactFor(p, [mk('a', 'Müller GmbH')]).match).toBe('name');
  expect(normalizeNameStrict('Müller GmbH')).toBe('mueller gmbh');
  expect(normalizeNameStrict('Dr. Ayşe Öztürk')).toBe('ayse oeztuerk');
});

// Auftragsbestätigungen (AB): Quelle wie eine Mitgliedschafts-Rechnung, die Rechnung gewinnt je Kontakt.
const abs = ['AB-2001', 'AB-2002', 'AB-2003'].map((n) => mapLexwareOrderConfirmation(lexOrderConfirmation(n), 'lexware_nexus'));
const abState = mergeBatch(lexState, { ...emptyBatch(), orderConfirmations: abs }, seq()).state;

test('AB mit Mitgliedschaft und Laufzeit → Vorschlag „Lexware (AB)“, zum Monatsende, Referenz Auftragsbestätigung', () => {
  expect(P(abState, 'lexware_nexus:c-84')).toMatchObject({
    name: 'Tom Beispiel', email: 'tom@example.de', billing: 'legacy', sourceLabel: 'Lexware (AB)',
    totalCents: 120000, installments: 12, installmentCents: 10000, dueDay: MONTH_END, startDate: '2026-07-03',
    references: ['Auftragsbestätigung AB-2001'], complete: true,
    sources: [{ connectionId: 'lexware_nexus', externalId: 'c-84' }],
  });
  expect(P(abState, 'lexware_nexus:c-84')!.steps.join(' ')).toContain('Auftragsbestätigung AB-2001');
});
test('AB ohne Mitgliedschaftstext → kein Vorschlag; stornierte AB → kein Vorschlag; Zulassung-AB → kein Vorschlag', () => {
  expect(P(abState, 'lexware_nexus:c-85')).toBeUndefined();
  const voided = { ...abState, orderConfirmations: abState.orderConfirmations.map((x) => ({ ...x, status: 'void' as const })) };
  expect(P(voided, 'lexware_nexus:c-84')).toBeUndefined();
  const zul = { ...abState, orderConfirmations: abState.orderConfirmations.map((x) => ({ ...x, connectionId: 'lexware_zulassung' as const, company: 'zulassung' as const })) };
  expect(P(zul, 'lexware_nexus:c-84')).toBeUndefined();
});
test('AB mit Mitgliedschaft, aber ohne Laufzeit → kein Vorschlag', () => {
  const noMonths = { ...abState, orderConfirmations: abState.orderConfirmations.map((x) => (x.number === 'AB-2001' ? { ...x, text: 'NEXUS-Mitgliedschaft' } : x)) };
  expect(P(noMonths, 'lexware_nexus:c-84')).toBeUndefined();
});
test('Rechnung schlägt AB: derselbe Kontakt hat Mitgliedschafts-Rechnungen → Werte und Quelle aus den Rechnungen', () => {
  const withAb = P(abState, 'lexware_nexus:c-77')!;
  expect(withAb).toEqual(P(lexState, 'lexware_nexus:c-77'));
  expect(withAb.sourceLabel).toBe('Lexware');
  expect(withAb.references.join()).not.toContain('AB-2003');
  expect(deriveProposals(abState).filter((p) => p.id.includes('c-77'))).toHaveLength(1);
});
test('mehrere Mitgliedschafts-ABs eines Kontakts → ein Vorschlag aus der neuesten', () => {
  const older = { ...abs[0], externalId: 'oc-alt', number: 'AB-1999', issuedOn: '2026-06-10', totalCents: 60000, text: 'Mitgliedschaft 6 Monate' };
  const s = mergeBatch(abState, { ...emptyBatch(), orderConfirmations: [older] }, seq()).state;
  const p = deriveProposals(s).filter((x) => x.id === 'lexware_nexus:c-84');
  expect(p).toHaveLength(1);
  expect(p[0]).toMatchObject({ references: ['Auftragsbestätigung AB-2001'], totalCents: 120000 });
});
test('AB-Vorschlag mit Fälligkeitstag im Text: Start im Folgemonat wie bei der Gesamtrechnung', () => {
  const s = { ...abState, orderConfirmations: abState.orderConfirmations.map((x) => (x.number === 'AB-2001' ? { ...x, text: 'Mitgliedschaft 12 Monate, fällig jeweils zum 1. des Monats' } : x)) };
  expect(P(s, 'lexware_nexus:c-84')).toMatchObject({ dueDay: 1, startDate: '2026-08-01' });
});

const withLexContact = (s: AppState): AppState => ({ ...s, contacts: [...s.contacts.filter((c) => c.id !== 'm-x'),
  { id: 'm-x', company: 'nexus', kind: 'member', name: 'Erika Beispiel', phones: [], emails: ['erika@example.de'], externalRefs: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] }] });

test('Lesung mit outcome proposal → Vorschlag „Lexware (Claude)“ mit Zitat und Rechenweg', () => {
  const i = readInv();
  const s = withLexContact(stateWith({ invoices: [i], invoiceReadings: [reading({ outcome: 'proposal', result: okResult({ certain: false, note: 'Anzahl unklar' }) })] }));
  const p = deriveProposals(s).find((x) => x.id === readingProposalId(i))!;
  expect(p).toMatchObject({ sourceLabel: 'Lexware (Claude)', references: ['Rechnung RE-9001'], billing: 'legacy', name: 'Erika Beispiel', email: 'erika@example.de',
    contactRefs: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }], complete: true,
    reading: { invoiceId: 'i-r1', invoiceNumber: 'RE-9001', kind: 'ticket', quote: 'zahlbar in 6 Monatsraten à 100,00 €', note: 'Anzahl unklar' } });
  expect(p.steps).toContain('Claude ist unsicher: Anzahl unklar');
});

test('verworfen bleibt verworfen; none- und applied-Lesungen erzeugen keinen Vorschlag', () => {
  const i = readInv();
  const prop = reading({ outcome: 'proposal', result: okResult({ certain: false }) });
  expect(deriveProposals(withLexContact(stateWith({ invoices: [i], invoiceReadings: [prop], dismissedProposals: [readingProposalId(i)] })))).toEqual([]);
  expect(deriveProposals(withLexContact(stateWith({ invoices: [i], invoiceReadings: [reading({ outcome: 'none' })] })))).toEqual([]);
  expect(deriveProposals(withLexContact(stateWith({ invoices: [i], invoiceReadings: [reading({ outcome: 'applied' })] })))).toEqual([]);
  expect(deriveProposals(withLexContact(stateWith({ invoices: [{ ...i, sourceUpdatedAt: '2026-11-01T00:00:00Z' }], invoiceReadings: [prop] })))).toEqual([]);
});

test('Review 1: Mitgliedsrechnung, die schon im Textsuche-Vorschlag steht → nur der Textsuche-Vorschlag', () => {
  const m = { ...member('i-m1'), externalId: 'lex-m1', sourceUpdatedAt: '2026-10-01T08:00:00Z' };
  const s = withLexContact(stateWith({ invoices: [m], invoiceReadings: [reading({ invoiceId: 'i-m1', outcome: 'proposal', result: okResult({ kind: 'membership' }) })] }));
  expect(deriveProposals(s).map((p) => p.sourceLabel)).toEqual(['Lexware']);
});
