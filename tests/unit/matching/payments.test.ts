import { describe, expect, test } from 'vitest';
import { amountFitsContract, classifyBankTx, contactNameMatches, matchBankPayment, nameMatches, normalizeName, referenceHasNumber, type MatchResult } from '@/domain/matching/payments';
import { importKey, mergeImported, upsertImported } from '@/domain/matching/imports';
import { IBAN_KAYA, contacts, ctx, expected, ibanLinks, tx } from '../helpers';

const p1 = tx();
describe('Import', () => {
  test('Schlüssel', () => expect(importKey({ connectionId: 'bank_qonto', externalId: 'x1' })).toBe('bank_qonto:x1'));
  test('erneuter Import ändert nichts', () => expect(mergeImported([p1], [p1, { ...p1 }]).length).toBe(1));
  test('bestehende gewinnen, neue kommen dazu', () => {
    const r = mergeImported([p1], [{ ...p1, amountCents: 1 }, tx({ externalId: 'x2' })]);
    expect(r.map((x) => x.amountCents)).toEqual([30000, 30000]);
    expect(r).toHaveLength(2);
  });
});
const target = (r: MatchResult) => r.target && `${r.target.kind}:${r.target.id}`;

describe('Zuordnung', () => {
  test('hoch: IBAN + nächste Rate', () => expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 30000 }), ctx)).toMatchObject({ target: { kind: 'contract', id: 'k-kaya' }, confidence: 'high' }));
  test('hoch: IBAN + Rückstand', () => expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 15000 }), ctx).confidence).toBe('high'));
  test('mittel: Name + Betrag ohne IBAN', () => expect(matchBankPayment(tx({ iban: 'DE00UNBEKANNT', payerName: 'S. Yilmaz', amountCents: 30000 }), ctx)).toMatchObject({ target: { id: 'k-yilmaz' }, confidence: 'medium' }));
  test('niedrig: Dritter', () => expect(matchBankPayment(tx({ iban: 'DE00X', payerName: 'Firma XY GmbH', amountCents: 90000 }), ctx)).toMatchObject({ target: null, candidates: [], confidence: 'low' }));
  test('Stripe-Auszahlung nie Mitglied', () => expect(matchBankPayment(tx({ payerName: 'Stripe', kind: 'stripe_payout', amountCents: 30000, iban: IBAN_KAYA }), ctx)).toMatchObject({ target: null, confidence: 'low' }));
});
describe('IBAN', () => {
  test.each(['DE89370400440532013000', 'de89 3704 0044 0532 0130 00', 'DE89 3704 0044 0532 0130 00 '])('%s → hoch', (iban) =>
    expect(matchBankPayment(tx({ iban, amountCents: 30000 }), ctx)).toMatchObject({ confidence: 'high', target: { kind: 'contract', id: 'k-kaya' } }));
  test('Link mit Leerzeichen gespeichert', () =>
    expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 30000 }), { ...ctx, ibanLinks: [{ ...ibanLinks[0], iban: 'DE89 3704 0044 0532 0130 00' }] }).confidence).toBe('high'));
  test('gleiche IBAN, anderer Betrag → Vorschlag', () => expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 12345 }), ctx)).toMatchObject({ confidence: 'medium', target: { id: 'k-kaya' } }));
});
describe('Eine IBAN, mehrere Mitglieder', () => {
  const shared = { ...ctx, ibanLinks: [...ibanLinks, { iban: IBAN_KAYA, contactId: 'm-yilmaz', confirmedAt: '2026-10-02T10:00:00Z' }] };
  test('passender Betrag → nie automatisch, Auswahl aus den Zielen beider Mitglieder', () => {
    const r = matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 30000 }), shared);
    expect(r).toMatchObject({ confidence: 'medium', target: null });
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['k-kaya', 'k-yilmaz']);
  });
  test('Betrag passt zu keinem → Vorschlag mit allen Zielen, mittel', () => {
    const r = matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 12345 }), shared);
    expect(r).toMatchObject({ confidence: 'medium', target: null });
    expect(r.candidates).toHaveLength(2);
  });
  test('derselbe Kontakt doppelt verlinkt zählt als einer → weiterhin hoch', () => {
    const dup = { ...ctx, ibanLinks: [...ibanLinks, { ...ibanLinks[0], iban: 'DE89 3704 0044 0532 0130 00' }] };
    expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 30000 }), dup)).toMatchObject({ confidence: 'high', target: { id: 'k-kaya' } });
  });
});
describe('Betrag', () => {
  test.each([[30000, true], [60000, true], [90000, true], [15000, true], [120000, false], [45000, false], [29999, false]])('%i passt: %s', (a, ok) =>
    expect(amountFitsContract(a, expected.get('k-kaya')!)).toBe(ok));
  test.each([0, -30000])('Betrag %i → nie gutgeschrieben', (a) =>
    expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: a }), ctx)).toMatchObject({ confidence: 'low', candidates: [] }));
});
describe('Namen', () => {
  test.each([['Kaya Bau GmbH', 'KAYA BAU'], ['Öztürk & Söhne e.K.', 'Oeztuerk Soehne'], ['Celik und Partner GbR', 'Celik Partner']])('%s ≈ %s', (c, p) =>
    expect(nameMatches(c, p)).toBe(true));
  test('Firma passt auch zum Ansprechpartner', () =>
    expect(contactNameMatches({ ...contacts[0], name: 'Kaya Bau GmbH', contactPersons: ['Mehmet Kaya'] }, 'M. Kaya')).toBe(true));
  test('Firmenname allein bleibt erhalten', () => expect(normalizeName('GmbH')).toBe('gmbh'));
});
describe('Mehrdeutig', () => {
  test('zwei Verträge passen über Name → Auswahl, nie automatisch', () => {
    const r = matchBankPayment(tx({ iban: 'DE00X', payerName: 'Mehmet Kaya', amountCents: 30000 }), { ...ctx, contacts: [...contacts, { ...contacts[0], id: 'm-kaya2' }],
      expected: new Map([...expected, ['k-kaya2', { ...expected.get('k-kaya')!, contactId: 'm-kaya2' }]]) });
    expect(r).toMatchObject({ confidence: 'medium', target: null });
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['k-kaya', 'k-kaya2']);
  });
  test('IBAN-Kontakt mit Vertrag und gleich hoher Rechnung → Auswahl', () => {
    const r = matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 30000 }), { ...ctx, invoices: [{ id: 'i1', number: 'RE-9', contactId: 'm-kaya', openCents: 30000, contractId: null, dueDate: '2026-12-01', totalCents: 30000 }] });
    expect(r).toMatchObject({ confidence: 'medium', target: null });
    expect(r.candidates).toHaveLength(2);
  });
});
describe('Rechnungsnummer', () => {
  const ws = { id: 'i-ws', number: 'RE-1101', contactId: 'm-sven', openCents: 14900, contractId: null, dueDate: '2026-09-26', totalCents: 14900 };
  test('Nummer + Betrag → automatisch auf die Rechnung', () =>
    expect(target(matchBankPayment(tx({ iban: 'DE00X', payerName: 'S. Krüger', reference: 'Rechnung re 1101 Workshop', amountCents: 14900 }), { ...ctx, invoices: [ws] }))).toBe('invoice:i-ws'));
  test('Nummer + Betrag → hoch', () =>
    expect(matchBankPayment(tx({ reference: 'RE-1101', amountCents: 14900 }), { ...ctx, invoices: [ws] }).confidence).toBe('high'));
  test('Teilzahlung → nur Vorschlag', () =>
    expect(matchBankPayment(tx({ reference: 'RE-1101', amountCents: 10000 }), { ...ctx, invoices: [ws] })).toMatchObject({ confidence: 'medium', target: { id: 'i-ws' } }));
  test('abgedeckte Rechnung → Ziel ist der Vertrag', () =>
    expect(matchBankPayment(tx({ reference: 'RE-1101', amountCents: 30000 }), { ...ctx, invoices: [{ ...ws, openCents: 0, contractId: 'k-kaya' }] }))
      .toMatchObject({ confidence: 'high', target: { kind: 'contract', id: 'k-kaya', contactId: 'm-kaya' } }));
  test('doppelte Nummer → Auswahl, nie hoch', () => {
    const r = matchBankPayment(tx({ reference: 'RE-1101', amountCents: 14900 }), { ...ctx, invoices: [ws, { ...ws, id: 'i-ws2' }] });
    expect(r).toMatchObject({ confidence: 'medium', target: null });
    expect(r.candidates).toHaveLength(2);
  });
  test.each([['RE-110', false], ['RE-11012', false], ['xRE-1101', false], ['RE1101', true]])('Verwendungszweck %s passt: %s', (ref, ok) =>
    expect(referenceHasNumber(ref, 'RE-1101')).toBe(ok));
});
describe('Stripe-Auszahlung eng', () => {
  test.each([['Stripe Technologies Europe Ltd', '', 'stripe_payout'], ['STRIPE PAYMENTS UK LTD', 'STRIPE PAYOUT', 'stripe_payout'],
    ['Stripe Technology Inc', '', 'stripe_payout'],
    ['Mehmet Kaya', 'Stripe-Rate November', 'incoming'], ['', 'STRIPE PAYOUT po_1', 'incoming']])('%s / %s → %s', (payerName, reference, kind) =>
    expect(classifyBankTx({ payerName, reference })).toBe(kind));
  test('Name „Stripe“ mit Mitglieds-IBAN → incoming', () =>
    expect(classifyBankTx({ payerName: 'Stripe', iban: 'de89 3704 0044 0532 0130 00' }, new Set([IBAN_KAYA]))).toBe('incoming'));
});

test('upsertImported: bekannter Schlüssel wird gemischt, neuer bekommt ID', () => {
  const ids = ['n1'];
  const r = upsertImported([{ id: 's1', connectionId: 'stripe_nexus' as const, externalId: 'sub_A', v: 1, keep: 'x' as string | null }],
    [{ connectionId: 'stripe_nexus' as const, externalId: 'sub_A', v: 2 }, { connectionId: 'stripe_nexus' as const, externalId: 'sub_B', v: 1 }],
    (next, old) => ({ ...next, keep: old?.keep ?? null }), () => ids.shift()!);
  expect(r.items).toEqual([{ id: 's1', connectionId: 'stripe_nexus', externalId: 'sub_A', v: 2, keep: 'x' }, { id: 'n1', connectionId: 'stripe_nexus', externalId: 'sub_B', v: 1, keep: null }]);
  expect(r.added).toBe(1);
});
