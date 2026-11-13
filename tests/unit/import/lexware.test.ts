import { expect, test } from 'vitest';

import { lexwareCompany, mapLexwareContacts, mapLexwareInvoice, mapLexwareOrderConfirmation } from '@/domain/import/lexware';
import { idOf, lexContacts, lexDetail, lexOrderConfirmation, updatedOf } from '../../fixtures';

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
test('Firma: Kontaktpersonen (leere weggelassen), Person ohne Feld', () => {
  const cs = mapLexwareContacts(lexContacts('nexus'), 'lexware_nexus');
  expect(cs.find((c) => c.name === 'Fahrschule Beispiel GmbH')?.contactPersons).toEqual(['Anna Beispiel']);
  expect(cs.find((c) => c.name === 'Murat Demir')).not.toHaveProperty('contactPersons');
});

test('Auftragsbestätigung: Felder, Text, Cent; keine Forderungsfelder', () => {
  const ab = mapLexwareOrderConfirmation(lexOrderConfirmation('AB-2001'), 'lexware_nexus');
  expect(ab).toEqual({
    company: 'nexus', connectionId: 'lexware_nexus', externalId: 'oc-AB-2001', number: 'AB-2001', totalCents: 120000, issuedOn: '2026-07-03',
    status: 'open', contactExternalId: 'c-84', sourceUpdatedAt: '2026-07-03T09:00:00.000+02:00', text: expect.stringContaining('NEXUS-Mitgliedschaft 12 Monate'),
  });
  expect(ab).not.toHaveProperty('openCents');
  expect(ab).not.toHaveProperty('dueDate');
  expect(mapLexwareOrderConfirmation(lexOrderConfirmation('AB-Z-1'), 'lexware_zulassung')).toMatchObject({ company: 'zulassung', connectionId: 'lexware_zulassung', number: 'AB-Z-1', totalCents: 23800 });
  expect(mapLexwareOrderConfirmation({ ...lexOrderConfirmation('AB-2002'), voucherStatus: 'voided' }, 'lexware_nexus').status).toBe('void');
  const bare = mapLexwareOrderConfirmation({ id: 'x', voucherNumber: 'AB-9', voucherDate: '2026-07-01T00:00:00.000+02:00' }, 'lexware_nexus');
  expect(bare).toEqual({ company: 'nexus', connectionId: 'lexware_nexus', externalId: 'x', number: 'AB-9', totalCents: 0, issuedOn: '2026-07-01', status: 'open' });
});
