import { describe, expect, test } from 'vitest';
import { ONSITE_SURCHARGE_CENTS, runCoach } from '@/domain/coach';
import type { Allocation, Job, MemberContract, Payment } from '@/domain/types';
import { NOW_0930 as NOW, inv, msg, stateWith, types } from './helpers';

const TEXT = 'Für die Umschreibung brauchen wir: ZB I + II, eVB, Ausweis, Vollmacht, SEPA-Mandat.';
const out = (id: string, sentAt: string, body = TEXT) => msg({ id, direction: 'out', body, sentAt, threadId: `t-${id}` });

describe('Coach: Schnellantwort', () => {
  test('3 gleiche ausgehende Nachrichten in 7 Tagen', () => {
    const r = runCoach(stateWith({ messages: [out('a', '2026-11-06T10:00:00Z'), out('b', '2026-11-09T10:00:00Z'), out('c', '2026-11-11T10:00:00Z', `  ${TEXT.toUpperCase()} `)] }), NOW);
    expect(types(r)).toEqual(['coach_quick_reply']);
    expect(r[0].priority).toBe('info');
    expect(r[0].dedupeKey).toBe(`coach:quick_reply:${TEXT.toLowerCase().slice(0, 60)}`);
    expect(r[0].nextStep).toBeTruthy();
  });
  test('älter als 7 Tage zählt nicht', () => {
    expect(runCoach(stateWith({ messages: [out('a', '2026-11-04T10:00:00Z'), out('b', '2026-11-09T10:00:00Z'), out('c', '2026-11-11T10:00:00Z')] }), NOW)).toEqual([]);
  });
  test('eingehende zählen nicht', () => {
    expect(runCoach(stateWith({ messages: [out('a', '2026-11-08T10:00:00Z'), out('b', '2026-11-09T10:00:00Z'), msg({ id: 'c', body: TEXT })] }), NOW)).toEqual([]);
  });
});

describe('Coach: Fälligkeitstag', () => {
  const contract: MemberContract = { id: 'mc-b', contactId: 'm-kaya', totalCents: 300000, installments: 12, installmentCents: 25000, dueDay: 1, startDate: '2026-09-01', billing: 'legacy', catchUpMode: 'first_rate' };
  const pay = (id: string, bookedOn: string): Payment => ({ id, company: 'nexus', source: 'bank', connectionId: 'bank', externalId: id, amountCents: 25000, bookedOn, kind: 'incoming' });
  const alloc = (id: string): Allocation => ({ paymentId: id, contractId: 'mc-b', amountCents: 25000, method: 'confirmed' });
  const st = (days: string[]) =>
    stateWith({ contracts: [contract], payments: days.map((d, i) => pay(`p${i}`, d)), allocations: days.map((_, i) => alloc(`p${i}`)) });

  test('3 Raten in Folge ≥ 4 Tage zu spät → Vorschlag', () => {
    const r = runCoach(st(['2026-09-06', '2026-10-06', '2026-11-06']), NOW);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: 'coach_due_day', dedupeKey: 'coach:due_day:mc-b', priority: 'info', company: 'nexus' });
    expect(r[0].body).toContain('6.');
  });
  test('nur 2 in Folge → nichts', () => {
    expect(runCoach(st(['2026-09-06', '2026-10-02', '2026-11-06']), NOW)).toEqual([]);
  });
});

describe('Coach: Vor-Ort-Aufpreis', () => {
  const job = (id: string, invoiceId: string): Job => ({ id, vehicleId: 'v-bot', contactId: 'd-mueller', service: 'Zulassung', location: 'onsite', priceCents: 9900, status: 'paid', doneAt: '2026-11-03T10:00:00Z', invoiceIds: [invoiceId] });
  test('Summe aller Vor-Ort-Aufträge ohne Aufpreis', () => {
    const r = runCoach(
      stateWith({
        jobs: [job('j1', 'i1'), job('j2', 'i2'), job('j3', 'i3')],
        invoices: [inv('i1', 9900, { issuedOn: '2026-11-03', text: 'Zulassung' }), inv('i2', 9900, { issuedOn: '2026-11-03' }), inv('i3', 13400, { issuedOn: '2026-11-03', text: 'Zulassung inkl. Vor-Ort-Aufpreis' })],
      }),
      NOW,
    );
    expect(types(r)).toEqual(['coach_onsite_surcharge']);
    expect(r[0].amountCents).toBe(2 * ONSITE_SURCHARGE_CENTS);
    expect(r[0].title).toContain('70,00 €');
    expect(r[0].dedupeKey).toBe('coach:onsite:j1,j2');
  });
});

describe('Coach: Rechnungsverzug', () => {
  const job = (id: string, doneAt: string): Job => ({ id, vehicleId: 'v-bot', contactId: 'd-mueller', service: 'Zulassung', location: 'bottrop', priceCents: 8900, status: 'invoiced', doneAt, invoiceIds: [`i-${id}`] });
  const jobs = [job('a', '2026-11-02T10:00:00Z'), job('b', '2026-11-03T10:00:00Z'), job('c', '2026-11-04T10:00:00Z')];
  test('≥ 3 Stichproben, Schnitt > 1 Tag → Vorschlag', () => {
    const invoices = jobs.map((j) => inv(`i-${j.id}`, 8900, { issuedOn: '2026-11-06' }));
    const r = runCoach(stateWith({ jobs, invoices }), NOW);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: 'coach_invoice_delay', dedupeKey: 'coach:invoice_delay:all' });
  });
  test('nur 2 Stichproben → nichts', () => {
    const invoices = jobs.slice(0, 2).map((j) => inv(`i-${j.id}`, 8900, { issuedOn: '2026-11-06' }));
    expect(runCoach(stateWith({ jobs: jobs.slice(0, 2), invoices }), NOW)).toEqual([]);
  });
  test('Schnitt ≤ 1 Tag → nichts', () => {
    const invoices = jobs.map((j) => inv(`i-${j.id}`, 8900, { issuedOn: j.doneAt!.slice(0, 10) }));
    expect(runCoach(stateWith({ jobs, invoices }), NOW)).toEqual([]);
  });
});

test('unterdrückte Coach-Schlüssel erscheinen nicht', () => {
  const s = stateWith({ messages: [out('a', '2026-11-06T10:00:00Z'), out('b', '2026-11-09T10:00:00Z'), out('c', '2026-11-11T10:00:00Z')] });
  const key = runCoach(s, NOW)[0].dedupeKey;
  expect(runCoach({ ...s, settings: { ...s.settings, suppressedCoachKeys: [key] } }, NOW)).toEqual([]);
});
