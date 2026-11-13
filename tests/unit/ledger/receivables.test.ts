import { describe, expect, test } from 'vitest';
import { coveringContract, customerOpenInvoices, invoiceOpenCents, invoicePaidCents, nexusReceivables } from '@/domain/ledger/receivables';
import { memberView } from '@/domain/detectors/members';
import { invoiceRef } from '@/domain/ledger/contracts';
import { base, conn, inv, member, sptx, stateWith, tx, workshop } from '../helpers';
import { readInv } from '../import/reading-fixtures';
import { legacyNoBank } from '../import/helpers';

const TODAY = '2026-11-12';
const withContract = (p: Parameters<typeof stateWith>[0] = {}) => stateWith({ contracts: [{ ...base, contactId: 'm-yilmaz' }], ...p });

describe('Forderungen', () => {
  test('Rechnung ohne Vertrag ist Forderung', () => expect(invoiceOpenCents(stateWith({ invoices: [workshop] }), workshop)).toBe(14900));
  test('Mitgliedsrechnung mit Vertrags-origin zählt nicht doppelt', () => {
    const s = stateWith({ invoices: [member('RE-1043')], contracts: [{ ...base, id: 'k77', contactId: 'm-other', origin: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] }] });
    expect(coveringContract(s, member('RE-1043'))).toBe('k77');
    expect(invoiceOpenCents(s, member('RE-1043'))).toBe(0);
  });
  test('kein Fallback über contactId (F8)', () => {
    const s = stateWith({ invoices: [member('RE-9')], contracts: [{ ...base, id: 'k1', contactId: 'm-x' }] });
    expect(coveringContract(s, member('RE-9'))).toBeNull();
    expect(invoiceOpenCents(s, member('RE-9'))).toBe(30000);
  });
  test('Lexware paid → erledigt, ohne Gutschrift für Verträge', () => {
    const s = withContract({ invoices: [{ ...workshop, status: 'paid', openCents: 0 }] });
    expect(invoiceOpenCents(s, s.invoices[0])).toBe(0);
    expect(memberView(s, s.contracts[0].id, TODAY).status).toEqual(memberView(withContract(), s.contracts[0].id, TODAY).status);
  });
  test('Zuordnung mindert die Rechnung', () => {
    const s = stateWith({ invoices: [workshop], payments: [tx({ id: 'p', amountCents: 10000 })], allocations: [{ paymentId: 'p', invoiceId: 'i-ws', amountCents: 10000, method: 'confirmed' }] });
    expect(invoiceOpenCents(s, workshop)).toBe(4900);
  });
  test('Review 2: zugeordnet und danach in Lexware bezahlt → 0, nie negativ', () => {
    const alloc = { paymentId: 'p', invoiceId: 'i-ws', amountCents: 14900, method: 'confirmed' as const };
    const paid = stateWith({ invoices: [{ ...workshop, status: 'paid', openCents: 0 }], payments: [tx({ id: 'p', amountCents: 14900 })], allocations: [alloc] });
    expect(invoiceOpenCents(paid, paid.invoices[0])).toBe(0);
    const partLex = stateWith({ invoices: [{ ...workshop, openCents: 4900 }], payments: [tx({ id: 'p', amountCents: 10000 })], allocations: [{ ...alloc, amountCents: 10000 }] });
    expect(invoiceOpenCents(partLex, partLex.invoices[0])).toBe(4900);
  });
  test('Übersicht: Verträge im Rückstand plus offene Rechnungen, nach Überfälligkeit sortiert, Summe', () => {
    const r = nexusReceivables(withContract({ invoices: [workshop] }), TODAY);
    expect(r.items[0]).toMatchObject({ key: 'invoice:i-ws', label: 'RE-1101', source: 'Lexware', amountCents: 14900, daysOverdue: 47, traffic: 'red' });
    expect(r.items.some((i) => i.kind === 'contract')).toBe(true);
    expect(r.totalCents).toBe(r.items.reduce((n, i) => n + i.amountCents, 0));
    expect(r.items.map((i) => i.daysOverdue)).toEqual([...r.items.map((i) => i.daysOverdue)].sort((a, b) => b - a));
  });
  test('Verträge ohne verbundene Quelle fehlen', () => expect(nexusReceivables(legacyNoBank, TODAY).items.some((i) => i.kind === 'contract')).toBe(false));
  test('nicht fällige Rechnung: grün, nicht in overdueCents', () => {
    const r = nexusReceivables(stateWith({ contracts: [], invoices: [{ ...workshop, dueDate: '2026-12-01', status: 'open' }] }), TODAY);
    expect(r.items[0].traffic).toBe('green');
    expect(r.overdueCents).toBe(0);
  });
});

describe('Ratenverträge aus Lesungen', () => {
  const qonto = [conn({ id: 'bank_qonto', status: 'connected' })];
  test('Rechnung mit Vertrag aus der Lesung (origin invoice:) zählt nicht doppelt', () => {
    const i = readInv();
    const s = stateWith({ invoices: [i], contracts: [{ ...base, id: 'k1', contactId: 'm-x', kind: 'ticket', origin: [invoiceRef(i)] }] });
    expect(coveringContract(s, i)).toBe('k1');
    expect(invoiceOpenCents(s, i)).toBe(0);
  });
  test('Ticket-Vertrag desselben Kontakts deckt die Mitgliedsrechnung nicht ab', () => {
    const m = member('i-m1');
    const s = stateWith({ invoices: [m], contracts: [{ ...base, id: 't1', kind: 'ticket', origin: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] }] });
    expect(coveringContract(s, m)).toBeNull();
  });
  test('Offen: Label „Ticket-Raten“ und Rate statt Gesamtsumme', () => {
    const i = readInv();
    const k = { ...base, id: 'k1', contactId: 'm-x', kind: 'ticket' as const, totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 15, startDate: '2026-10-15', origin: [invoiceRef(i)] };
    const r = nexusReceivables(stateWith({ invoices: [i], contracts: [k], connections: qonto }), TODAY);
    expect(r.items.map((x) => [x.label, x.amountCents])).toEqual([['Ticket-Raten', 10000]]);
  });
  test('9a: Vertrag aus stornierter Rechnung ist nicht in Offen', () => {
    const i = readInv({ status: 'void' });
    const k = { ...base, id: 'k1', contactId: 'm-x', kind: 'ticket' as const, origin: [invoiceRef(i)] };
    expect(nexusReceivables(stateWith({ invoices: [i], contracts: [k], connections: qonto }), TODAY).items).toEqual([]);
  });
});

describe('Zulassung: bezahlt und offen je Kunde', () => {
  const z600 = inv('i-z6', 60000, { dueDate: '2026-10-01', status: 'overdue' });
  const alloc = (amountCents: number) => ({ paymentId: 'sp1', invoiceId: 'i-z6', amountCents, method: 'confirmed' as const });
  test('invoicePaidCents: offen mit Teilzahlung, bezahlt, storniert', () => {
    const part = stateWith({ invoices: [z600], payments: [sptx({ amountCents: 42000 })], allocations: [alloc(42000)] });
    expect(invoicePaidCents(part, z600)).toBe(42000);
    const lexPaid = { ...z600, status: 'paid' as const, openCents: 0 };
    expect(invoicePaidCents(stateWith({ invoices: [lexPaid] }), lexPaid)).toBe(60000);
    const voided = { ...z600, status: 'void' as const };
    expect(invoicePaidCents(stateWith({ invoices: [voided] }), voided)).toBe(0);
  });
  test('customerOpenInvoices: nur Zulassung des Kontakts mit Rest, älteste Fälligkeit zuerst', () => {
    const later = inv('i-z2', 20000, { dueDate: '2026-12-01' });
    const paid = inv('i-z3', 5000, { status: 'paid', openCents: 0 });
    const other = inv('i-z4', 7000, { contactId: 'd-schmidt' });
    const s = stateWith({ invoices: [later, z600, paid, other], payments: [sptx({ amountCents: 42000 })], allocations: [alloc(42000)] });
    expect(customerOpenInvoices(s, 'd-mueller')).toEqual({ invoiceIds: ['i-z6', 'i-z2'], openCents: 38000 });
  });
});
