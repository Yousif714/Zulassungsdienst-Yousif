import { describe, expect, test } from 'vitest';
import { coveringContract, invoiceOpenCents, nexusReceivables } from '@/domain/ledger/receivables';
import { memberView } from '@/domain/detectors/members';
import { base, member, stateWith, tx, workshop } from '../helpers';
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
