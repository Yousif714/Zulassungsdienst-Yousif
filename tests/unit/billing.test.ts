import { describe, expect, test } from 'vitest';
import { jobBilling } from '@/domain/billing';
import type { Invoice } from '@/domain/types';
import { jobs } from './helpers';

const job = jobs[0]; // Preis 100,00 €
const inv = (id: string, totalCents: number, status: Invoice['status'] = 'open'): Invoice => ({
  id, company: 'zulassung', source: 'lexware', connectionId: 'lexware_zulassung', externalId: id, contactId: 'd-mueller', number: id,
  totalCents, openCents: totalCents, issuedOn: '2026-11-10', dueDate: '2026-11-24', status,
});

describe('jobBilling', () => {
  test('ohne Rechnung: Rest = Preis', () => {
    expect(jobBilling({ invoices: [] }, job)).toEqual({ invoicedCents: 0, restCents: 10000 });
  });
  test('verknüpfte Rechnungen zählen, stornierte nicht', () => {
    const j = { ...job, invoiceIds: ['a', 'b', 'c'] };
    expect(jobBilling({ invoices: [inv('a', 4000), inv('b', 2000, 'paid'), inv('c', 3000, 'void')] }, j)).toEqual({ invoicedCents: 6000, restCents: 4000 });
  });
  test('überzahlt: Rest negativ, nicht verknüpfte Rechnungen ignoriert', () => {
    expect(jobBilling({ invoices: [inv('a', 12000), inv('x', 500)] }, { ...job, invoiceIds: ['a'] })).toEqual({ invoicedCents: 12000, restCents: -2000 });
  });
});
