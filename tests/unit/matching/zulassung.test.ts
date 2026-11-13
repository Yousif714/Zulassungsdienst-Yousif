import { describe, expect, test } from 'vitest';
import { applyEvent, refresh } from '@/data/engine';
import { matchOptions, unallocatedBankPayments } from '@/data/selectors';
import { PAID_LOOKBACK_DAYS, buildMatchContext, detectUnmatchedPayments } from '@/domain/detectors/payments';
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
