import { expect, test } from 'vitest';
import { emptyBatch, type ImportBatch } from '@/domain/import/batch';
import { mergeBatch } from '@/domain/import/merge';
import { mapLexwareContacts, mapLexwareInvoice } from '@/domain/import/lexware';
import { mapQonto } from '@/domain/import/qonto';
import { lexContacts, lexInvoices, qontoTransactions } from '../../fixtures';
import { confirmedSub, emptyState, seq, stripeBatch } from './helpers';

const empty = emptyState();
const lexInv = lexInvoices('nexus').map((d) => mapLexwareInvoice(d, 'lexware_nexus'));
const lexContactsNexus = mapLexwareContacts(lexContacts('nexus'), 'lexware_nexus');
const changed = (b: ImportBatch, id: string, patch: object): ImportBatch => ({ ...b, subscriptions: b.subscriptions.map((x) => (x.externalId === id ? { ...x, ...patch } : x)) });

test('erneuter Import ist idempotent', () => {
  const once = mergeBatch(empty, stripeBatch, seq()).state;
  const twice = mergeBatch(once, stripeBatch, seq());
  expect(twice.state).toEqual(once);
  expect(twice.added).toEqual({ contacts: 0, invoices: 0, payments: 0, subscriptions: 0 });
});
test('geändertes Abo: Felder neu, contractId und Bestätigungswerte bleiben', () => {
  const s = confirmedSub(mergeBatch(empty, stripeBatch, seq()).state, 'sub_A', 'k1');
  const confirmed = s.subscriptions.find((x) => x.externalId === 'sub_A')!.confirmedPriceCents;
  expect(confirmed).not.toBeNull();
  const r = mergeBatch(s, changed(stripeBatch, 'sub_A', { status: 'canceled', priceCents: 35000 }), seq()).state;
  expect(r.subscriptions.find((x) => x.externalId === 'sub_A')).toMatchObject({ status: 'canceled', priceCents: 35000, contractId: 'k1', confirmedPriceCents: confirmed });
  expect(r.contracts).toEqual(s.contracts);
});
test('Rechnung vor Kontakt: contactId wird beim späteren Kontakt-Import nachgezogen', () => {
  const a = mergeBatch(empty, { ...emptyBatch(), invoices: lexInv }, seq()).state;
  expect(a.invoices.every((i) => i.contactId === null)).toBe(true);
  const b = mergeBatch(a, { ...emptyBatch(), contacts: lexContactsNexus }, seq()).state;
  expect(b.invoices.find((i) => i.number === 'RE-1043')!.contactId).toBe(b.contacts.find((c) => c.name === 'Murat Demir')!.id);
});
test('Streitfall landet am Abo', () => expect(mergeBatch(empty, stripeBatch, seq()).state.subscriptions.find((x) => x.externalId === 'sub_A')!.disputes).toEqual(['dp_1']));
test('Teil-Batch ohne Rechnungen: amountCents bleibt (F7)', () => {
  const s = mergeBatch(empty, stripeBatch, seq()).state;
  const before = s.subscriptions.find((x) => x.externalId === 'sub_A')!.amountCents;
  expect(before).not.toBeNull();
  const r = mergeBatch(s, changed(stripeBatch, 'sub_A', { amountCents: null }), seq()).state;
  expect(r.subscriptions.find((x) => x.externalId === 'sub_A')!.amountCents).toBe(before);
});
test('lokal erledigte Lexware-Rechnung bleibt erledigt, außer Lexware meldet bezahlt/storniert (F7)', () => {
  const a = mergeBatch(empty, { ...emptyBatch(), invoices: lexInv }, seq()).state;
  const open = a.invoices.find((i) => i.number === 'RE-1043')!;
  const settled = { ...a, invoices: a.invoices.map((i) => (i.id === open.id ? { ...i, status: 'paid' as const, openCents: 0, settledByPaymentId: 'p1' } : i)) };
  const again = mergeBatch(settled, { ...emptyBatch(), invoices: lexInv.map((i) => ({ ...i, status: 'open' as const, openCents: i.totalCents })) }, seq()).state;
  expect(again.invoices.find((i) => i.id === open.id)).toMatchObject({ status: 'paid', openCents: 0, settledByPaymentId: 'p1' });
  const voided = mergeBatch(settled, { ...emptyBatch(), invoices: lexInv.map((i) => ({ ...i, status: 'void' as const, openCents: 0 })) }, seq()).state;
  expect(voided.invoices.find((i) => i.id === open.id)).toMatchObject({ status: 'void', settledByPaymentId: 'p1' });
});

// --- Qonto ---
const qb = mapQonto(qontoTransactions.transactions);
const memberLink = (iban: string) => ({ iban, contactId: 'c1', confirmedAt: '2026-10-01' });
test('Rückbuchung mit Original → refundOf; ohne Original → verworfen', () => {
  const s = mergeBatch(empty, qb, seq()).state;
  expect(s.payments.find((p) => p.externalId === 't-return')?.refundOf).toBe('t-demir-1');
  const alone = mergeBatch(empty, { ...emptyBatch(), payments: qb.payments.filter((p) => p.externalId === 't-return') }, seq()).state;
  expect(alone.payments).toHaveLength(0);
});
test('Review 3: erneuter Import hält ignoredAt und erzeugt nichts doppelt', () => {
  const s1 = mergeBatch(empty, qb, seq()).state;
  const hidden = { ...s1, payments: s1.payments.map((p) => (p.externalId === 't-demir-1' ? { ...p, ignoredAt: 'x' } : p)) };
  const s2 = mergeBatch(hidden, qb, seq()).state;
  expect(s2.payments).toHaveLength(s1.payments.length);
  expect(s2.payments.find((p) => p.externalId === 't-demir-1')?.ignoredAt).toBe('x');
  expect(s2.payments.find((p) => p.externalId === 't-return')?.refundOf).toBe('t-demir-1');
});
test('Name „Stripe“ mit Mitglieds-IBAN → incoming', () => {
  const stripeLike = { ...qb.payments.find((p) => p.externalId === 't-stripe')!, iban: 'DE44500105175407324931', kind: 'stripe_payout' as const };
  const s = { ...empty, ibanLinks: [memberLink('DE44 5001 0517 5407 3249 31')] };
  expect(mergeBatch(s, { ...emptyBatch(), payments: [stripeLike] }, seq()).state.payments[0].kind).toBe('incoming');
  expect(mergeBatch(empty, { ...emptyBatch(), payments: [stripeLike] }, seq()).state.payments[0].kind).toBe('stripe_payout');
});
test('Kontaktpersonen werden bei bekanntem Kontakt nachgezogen', () => {
  const firma = lexContactsNexus.find((c) => c.name === 'Fahrschule Beispiel GmbH')!;
  const { contactPersons, ...without } = firma;
  expect(contactPersons).toEqual(['Anna Beispiel']);
  const a = mergeBatch(empty, { ...emptyBatch(), contacts: [without] }, seq()).state;
  const id = a.contacts[0].id;
  expect(a.contacts[0].contactPersons).toBeUndefined();
  const r = mergeBatch(a, { ...emptyBatch(), contacts: [firma] }, seq());
  expect(r.state.contacts).toHaveLength(1);
  expect(r.state.contacts[0]).toMatchObject({ id, contactPersons: ['Anna Beispiel'] });
  expect(r.added.contacts).toBe(0);
});
