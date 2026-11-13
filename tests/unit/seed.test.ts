import { describe, expect, test } from 'vitest';
import { createDemoState } from '@/data/seed';
import { refresh } from '@/data/store';
import { memberRows, openInsights } from '@/data/selectors';
import { memberView } from '@/domain/detectors';
import { NOW_0930 as NOW, contractOf, open, types } from './helpers';

describe('Demo-Daten', () => {
  const s = refresh(createDemoState(), NOW);

  test('Pflichtinhalt', () => {
    expect(s.contracts).toHaveLength(40);
    expect(memberView(s, contractOf(s, 'm-kaya'), '2026-11-12').status.arrearsCents).toBe(15000);
    expect(types(open(s))).toEqual(
      expect.arrayContaining([
        'reply_waiting', 'member_overdue', 'unmatched_payment', 'stripe_paid_lexware_open', 'job_not_invoiced',
        'call_slides_missing', 'commitment_broken', 'coach_quick_reply', 'coach_due_day', 'coach_onsite_surcharge',
      ]),
    );
    expect(s.allocations.find((a) => a.paymentId === 'p-payout-1')).toBeUndefined();
  });

  test('deterministisch', () => {
    expect(JSON.stringify(createDemoState())).toBe(JSON.stringify(createDemoState()));
  });

  test('Mitglieder gemischt, Starts Aug–Nov 2026, 6 oder 12 Raten, Sonderkonditionen, mindestens 4 gelb/rot', () => {
    const billing = new Set(s.contracts.map((c) => c.billing));
    expect(billing).toEqual(new Set(['legacy', 'stripe']));
    const others = s.contracts.filter((c) => c.contactId !== 'm-kaya');
    expect(others.every((c) => [6, 12].includes(c.installments))).toBe(true);
    expect(others.every((c) => c.totalCents >= 180000 && c.totalCents <= 600000)).toBe(true);
    expect(s.contracts.every((c) => c.startDate >= '2026-08-01' && c.startDate <= '2026-11-30')).toBe(true);
    expect(s.contracts.filter((c) => c.specialTerms).length).toBeGreaterThanOrEqual(3);
    expect(memberRows(s, '2026-11-12').filter((r) => r.traffic !== 'green').length).toBeGreaterThanOrEqual(4);
    expect(new Set(s.contracts.map((c) => c.id)).size).toBe(40);
  });

  test('Referenzfälle', () => {
    const kaya = s.contracts.find((c) => c.contactId === 'm-kaya')!;
    expect(kaya).toMatchObject({ totalCents: 120000, installments: 4, installmentCents: 30000, startDate: '2026-10-01', dueDay: 1, billing: 'legacy' });
    expect(s.ibanLinks.some((l) => l.iban === 'DE89370400440532013000' && l.contactId === 'm-kaya')).toBe(true);
    expect(s.payments.find((p) => p.id === 'p-yilmaz-1')).toMatchObject({ amountCents: 30000, payerName: 'S. Yilmaz', iban: 'DE02120300000000202051', bookedOn: '2026-11-11' });
    expect(s.ibanLinks.some((l) => l.contactId === 'm-yilmaz')).toBe(false);
    expect(s.payments.find((p) => p.id === 'p-payout-1')).toMatchObject({ kind: 'stripe_payout', amountCents: 148000 });
    expect(s.messages.find((m) => m.id === 'm-schmidt-in-1')).toMatchObject({ threadId: 't-schmidt', needsReply: true, sentAt: '2026-11-12T05:30:00.000Z' });
    expect(s.calls.map((c) => [c.id, c.slideCount, c.slidesStatus])).toEqual([['call-seele', 10, 'todo'], ['call-finance', 6, 'todo']]);
    expect(s.events.filter((e) => e.startAt.startsWith('2026-11-12'))).toHaveLength(3);
    expect(s.events.filter((e) => !e.location)).toHaveLength(1);
    expect(new Set(s.content.map((c) => c.stage)).size).toBe(5);
    expect(s.connections.filter((c) => c.id !== 'bank_sparkasse').every((c) => c.status === 'connected' && c.lastSuccessAt === '2026-11-12T08:20:00.000Z')).toBe(true);
    expect(s.connections.find((c) => c.id === 'bank_sparkasse')).toMatchObject({ status: 'missing', lastSuccessAt: null });
    expect(s.settings).toMatchObject({ replyThresholdHours: 2, briefingsEnabled: true, ownerPhone: '+491510000000' });
    const mueller = s.invoices.filter((i) => i.contactId === 'd-mueller' && i.status === 'overdue');
    expect(mueller.reduce((n, i) => n + i.openCents, 0)).toBe(64000);
    expect(s.commitments.find((c) => c.id === 'c-demir')!.status).toBe('broken');
  });

  test('Onsite-Coach nennt 105,00 €', () => {
    expect(open(s).find((i) => i.type === 'coach_onsite_surcharge')!.title).toContain('105,00 €');
  });

  test('Selektoren', () => {
    expect(openInsights(s).every((i) => i.status === 'open')).toBe(true);
    const kaya = memberRows(s, '2026-11-12').find((r) => r.contractId === contractOf(s, 'm-kaya'))!;
    expect(kaya).toEqual({ contractId: contractOf(s, 'm-kaya'), name: 'Mehmet Kaya', traffic: 'red', arrearsCents: 15000, openCents: 75000, billing: 'legacy', notConnected: false, kindLabel: 'Mitgliedschaft', onHold: false });
  });
});
