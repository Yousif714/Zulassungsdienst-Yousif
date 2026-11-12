import { describe, expect, test } from 'vitest';
import { createDemoState } from '@/data/seed';
import { invoiceCandidates, stripeLexCases, unallocatedBankPayments, zulassungKpis } from '@/data/selectors';
import { reducer, refresh } from '@/data/store';
import { jobBilling } from '@/domain/billing';
import { NOW_0930 as NOW } from './helpers';

const s = refresh(createDemoState(), NOW);

describe('Zuordnen-Selektoren', () => {
  test('offene Bankzahlungen: nur eingehend, NEXUS, ohne Zuordnung', () => {
    const ids = unallocatedBankPayments(s).map((p) => p.id);
    expect(ids).toContain('p-yilmaz-1');
    expect(ids).not.toContain('p-payout-1');
    expect(ids).not.toContain('p-kaya-1');
  });

  test('Stripe bezahlt, Lexware offen: Fall verschwindet nach settleInvoice', () => {
    const cases = stripeLexCases(s);
    expect(cases.map((c) => [c.key, c.invoice.id, c.payment.id])).toEqual([['stripe-lex:i-lex-118', 'i-lex-118', 'p-stripe-118']]);
    const s2 = reducer(s, { type: 'settleInvoice', invoiceId: 'i-lex-118', paymentId: 'p-stripe-118' });
    expect(stripeLexCases(s2)).toEqual([]);
  });
});

describe('Zulassungsdienst-Selektoren', () => {
  test('Tageszahlen im Demo-Stand', () => {
    expect(zulassungKpis(s, NOW)).toEqual({ doneToday: 0, open: 0, waiting: 1, notInvoiced: 1 });
  });
  test('Status „erledigt“ heute zählt, nicht abgerechnet steigt', () => {
    const s2 = reducer(s, { type: 'setJobStatus', jobId: 'j-schmidt-1', status: 'done' });
    expect(zulassungKpis(s2, NOW)).toEqual({ doneToday: 1, open: 0, waiting: 0, notInvoiced: 2 });
  });
  test('veraltete Lexware-Quelle → nicht abgerechnet unbekannt', () => {
    const s2 = reducer(s, { type: 'setConnectionStatus', id: 'lexware_zulassung', status: 'error' });
    expect(zulassungKpis(s2, NOW).notInvoiced).toBeNull();
  });
  test('Rechnung zuordnen: Rest 0, Auftrag abgerechnet', () => {
    const job = (st: typeof s) => st.jobs.find((j) => j.id === 'j-mueller-1')!;
    expect(jobBilling(s, job(s)).restCents).toBe(8900);
    const s2 = reducer(s, { type: 'linkInvoiceToJob', jobId: 'j-mueller-1', invoiceId: 'i-z-311' });
    expect(jobBilling(s2, job(s2))).toEqual({ invoicedCents: 8900, restCents: 0 });
    expect(job(s2).status).toBe('invoiced');
  });
  test('Passende Rechnungen: gleicher Kontakt, unverknüpft, nicht storniert, Betrag ≤ Rest, Kennzeichen zuerst', () => {
    const z = s.invoices.find((i) => i.id === 'i-z-311')!;
    const mk = (id: string, p: Partial<typeof z>) => ({ ...z, id, number: id, ...p });
    const s2 = {
      ...s,
      invoices: [
        ...s.invoices,
        mk('i-other', { text: 'Abmeldung E-XY 1', totalCents: 2000 }),
        mk('i-void', { status: 'void' as const }),
        mk('i-big', { totalCents: 9000 }),
        mk('i-foreign', { contactId: 'd-schmidt' }),
        mk('i-nexus', { company: 'nexus' as const }),
        mk('i-plate', { text: 'Kennzeichen bot mk456 Zusatz', totalCents: 1000 }),
        mk('i-near', { text: 'Umschreibung BOT-MK 4567', totalCents: 1500, issuedOn: '2026-11-11' }),
      ],
    };
    // „BOT-MK 4567“ ist nicht das Kennzeichen „BOT-MK 456“ (Wortgrenze): kein Vorrang, nur nach Datum vor i-other.
    expect(invoiceCandidates(s2, 'j-mueller-1').map((i) => i.id)).toEqual(['i-z-311', 'i-plate', 'i-near', 'i-other']);
    const linked = reducer(s, { type: 'linkInvoiceToJob', jobId: 'j-mueller-1', invoiceId: 'i-z-311' });
    expect(invoiceCandidates(linked, 'j-mueller-1')).toEqual([]);
    // Hält ein ANDERER Auftrag die Rechnung, ist sie kein Kandidat.
    const other = { ...s, jobs: [...s.jobs, { ...s.jobs.find((j) => j.id === 'j-mueller-1')!, id: 'j-mueller-x', invoiceIds: ['i-z-311'] }] };
    expect(invoiceCandidates(other, 'j-mueller-1').map((i) => i.id)).not.toContain('i-z-311');
  });
});
