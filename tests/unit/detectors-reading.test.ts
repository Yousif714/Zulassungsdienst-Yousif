import { expect, test } from 'vitest';
import { runDetectors } from '@/domain/detectors';
import { detectReadContracts, detectReadInvoiceChanged } from '@/domain/detectors/reading';
import { invoiceRef } from '@/domain/ledger/contracts';
import type { MemberContract } from '@/domain/types';
import { NOW_0930, base, stateWith } from './helpers';
import { readInv } from './import/reading-fixtures';

const readBy = (confirmed: boolean) => ({ invoiceId: 'i-r1', invoiceNumber: 'RE-9001', quote: 'q', confirmed });
const read = (id: string, confirmed = false): MemberContract => ({ ...base, id, readBy: readBy(confirmed) });

test('ein unbestätigter gelesener Vertrag → „1 Ratenplan von Claude gelesen – kurz prüfen“ mit Link', () => {
  const [i, more] = detectReadContracts(stateWith({ contracts: [read('k1')] }));
  expect(more).toBeUndefined();
  expect(i).toMatchObject({ type: 'contract_read_review', dedupeKey: 'read-review', company: 'nexus', priority: 'today', title: '1 Ratenplan von Claude gelesen – kurz prüfen',
    body: 'Claude hat Ratenpläne aus Rechnungen angelegt. Kurz ansehen und „Passt“ tippen oder korrigieren.', nextStep: 'Kurz prüfen', needsSources: ['lexware_nexus'] });
  expect(i.refs[0].href).toBe('/nexus/mitglieder/k1');
});

test('zwei → „2 Ratenpläne …“; bestätigt → kein Hinweis', () => {
  expect(detectReadContracts(stateWith({ contracts: [read('k1'), read('k2'), read('k3', true), base] }))[0].title).toBe('2 Ratenpläne von Claude gelesen – kurz prüfen');
  expect(detectReadContracts(stateWith({ contracts: [read('k3', true), base] }))).toEqual([]);
});

test('Quellrechnung storniert / bezahlt → Hinweis mit Rechnungsnummer', () => {
  const k = (status: 'void' | 'paid' | 'open') => {
    const i = readInv({ status });
    return stateWith({ invoices: [i], contracts: [{ ...read('k1', true), origin: [invoiceRef(i)] }] });
  };
  expect(detectReadInvoiceChanged(k('void'))[0]).toMatchObject({ type: 'read_invoice_changed', dedupeKey: 'read-inv:i-r1:void', title: 'Rechnung RE-9001 storniert – Ratenvertrag prüfen', nextStep: 'Vertrag prüfen', needsSources: ['lexware_nexus'] });
  expect(detectReadInvoiceChanged(k('paid'))[0].title).toBe('Rechnung RE-9001 als bezahlt markiert – Ratenvertrag prüfen');
  expect(detectReadInvoiceChanged(k('open'))).toEqual([]);
});

test('9a: stornierte Quellrechnung → Vertrag nicht als überfällig', () => {
  const i = readInv({ status: 'void' });
  const s = stateWith({ invoices: [i], contracts: [{ ...read('k1', true), contactId: 'm-x', startDate: '2026-08-01', origin: [invoiceRef(i)] }],
    contacts: [{ id: 'm-x', company: 'nexus', kind: 'member', name: 'Erika Beispiel', phones: [], emails: [] }] });
  const all = runDetectors(s, NOW_0930);
  expect(all.some((x) => x.type === 'member_overdue')).toBe(false);
  expect(all.some((x) => x.type === 'read_invoice_changed')).toBe(true);
});
