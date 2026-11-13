import { describe, expect, test } from 'vitest';
import { applyEvent, refresh } from '@/data/engine';
import { matchOptions, unallocatedBankPayments } from '@/data/selectors';
import { PAID_LOOKBACK_DAYS, buildMatchContext, detectUnmatchedPayments } from '@/domain/detectors/payments';
import { invoiceOpenCents, paymentRestCents } from '@/domain/ledger/receivables';
import type { StoreEvent } from '@/domain/events';
import { matchBankPayment } from '@/domain/matching/payments';
import { IBAN_KAYA, IBAN_MUELLER, NOW_0930, base, ibanLinks, inv, sptx, stateWith, tx, workshop } from '../helpers';

const z1 = inv('i-z1', 39000, { number: 'RE-Z-2026-290', dueDate: '2026-10-20' });
const muellerLink = { iban: IBAN_MUELLER, contactId: 'd-mueller', confirmedAt: 'x' };
const apply = (s: ReturnType<typeof stateWith>, e: StoreEvent) => applyEvent(s, e, { at: NOW_0930, isDemo: true, newId: () => 'n1' }).state;

describe('Zuordnung je Firma', () => {
  test('Kontext Zulassung: nur Zulassung-Kontakte, keine Verträge, nur lexware_zulassung', () => {
    const c = buildMatchContext(stateWith({ invoices: [z1, workshop], contracts: [{ ...base, contactId: 'm-kaya' }] }), NOW_0930, 'zulassung');
    expect(c.company).toBe('zulassung');
    expect(c.contacts.map((x) => x.id).sort()).toEqual(['d-mueller', 'd-schmidt']);
    expect(c.expected.size).toBe(0);
    expect(c.invoices.map((i) => i.id)).toEqual(['i-z1']);
  });
  test('Kontext NEXUS enthält keine Zulassung-Kontakte', () =>
    expect(buildMatchContext(stateWith(), NOW_0930).contacts.every((c) => c.company === 'nexus')).toBe(true));
  test('bestätigte IBAN + Betrag → automatisch auf Zulassung-Rechnung', () => {
    const r = refresh(stateWith({ invoices: [z1], ibanLinks: [muellerLink], payments: [sptx({ iban: IBAN_MUELLER, amountCents: 39000 })] }), NOW_0930);
    expect(r.allocations).toEqual([{ paymentId: 'sp1', invoiceId: 'i-z1', amountCents: 39000, method: 'auto' }]);
  });
  test('IBAN eines NEXUS-Mitglieds ordnet keine Zulassung-Zahlung zu', () => {
    const r = refresh(stateWith({ contracts: [{ ...base, id: 'k-kaya', contactId: 'm-kaya' }], ibanLinks, payments: [sptx({ iban: IBAN_KAYA, amountCents: 30000 })] }), NOW_0930);
    expect(r.allocations).toEqual([]);
  });
  test('NEXUS-Rechnungsnummer im Zweck einer Sparkasse-Zahlung → kein Treffer', () =>
    expect(matchBankPayment(sptx({ reference: 'RE-1101', amountCents: 14900 }), buildMatchContext(stateWith({ invoices: [workshop] }), NOW_0930, 'zulassung')).confidence).toBe('low'));
  test('Zulassung-Nummer im Zweck einer Qonto-Zahlung → kein Treffer', () =>
    expect(matchBankPayment(tx({ reference: 'RE-Z-2026-290', amountCents: 39000 }), buildMatchContext(stateWith({ invoices: [z1] }), NOW_0930)).confidence).toBe('low'));
  test('confirmPaymentMatch: Zulassung-Zahlung auf NEXUS-Rechnung oder Vertrag → abgelehnt', () => {
    const s = stateWith({ invoices: [workshop], contracts: [{ ...base, id: 'k-kaya', contactId: 'm-kaya' }], payments: [sptx({ amountCents: 14900 })] });
    expect(apply(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceId: 'i-ws' }).allocations).toEqual([]);
    expect(apply(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', contractId: 'k-kaya' }).allocations).toEqual([]);
  });
  test('confirmPaymentMatch Zulassung: Rechnung zugeordnet, IBAN gelernt', () => {
    const r = apply(stateWith({ invoices: [z1], payments: [sptx({ iban: 'de00 1000 0000 0000 0000 01', amountCents: 39000 })] }), { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceId: 'i-z1' });
    expect(r.allocations).toEqual([{ paymentId: 'sp1', invoiceId: 'i-z1', amountCents: 39000, method: 'confirmed' }]);
    expect(r.ibanLinks).toContainEqual(expect.objectContaining({ iban: IBAN_MUELLER, contactId: 'd-mueller' }));
  });
  test('Selektoren je Firma', () => {
    const s = stateWith({ invoices: [z1, workshop], payments: [tx(), sptx()] });
    expect(unallocatedBankPayments(s, 'zulassung').map((p) => p.id)).toEqual(['sp1']);
    expect(unallocatedBankPayments(s).map((p) => p.id)).toEqual(['p1']);
    expect(matchOptions(s, 'zulassung').map((o) => o.value)).toEqual(['invoice:i-z1']);
  });
  test('Hinweis für Zulassung: Link /zulassung/zuordnen, Quelle lexware_zulassung', () => {
    const i = detectUnmatchedPayments(stateWith({ payments: [sptx({ payerName: 'Max Mustermann', amountCents: 5000 })] }), NOW_0930)[0];
    expect(i).toMatchObject({ dedupeKey: 'unmatched:sp1', company: 'zulassung', needsSources: ['lexware_zulassung'] });
    expect(i.refs[0].href).toBe('/zulassung/zuordnen');
  });
});

describe('Zulassung: in Lexware bezahlte Rechnungen', () => {
  const paid = (id: string, issuedOn: string) => inv(id, 39000, { status: 'paid', openCents: 0, issuedOn });
  test('nur Rechnungen innerhalb von 180 Tagen ohne Zuordnung, mit paidInLexware', () => {
    const s = stateWith({
      invoices: [paid('i-new', '2026-10-01'), paid('i-old', '2026-01-01'), paid('i-alloc', '2026-10-02'), inv('i-void', 100, { status: 'void' })],
      allocations: [{ paymentId: 'sp9', invoiceId: 'i-alloc', amountCents: 39000, method: 'confirmed' }],
    });
    const c = buildMatchContext(s, NOW_0930, 'zulassung');
    expect(c.invoices).toEqual([expect.objectContaining({ id: 'i-new', openCents: 0, paidInLexware: true, totalCents: 39000, dueDate: '2026-12-10' })]);
    expect(PAID_LOOKBACK_DAYS).toBe(180);
  });
  test('NEXUS-Kontext bekommt keine bezahlten Rechnungen', () =>
    expect(buildMatchContext(stateWith({ invoices: [{ ...workshop, status: 'paid' }] }), NOW_0930).invoices).toEqual([]));
});

describe('Zulassung: Sammelzahlung, Teil- und Überzahlung, Rückbuchung', () => {
  const z290 = inv('i-z-290', 39000, { number: 'RE-Z-2026-290', dueDate: '2026-10-20' });
  const z295 = inv('i-z-295', 25000, { number: 'RE-Z-2026-295', dueDate: '2026-10-28' });
  const z301 = inv('i-z-301', 9900, { number: 'RE-Z-2026-301', contactId: 'd-schmidt', status: 'paid', openCents: 0, issuedOn: '2026-11-03' });
  test('Sammelzahlung: zwei Nummern, Summe exakt → automatisch auf beide', () => {
    const s = stateWith({ invoices: [z290, z295], payments: [sptx({ amountCents: 64000, reference: 'RE-Z-2026-290 RE-Z-2026-295' })] });
    expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930, 'zulassung'))).toMatchObject({
      confidence: 'high', reason: 'Mehrere Rechnungsnummern im Verwendungszweck, Summe passt.',
      target: { kind: 'invoices', id: 'i-z-290,i-z-295', contactId: 'd-mueller', invoiceIds: ['i-z-290', 'i-z-295'] } });
    const r = refresh(s, NOW_0930);
    expect(r.allocations).toEqual([
      { paymentId: 'sp1', invoiceId: 'i-z-290', amountCents: 39000, method: 'auto' },
      { paymentId: 'sp1', invoiceId: 'i-z-295', amountCents: 25000, method: 'auto' }]);
    expect(r.audit.at(-1)?.text).toBe('Automatisch aufgeteilt: Rechnungen RE-Z-2026-290, RE-Z-2026-295');
  });
  test('Sammelzahlung mit Abweichung (Skonto) → Vorschlag, nicht automatisch', () => {
    const s = stateWith({ invoices: [z290, z295], payments: [sptx({ amountCents: 63000, reference: 'RE-Z-2026-290 RE-Z-2026-295' })] });
    expect(refresh(s, NOW_0930).allocations).toEqual([]);
    expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930, 'zulassung'))).toMatchObject({
      confidence: 'medium', reason: 'Mehrere Rechnungsnummern, Summe weicht ab – Verteilung prüfen.', target: { kind: 'invoices', invoiceIds: ['i-z-290', 'i-z-295'] } });
  });
  test('Nummern verschiedener Kontakte → Auswahl, keine Sammelzahlung', () => {
    const s = stateWith({ invoices: [z290, { ...z295, contactId: 'd-schmidt' }], payments: [sptx({ amountCents: 64000, reference: 'RE-Z-2026-290 RE-Z-2026-295' })] });
    const m = matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930, 'zulassung'));
    expect(m).toMatchObject({ confidence: 'medium', target: null, reason: 'Mehrere Rechnungen passen zur Nummer, bitte auswählen.' });
    expect(m.candidates.map((c) => `${c.kind}:${c.id}`)).toEqual(['invoice:i-z-290', 'invoice:i-z-295']);
  });
  test('Bestätigte IBAN, Summe aller offenen Rechnungen → automatisch', () => {
    const s = stateWith({ invoices: [z290, z295], ibanLinks: [muellerLink], payments: [sptx({ iban: IBAN_MUELLER, amountCents: 64000 })] });
    expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930, 'zulassung'))).toMatchObject({
      confidence: 'high', reason: 'Bestätigte IBAN, Summe aller offenen Rechnungen passt.', target: { kind: 'invoices', invoiceIds: ['i-z-290', 'i-z-295'] } });
    expect(refresh(s, NOW_0930).allocations).toHaveLength(2);
  });
  test('Bestätigte IBAN, Betrag passt zu keiner und nicht zur Summe → Verteilungsvorschlag', () => {
    const s = stateWith({ invoices: [z290, z295], ibanLinks: [muellerLink], payments: [sptx({ iban: IBAN_MUELLER, amountCents: 50000 })] });
    expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930, 'zulassung'))).toMatchObject({
      confidence: 'medium', reason: 'Bestätigte IBAN, Betrag auf offene Rechnungen verteilt – bitte prüfen.', target: { kind: 'invoices', invoiceIds: ['i-z-290', 'i-z-295'] } });
    expect(refresh(s, NOW_0930).allocations).toEqual([]);
  });
  test('Bestätigte IBAN, Betrag passt zu einer Rechnung → Einzeltreffer bleibt', () => {
    const s = stateWith({ invoices: [z290, z295], ibanLinks: [muellerLink], payments: [sptx({ iban: IBAN_MUELLER, amountCents: 25000 })] });
    expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930, 'zulassung')).target).toEqual({ kind: 'invoice', id: 'i-z-295', contactId: 'd-mueller' });
  });
  test('NEXUS: bestätigte IBAN mit zwei offenen Rechnungen bleibt ohne Sammelziel', () => {
    const a = inv('i-n1', 10000, { company: 'nexus', connectionId: 'lexware_nexus', contactId: 'm-kaya', number: 'RE-N-1' });
    const b = inv('i-n2', 20000, { company: 'nexus', connectionId: 'lexware_nexus', contactId: 'm-kaya', number: 'RE-N-2' });
    const s = stateWith({ invoices: [a, b], ibanLinks, payments: [tx({ iban: IBAN_KAYA, amountCents: 30000 })] });
    expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930))).toMatchObject({ confidence: 'medium', reason: 'Bestätigte IBAN, aber der Betrag weicht ab.', target: null });
  });
  test('Bestätigen der Verteilung bei Unterzahlung: Rest bleibt an jüngster Rechnung offen', () => {
    const r = apply(stateWith({ invoices: [z290, z295], payments: [sptx({ amountCents: 50000 })] }), { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceIds: ['i-z-295', 'i-z-290'] });
    expect(r.allocations.map((a) => [a.invoiceId, a.amountCents])).toEqual([['i-z-290', 39000], ['i-z-295', 11000]]);
    expect(r.allocations.every((a) => a.method === 'confirmed')).toBe(true);
    expect(invoiceOpenCents(r, z295)).toBe(14000);
  });
  test('Bestätigen der Verteilung: Text, IBAN gelernt, alte Zuordnung ersetzt', () => {
    const s = stateWith({ invoices: [z290, z295], payments: [sptx({ amountCents: 64000, iban: IBAN_MUELLER })],
      allocations: [{ paymentId: 'sp1', invoiceId: 'i-z-290', amountCents: 39000, method: 'confirmed' }] });
    const r = applyEvent(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceIds: ['i-z-290', 'i-z-295'] }, { at: NOW_0930, isDemo: true, newId: () => 'n1' }).state;
    expect(r.allocations).toEqual([
      { paymentId: 'sp1', invoiceId: 'i-z-290', amountCents: 39000, method: 'confirmed' },
      { paymentId: 'sp1', invoiceId: 'i-z-295', amountCents: 25000, method: 'confirmed' }]);
    expect(r.audit.at(-1)?.text).toBe('Zahlung über 640,00 € aufgeteilt: RE-Z-2026-290 (390,00 €), RE-Z-2026-295 (250,00 €)');
    expect(r.ibanLinks).toContainEqual(expect.objectContaining({ iban: IBAN_MUELLER, contactId: 'd-mueller' }));
  });
  test('Bestätigen der Verteilung abgelehnt: verschiedene Kontakte, fremde Firma, doppelte IDs', () => {
    const s = stateWith({ invoices: [z290, { ...z295, contactId: 'd-schmidt' }, workshop], payments: [sptx({ amountCents: 64000 })] });
    expect(apply(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceIds: ['i-z-290', 'i-z-295'] }).allocations).toEqual([]);
    expect(apply(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceIds: ['i-z-290', 'i-ws'] }).allocations).toEqual([]);
    expect(apply(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceIds: ['i-z-290', 'i-z-290'] }).allocations).toEqual([]);
  });
  test('Überzahlung beim Bestätigen: Rest bleibt nicht zugeordnet', () => {
    const r = apply(stateWith({ invoices: [z290], payments: [sptx({ amountCents: 40000 })] }), { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceId: 'i-z-290' });
    expect(r.allocations).toEqual([{ paymentId: 'sp1', invoiceId: 'i-z-290', amountCents: 39000, method: 'confirmed' }]);
    expect(paymentRestCents(r, r.payments[0])).toBe(1000);
  });
  test('Teilzahlung: Nummer gefunden, Betrag kleiner → Vorschlag; nach Bestätigung 180 € offen', () => {
    const s = stateWith({ invoices: [z290], payments: [sptx({ amountCents: 21000, reference: 'RE-Z-2026-290' })] });
    expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930, 'zulassung')).confidence).toBe('medium');
    expect(invoiceOpenCents(apply(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceId: 'i-z-290' }), z290)).toBe(18000);
  });
  test('Lexware schon bezahlt: Nummer + Gesamtbetrag → automatisch, offen bleibt 0', () => {
    const r = refresh(stateWith({ invoices: [z301], payments: [sptx({ amountCents: 9900, reference: 'Rechnung RE-Z-2026-301' })] }), NOW_0930);
    expect(r.allocations).toEqual([{ paymentId: 'sp1', invoiceId: 'i-z-301', amountCents: 9900, method: 'auto' }]);
    expect(invoiceOpenCents(r, z301)).toBe(0);
    expect(r.audit.at(-1)?.text).toBe('Automatisch zugeordnet: Rechnung RE-Z-2026-301 (in Lexware schon bezahlt)');
  });
  test('Lexware schon bezahlt, Betrag weicht ab → Vorschlag; Bestätigen höchstens bis Gesamtbetrag', () => {
    const s = stateWith({ invoices: [z301], payments: [sptx({ amountCents: 12000, reference: 'RE-Z-2026-301' })] });
    expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930, 'zulassung'))).toMatchObject({ confidence: 'medium', reason: 'Rechnungsnummer gefunden, Betrag weicht ab (Teilzahlung?).' });
    expect(refresh(s, NOW_0930).allocations).toEqual([]);
    expect(apply(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceId: 'i-z-301' }).allocations).toEqual([{ paymentId: 'sp1', invoiceId: 'i-z-301', amountCents: 9900, method: 'confirmed' }]);
  });
  test('Lexware bezahlt, älter als 180 Tage → kein Treffer', () =>
    expect(buildMatchContext(stateWith({ invoices: [{ ...z301, issuedOn: '2026-05-01' }] }), NOW_0930, 'zulassung').invoices).toEqual([]));
  const refundOfSp1 = (id: string, n: number, amountCents: number) =>
    sptx({ id, externalId: `spk-000000000000000${n}`, amountCents, iban: IBAN_MUELLER, refundOf: 'spk-0000000000000001', bookedOn: '2026-11-12' });
  test('Rückbuchung einer Sammelzahlung: anteilig, jüngste Rechnung zuerst', () => {
    const s = stateWith({ invoices: [z290, z295],
      payments: [sptx({ amountCents: 64000, reference: 'RE-Z-2026-290 RE-Z-2026-295', iban: IBAN_MUELLER }), refundOfSp1('sp2', 2, -30000)] });
    const r = refresh(s, NOW_0930);
    expect(r.allocations.filter((a) => a.paymentId === 'sp2').map((a) => [a.invoiceId, a.amountCents])).toEqual([['i-z-295', -25000], ['i-z-290', -5000]]);
    expect(invoiceOpenCents(r, z295)).toBe(25000);
    expect(invoiceOpenCents(r, z290)).toBe(5000);
  });
  test('zwei Teil-Rückbuchungen: nie mehr storniert als zugeordnet', () => {
    const s = stateWith({ invoices: [z290, z295],
      payments: [sptx({ amountCents: 64000, reference: 'RE-Z-2026-290 RE-Z-2026-295', iban: IBAN_MUELLER }), refundOfSp1('sp2', 2, -30000), refundOfSp1('sp3', 3, -40000)] });
    const r = refresh(s, NOW_0930);
    expect(r.allocations.filter((a) => a.paymentId === 'sp2').map((a) => [a.invoiceId, a.amountCents])).toEqual([['i-z-295', -25000], ['i-z-290', -5000]]);
    expect(r.allocations.filter((a) => a.paymentId === 'sp3').map((a) => [a.invoiceId, a.amountCents])).toEqual([['i-z-290', -34000]]);
    expect(r.allocations.filter((a) => a.paymentId !== 'sp1').reduce((n, a) => n + a.amountCents, 0)).toBe(-64000);
    expect(invoiceOpenCents(r, z290)).toBe(39000);
    expect(invoiceOpenCents(r, z295)).toBe(25000);
    expect(refresh(r, NOW_0930).allocations).toEqual(r.allocations);
  });
});
