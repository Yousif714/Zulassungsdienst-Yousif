import { describe, expect, test } from 'vitest';
import { createDemoState } from '@/data/seed';
import { customerInvoiceRows, customerPayments, partlyAllocatedPayments, invoiceCandidates, memberRows, portalRows, nexusForecast, overdueMembers, matchOptions, stripeLexCases, unallocatedBankPayments, waitingStripePayments, zulassungKpis } from '@/data/selectors';
import { reducer, refresh } from '@/data/store';
import { jobBilling } from '@/domain/billing';
import { NOW_0930 as NOW, base, inv, sptx, stateWith, tx, workshop } from './helpers';
import { confirmedSub, legacyNoBank, stripeState } from './import/helpers';

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

describe('Verträge je Quelle', () => {
  test('Legacy-Vertrag ohne Bank: notConnected', () => expect(memberRows(legacyNoBank, '2026-11-12')[0].notConnected).toBe(true));
  test('Stripe-Vertrag mit verbundener Quelle: nicht notConnected', () => {
    const st = { ...legacyNoBank, contracts: legacyNoBank.contracts.map((c) => ({ ...c, billing: 'stripe' as const })) };
    expect(memberRows(st, '2026-11-12')[0].notConnected).toBe(false);
  });
  test('overdueMembers und nexusForecast lassen notConnected-Verträge aus', () => {
    expect(memberRows(legacyNoBank, '2026-11-12')[0].traffic).not.toBe('green');
    expect(overdueMembers(legacyNoBank, '2026-11-12')).toEqual([]);
    expect(nexusForecast(legacyNoBank, '2026-11-12')).toEqual({ expectedCents: 0, atRiskCents: 0 });
    const connected = { ...legacyNoBank, connections: createDemoState().connections.map((c) => ({ ...c, status: 'connected' as const })) };
    expect(overdueMembers(connected, '2026-11-12')).toHaveLength(1);
    expect(nexusForecast(connected, '2026-11-12').expectedCents).toBeGreaterThan(0);
  });
  test('wartende Stripe-Zahlungen', () => {
    const ids = waitingStripePayments(stripeState).map((p) => p.externalId);
    expect(ids).toContain('in_A1');
    expect(ids).not.toContain('in_D1'); // Coaching-Abo: keine Mitgliedschaft
  });
  test('Erstattungen zählen nicht als wartende Zahlungen', () => {
    expect(stripeState.payments.some((p) => p.externalId === 're_B1')).toBe(true);
    expect(waitingStripePayments(stripeState).map((p) => p.externalId)).not.toContain('re_B1');
  });
  test('bestätigtes Abo: keine wartenden Zahlungen mehr', () => {
    const st = confirmedSub(stripeState, 'sub_A', 'k-ayse');
    expect(waitingStripePayments(st).map((p) => p.externalId)).not.toContain('in_A1');
  });
  test('Stripe-Zahlung ohne Abo wartet nicht', () => {
    const st = { ...stripeState, payments: stripeState.payments.map((p) => (p.externalId === 'in_A1' ? { ...p, subscriptionExternalId: undefined } : p)) };
    expect(waitingStripePayments(st).map((p) => p.externalId)).not.toContain('in_A1');
  });
});

describe('Zuordnungsziele', () => {
  test('matchOptions: Verträge und offene Rechnungen', () => {
    const o = matchOptions(stateWith({ contracts: [{ ...base, contactId: 'm-kaya' }], invoices: [workshop] }));
    expect(o.map((x) => x.value)).toEqual(expect.arrayContaining(['contract:c1', 'invoice:i-ws']));
    expect(o.find((x) => x.value === 'invoice:i-ws')!.label).toContain('RE-1101');
  });
  test('unallocatedBankPayments: ohne ausgeblendete und Rückbuchungen', () => {
    const s = stateWith({ payments: [tx({ id: 'a' }), tx({ id: 'b', ignoredAt: 'x' }), tx({ id: 'c', amountCents: -100 })] });
    expect(unallocatedBankPayments(s).map((p) => p.id)).toEqual(['a']);
  });
});

describe('Portal-Zeilen', () => {
  test('Ampel und Rückstand nur bei Vertrag', () => {
    const st = { ...stateWith({}), portalMembers: [
      { id: 'pm1', connectionId: 'portal_nexus' as const, externalId: 'murat@example.de', email: 'murat@example.de', name: 'Murat Demir', firstSeenAt: NOW.toISOString(), lastSeenInListAt: NOW.toISOString() },
      { id: 'pm2', connectionId: 'portal_nexus' as const, externalId: 'nobody@example.de', email: 'nobody@example.de', name: 'Nobody Neu', firstSeenAt: NOW.toISOString(), lastSeenInListAt: NOW.toISOString() },
    ] };
    const merged = { ...st, contacts: [...st.contacts, { id: 'kx', company: 'nexus' as const, kind: 'member' as const, name: 'Murat Demir', phones: [], emails: ['murat@example.de'] }],
      contracts: [{ id: 'cx', contactId: 'kx', totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 1, startDate: '2026-01-01', billing: 'legacy' as const, catchUpMode: 'first_rate' as const }] };
    const rows = portalRows(merged, '2026-11-12');
    const c = rows.find((r) => r.member.externalId === 'murat@example.de')!;
    const n = rows.find((r) => r.member.externalId === 'nobody@example.de')!;
    expect(c.status).toBe('contract');
    expect(c.traffic).toBe(memberRows(merged, '2026-11-12')[0].traffic);
    expect(c.arrearsCents).toBe(memberRows(merged, '2026-11-12')[0].arrearsCents);
    expect(n.traffic).toBeNull();
    expect(n.arrearsCents).toBe(0);
  });
});

describe('Kundenseite Zulassung', () => {
  const z600 = inv('i-z6', 60000, { dueDate: '2026-10-01', status: 'overdue' });
  const alloc42 = { paymentId: 'sp1', invoiceId: 'i-z6', amountCents: 42000, method: 'confirmed' as const };
  test('Kundenzeilen: Teilzahlung 420 € von 600 €', () =>
    expect(customerInvoiceRows(stateWith({ invoices: [z600], allocations: [alloc42], payments: [sptx({ amountCents: 42000 })] }), 'd-mueller')[0])
      .toMatchObject({ openCents: 18000, paidCents: 42000, invoice: { id: 'i-z6' } }));
  test('Kundenzeilen: voll bezahlte Rechnung fehlt, Sortierung nach Fälligkeit', () => {
    const rows = customerInvoiceRows(stateWith({ invoices: [inv('i-a', 1000, { dueDate: '2026-12-01' }), inv('i-b', 2000, { dueDate: '2026-11-01' }), inv('i-c', 3000, { status: 'paid', openCents: 0 })] }), 'd-mueller');
    expect(rows.map((r) => r.invoice.id)).toEqual(['i-b', 'i-a']);
  });
  test('Kundenzahlungen: Lexware-bezahlt markiert, Rückbuchung markiert, neueste zuerst', () => {
    const paidInv = inv('i-z8', 5000, { status: 'paid', openCents: 0, number: 'RE-8' });
    const s = stateWith({
      invoices: [z600, paidInv],
      payments: [sptx({ id: 'sp1', amountCents: 42000, bookedOn: '2026-11-05' }), sptx({ id: 'sp2', externalId: 'spk-2', amountCents: 5000, bookedOn: '2026-11-08' }), sptx({ id: 'sp3', externalId: 'spk-3', amountCents: -2000, bookedOn: '2026-11-10' })],
      allocations: [alloc42, { paymentId: 'sp2', invoiceId: 'i-z8', amountCents: 5000, method: 'auto' }, { paymentId: 'sp3', invoiceId: 'i-z6', amountCents: -2000, method: 'auto' }],
    });
    expect(customerPayments(s, 'd-mueller')).toEqual([
      { key: 'sp3:i-z6', bookedOn: '2026-11-10', amountCents: -2000, invoiceNumber: 'RE-i-z6', paidInLexware: false, isReturn: true },
      { key: 'sp2:i-z8', bookedOn: '2026-11-08', amountCents: 5000, invoiceNumber: 'RE-8', paidInLexware: true, isReturn: false },
      { key: 'sp1:i-z6', bookedOn: '2026-11-05', amountCents: 42000, invoiceNumber: 'RE-i-z6', paidInLexware: false, isReturn: false },
    ]);
    expect(customerPayments(s, 'd-schmidt')).toEqual([]);
  });
  test('partlyAllocatedPayments: Überzahlung 10 € Rest', () => {
    const i39 = inv('i-39', 39000);
    const s = stateWith({
      invoices: [i39],
      payments: [sptx({ id: 'sp1', amountCents: 40000 }), sptx({ id: 'sp2', externalId: 'spk-2', amountCents: 5000 }), sptx({ id: 'sp3', externalId: 'spk-3', amountCents: 8000, ignoredAt: '2026-11-11T08:00:00Z' })],
      allocations: [{ paymentId: 'sp1', invoiceId: 'i-39', amountCents: 39000, method: 'confirmed' }, { paymentId: 'sp3', invoiceId: 'i-39', amountCents: 1000, method: 'confirmed' }],
    });
    expect(partlyAllocatedPayments(s, 'zulassung').map((r) => [r.payment.id, r.restCents])).toEqual([['sp1', 1000]]);
    expect(partlyAllocatedPayments(s, 'nexus')).toEqual([]);
  });
});

describe('Umstellungs-Selektoren', () => {
  const T = '2026-11-13';
  test('takeoverRows: Status und Sperrgrund je Vertrag', async () => {
    const { paidState, applyAt, linkSentState } = await import('../fixtures/takeover-state');
    const { takeoverRows } = await import('@/data/selectors');
    // Bank verbunden, nichts vorbereitet: kein Status, kein Sperrgrund, Rest 750 €.
    const fresh = paidState();
    expect(takeoverRows(fresh, T)).toEqual([{ contractId: 'c1', name: 'Erika Muster', status: null, blockReason: null, openCents: 75000 }]);
    // Vorbereitet: Status 'prepared'.
    const prepared = applyAt(fresh, [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }]);
    expect(takeoverRows(prepared, T).map((r) => [r.status, r.blockReason])).toEqual([['prepared', null]]);
    // Link verschickt: gesperrt mit Grund.
    expect(takeoverRows(linkSentState(), T).map((r) => [r.status, r.blockReason])).toEqual([['link_sent', 'Umstellung läuft bereits.']]);
    // Bank nicht verbunden: Sperrgrund.
    const noBank = { ...fresh, connections: fresh.connections.map((c) => (c.id === 'bank_qonto' ? { ...c, status: 'missing' as const, lastSuccessAt: null } : c)) };
    expect(takeoverRows(noBank, T)[0].blockReason).toMatch(/^Bank nicht verbunden: /);
  });

  test('switchableTakeovers: wie „Alle umstellen“, auch nach Zurückziehen', async () => {
    const { paidState, applyAt } = await import('../fixtures/takeover-state');
    const { switchableTakeovers } = await import('@/data/selectors');
    const at = new Date('2026-11-13T10:00:00+01:00');
    const fresh = paidState();
    expect(switchableTakeovers(fresh, at)).toBe(1);
    const prepared = applyAt(fresh, [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }]);
    expect(switchableTakeovers(prepared, at)).toBe(0);
    const withdrawn = applyAt(prepared, [{ type: 'withdrawTakeover', contractId: 'c1' }]);
    expect(switchableTakeovers(withdrawn, at)).toBe(1);
  });

  test('openTakeoverDrafts und openUpcomingReminders', async () => {
    const { paidState, applyAt } = await import('../fixtures/takeover-state');
    const { openTakeoverDrafts, openUpcomingReminders } = await import('@/data/selectors');
    const prepared = applyAt(paidState(), [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }]);
    expect(openTakeoverDrafts(prepared).map((a) => a.id)).toEqual(['stripe-takeover-c1-1']);
    expect(openUpcomingReminders(prepared)).toEqual([]);
    const mk = (id: string, type: 'send_reminder' | 'send_email', status: 'draft' | 'executed') => ({ ...prepared.actions[0], id, type, status });
    const withDrafts = { ...prepared, actions: [
      ...prepared.actions,
      mk('upcoming-c1-2026-12-01', 'send_reminder', 'draft'),
      mk('link-nudge-t1', 'send_reminder', 'draft'),
      mk('upcoming-c1-2026-11-01', 'send_reminder', 'executed'),
      mk('reminder-c1-2026-11-01', 'send_reminder', 'draft'),
    ] };
    expect(openUpcomingReminders(withDrafts).map((a) => a.id)).toEqual(['upcoming-c1-2026-12-01', 'link-nudge-t1']);
    expect(openTakeoverDrafts({ ...withDrafts, actions: withDrafts.actions.map((a) => (a.id === 'stripe-takeover-c1-1' ? { ...a, status: 'approved' as const } : a)) })).toEqual([]);
  });
});
