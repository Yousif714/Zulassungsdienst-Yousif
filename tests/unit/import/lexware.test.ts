import { expect, test } from 'vitest';

import { lexwareCompany, mapLexwareContacts, mapLexwareInvoice } from '@/domain/import/lexware';
import { idOf, lexContacts, lexDetail, updatedOf } from '../../fixtures';

const inv = (n: string) => mapLexwareInvoice(lexDetail(n), 'lexware_nexus');
const withTotal = (d: object, gross: number) => ({ ...d, totalPrice: { currency: 'EUR', totalGrossAmount: gross } });
const withStatus = (d: object, voucherStatus: string) => ({ ...d, voucherStatus });

test('Ratenrechnung', () => expect(inv('RE-1043')).toMatchObject({
  company: 'nexus', source: 'lexware', connectionId: 'lexware_nexus', externalId: idOf('RE-1043'), number: 'RE-1043',
  totalCents: 30000, issuedOn: '2026-09-01', dueDate: '2026-09-01', contactExternalId: 'c-77', text: expect.stringContaining('NEXUS-Mitgliedschaft 6 Monate') }));
test('Gesamtrechnung: Text aus Titel, Einleitung und Positionen', () => {
  const t = inv('RE-1100').text!;
  expect(t).toContain('zum 15. des Monats');
  expect(t).toContain('Vielen Dank');
  expect(t).toContain('Rechnung');
  expect(t).toContain('Gesamtbetrag');
});
test('Storno → void', () => expect(inv('RE-1102')).toMatchObject({ status: 'void', openCents: 0 }));
test('Cent ohne Rundungsfehler', () => {
  const c = (x: number) => mapLexwareInvoice(withTotal(lexDetail('RE-1043'), x), 'lexware_nexus').totalCents;
  expect(c(0.1 + 0.2)).toBe(30);
  expect(c(19.99)).toBe(1999);
  expect(c(1.005)).toBe(101);
  expect(c(1200)).toBe(120000);
});
test('Status: offen/überfällig behalten Restbetrag', () => {
  expect(mapLexwareInvoice(withStatus(lexDetail('RE-1043'), 'open'), 'lexware_nexus')).toMatchObject({ status: 'open', openCents: 30000 });
  expect(mapLexwareInvoice(withStatus(lexDetail('RE-1043'), 'overdue'), 'lexware_nexus')).toMatchObject({ status: 'overdue', openCents: 30000 });
});
test('Status: bezahlt → paid, openCents 0', () => {
  for (const s of ['paid', 'paidoff']) expect(mapLexwareInvoice(withStatus(lexDetail('RE-1043'), s), 'lexware_nexus')).toMatchObject({ status: 'paid', openCents: 0 });
});
test('Zulassung-Rechnung', () => expect(mapLexwareInvoice(lexDetail('RZ-500'), 'lexware_zulassung')).toMatchObject({ company: 'zulassung', connectionId: 'lexware_zulassung', totalCents: 11900, openCents: 11900, status: 'open' }));
test('Kontakte mit externalRefs, Firma → dealer', () => {
  expect(mapLexwareContacts(lexContacts('nexus'), 'lexware_nexus')[0]).toEqual({ company: 'nexus', kind: 'member', name: 'Murat Demir', phones: [], emails: ['murat@example.de'], externalRefs: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] });
  expect(mapLexwareContacts(lexContacts('zulassung'), 'lexware_zulassung')[0]).toMatchObject({ company: 'zulassung', kind: 'dealer', name: 'Autohaus Kern', phones: ['089 123456'] });
});
test('Zulassung: Person → private', () => {
  const c = mapLexwareContacts([{ id: 'p1', person: { firstName: 'A', lastName: 'B' } }], 'lexware_zulassung')[0];
  expect(c).toMatchObject({ kind: 'private', name: 'A B', emails: [] });
});
test('sourceUpdatedAt aus updatedDate', () => expect(inv('RE-1043').sourceUpdatedAt).toBe(updatedOf('RE-1043')));
test('lexwareCompany', () => expect(lexwareCompany).toEqual({ lexware_nexus: 'nexus', lexware_zulassung: 'zulassung' }));
test('Teilzahlung: openAmount (aus der Voucherlist) bestimmt openCents', () => {
  const d = { ...withStatus(lexDetail('RE-1043'), 'open'), openAmount: 120.5 };
  expect(mapLexwareInvoice(d, 'lexware_nexus')).toMatchObject({ totalCents: 30000, openCents: 12050, status: 'open' });
  expect(mapLexwareInvoice({ ...withStatus(lexDetail('RE-1043'), 'paid'), openAmount: 0 }, 'lexware_nexus').openCents).toBe(0);
});
test('Fax ist keine Telefonnummer', () => {
  const c = mapLexwareContacts([{ id: 'x', person: { lastName: 'A' }, phoneNumbers: { business: ['089 1'], mobile: ['0170 2'], fax: ['089 99'] } }], 'lexware_nexus')[0];
  expect(c.phones).toEqual(['089 1', '0170 2']);
});
