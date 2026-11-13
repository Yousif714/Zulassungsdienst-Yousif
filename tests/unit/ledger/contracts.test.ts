import { expect, test } from 'vitest';
import {
  contractKindLabel, contractOnHold, contractsOfContact, invoiceRef, membershipContractOf, retargetAllocations, sourceInvoiceOf,
} from '@/domain/ledger/contracts';
import { base, inv, stateWith } from '../helpers';

test('Label: fehlt = Mitgliedschaft, ticket = Ticket-Raten, other = Ratenzahlung', () => {
  expect(contractKindLabel(undefined)).toBe('Mitgliedschaft');
  expect(contractKindLabel('membership')).toBe('Mitgliedschaft');
  expect(contractKindLabel('ticket')).toBe('Ticket-Raten');
  expect(contractKindLabel('other')).toBe('Ratenzahlung');
});

test('membershipContractOf überspringt Ticket-Verträge desselben Kontakts', () => {
  const s = stateWith({ contracts: [{ ...base, id: 't1', contactId: 'm1', kind: 'ticket' }, { ...base, id: 'c1', contactId: 'm1' }] });
  expect(membershipContractOf(s, 'm1')?.id).toBe('c1');
  expect(contractsOfContact(s, 'm1').map((c) => c.id)).toEqual(['t1', 'c1']);
});

test('invoiceRef und sourceInvoiceOf', () => {
  const i = inv('i-r1', 60000, { company: 'nexus', connectionId: 'lexware_nexus', externalId: 'lex-r1' });
  expect(invoiceRef(i)).toEqual({ connectionId: 'lexware_nexus', externalId: 'invoice:lex-r1' });
  const c = { ...base, origin: [invoiceRef(i)] };
  expect(sourceInvoiceOf(stateWith({ invoices: [i], contracts: [c] }), c)?.id).toBe('i-r1');
  expect(sourceInvoiceOf(stateWith({ invoices: [i], contracts: [base] }), base)).toBeUndefined();
});

test('contractOnHold nur bei stornierter Quellrechnung', () => {
  const i = inv('i-r1', 60000, { company: 'nexus', connectionId: 'lexware_nexus', externalId: 'lex-r1', status: 'void' });
  const c = { ...base, origin: [invoiceRef(i)] };
  expect(contractOnHold(stateWith({ invoices: [i], contracts: [c] }), c)).toBe(true);
  expect(contractOnHold(stateWith({ invoices: [{ ...i, status: 'paid' }], contracts: [c] }), c)).toBe(false);
  expect(contractOnHold(stateWith({ contracts: [base] }), base)).toBe(false);
});

test('retargetAllocations hängt nur Zuordnungen der Rechnung um, Methode bleibt', () => {
  const a = [
    { paymentId: 'p1', invoiceId: 'i-r1', amountCents: 10000, method: 'confirmed' as const },
    { paymentId: 'p2', invoiceId: 'i-x', amountCents: 5000, method: 'auto' as const },
  ];
  expect(retargetAllocations(a, { invoiceId: 'i-r1' }, { contractId: 'k1' })).toEqual([
    { paymentId: 'p1', contractId: 'k1', amountCents: 10000, method: 'confirmed' }, a[1]]);
  const back = retargetAllocations([{ paymentId: 'p1', contractId: 'k1', amountCents: 10000, method: 'confirmed' }], { contractId: 'k1' }, { invoiceId: 'i-r1' });
  expect(back).toEqual([{ paymentId: 'p1', invoiceId: 'i-r1', amountCents: 10000, method: 'confirmed' }]);
});
