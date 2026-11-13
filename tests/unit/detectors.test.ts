import { describe, expect, test } from 'vitest';
import { reconcileInsights, runDetectors, selectTop } from '@/domain/detectors';
import { buildMatchContext } from '@/domain/detectors/payments';
import { detectInvoiceOverdue } from '@/domain/detectors/invoices';
import { detectMemberOverdue, memberView } from '@/domain/detectors/members';
import type { Connection, OrderConfirmation, PortalMember } from '@/domain/types';
import { detectPortalAbNoInvoice, detectPortalNoInvoice } from '@/domain/detectors/portal';
import { detectStaleSources } from '@/domain/detectors/sources';
import type { StoredInsight } from '@/domain/types';
import { NOW_0930, base, conn, find, inv, ins, member, muellerDone, schmidtIn, stateWith, tx, types, workshop } from './helpers';

const run = (p: Parameters<typeof stateWith>[0]) => runDetectors(stateWith(p), NOW_0930);

describe('Detektoren', () => {
  test('reply_waiting: Händler nach 3 Std. = now', () => {
    const r = find(run({ messages: [schmidtIn] }), 'reply_waiting');
    expect(r.priority).toBe('now');
    expect(r.dedupeKey).toBe('reply:m-schmidt-1');
    expect(r.title).toBe('Autohaus Schmidt wartet seit 3 Std. auf Antwort');
    expect(r.nextStep).toBe('Antwort senden');
  });
  test('veraltete Quelle → kein Hinweis aus ihr', () => {
    expect(types(run({ jobs: [muellerDone], connections: [conn({ id: 'lexware_zulassung', status: 'error' })] }))).not.toContain('job_not_invoiced');
  });
  test('Teilrechnung reicht nicht', () => {
    expect(find(run({ jobs: [{ ...muellerDone, invoiceIds: ['i40'] }], invoices: [inv('i40', 4000)] }), 'job_not_invoiced').amountCents).toBe(4900);
  });
  test('voll abgerechnet → kein Hinweis', () => {
    expect(types(run({ jobs: [{ ...muellerDone, invoiceIds: ['i89'] }], invoices: [inv('i89', 8900)] }))).not.toContain('job_not_invoiced');
  });
  test('member_overdue: ein Mitglied → nur Einzelhinweis', () => {
    const r = run({ contracts: [{ ...base, contactId: 'm-kaya', startDate: '2026-09-01' }] }).filter((i) => i.type === 'member_overdue');
    expect(r.map((i) => i.dedupeKey)).toEqual(['overdue:c1']);
    expect(r[0].priority).toBe('info');
    expect(r[0].amountCents).toBe(90000);
    expect(r[0].body).toContain('Rückstand');
  });
  test('member_overdue: zwei Mitglieder → Sammelhinweis', () => {
    const r = run({ contracts: [{ ...base, contactId: 'm-kaya', startDate: '2026-09-01' }, { ...base, id: 'c2', contactId: 'm-yilmaz', startDate: '2026-09-01' }] }).filter((i) => i.type === 'member_overdue');
    expect(r).toHaveLength(3);
    const all = r.find((i) => i.dedupeKey === 'overdue:all:2026-11-12')!;
    expect(all.priority).toBe('today');
    expect(all.title).toBe('2 Mitglieder überfällig, zusammen 1.800,00 €');
    expect(all.amountCents).toBe(180000);
  });
  test('Stripe-Zahlung ohne Allocation → kein unmatched_payment', () => {
    expect(types(run({ payments: [tx({ source: 'stripe', connectionId: 'stripe_nexus' })] }))).not.toContain('unmatched_payment');
  });
  test('ausgeblendete Buchung und Rückbuchung (Betrag ≤ 0) melden keinen Hinweis', () => {
    expect(types(run({ payments: [tx({ payerName: 'Fremd', ignoredAt: '2026-11-12T08:00:00Z' })] }))).not.toContain('unmatched_payment');
    expect(types(run({ payments: [tx({ payerName: 'Fremd', amountCents: -500, refundOf: 'x0' })] }))).not.toContain('unmatched_payment');
    expect(find(run({ payments: [tx({ payerName: 'Fremd' })] }), 'unmatched_payment').needsSources).toEqual(['bank_qonto']);
  });
  test('memberView nutzt Allocations und Ausnahmen', () => {
    const s = stateWith({ contracts: [base], payments: [tx({ id: 'p1', bookedOn: '2026-10-01' })], allocations: [{ paymentId: 'p1', contractId: 'c1', amountCents: 30000, method: 'auto' }] });
    expect(memberView(s, 'c1', '2026-11-12').status.paidCents).toBe(30000);
  });
  test('unmatched_payment: ohne Treffer ja, mit high nein', () => {
    expect(types(run({ payments: [tx({ payerName: 'Unbekannt GmbH' })] }))).toContain('unmatched_payment');
    const s = {
      contracts: [{ ...base, contactId: 'm-kaya', startDate: '2026-11-01' }],
      ibanLinks: [{ iban: 'DE89370400440532013000', contactId: 'm-kaya', confirmedAt: 'x' }],
      payments: [tx({ iban: 'DE89370400440532013000', amountCents: 30000 })],
    };
    expect(types(run(s))).not.toContain('unmatched_payment');
  });
  test('stripe_paid_lexware_open', () => {
    const s = { invoices: [inv('l1', 5000, { company: 'nexus', connectionId: 'lexware_nexus', number: 'RE-100', contactId: 'm-kaya' })], payments: [tx({ source: 'stripe', connectionId: 'stripe_nexus', reference: 'RE-100' })] };
    expect(find(run(s), 'stripe_paid_lexware_open').dedupeKey).toBe('stripe-lex:l1');
    expect(types(run({ ...s, invoices: [{ ...s.invoices[0], settledByPaymentId: 'p1' }] }))).not.toContain('stripe_paid_lexware_open');
  });
  test('double_invoice', () => {
    const a = inv('l1', 5000, { company: 'nexus', connectionId: 'lexware_nexus', contactId: 'm-kaya' });
    const b = inv('s1', 5000, { company: 'nexus', source: 'stripe', connectionId: 'stripe_nexus', contactId: 'm-kaya', issuedOn: '2026-11-15' });
    expect(find(run({ invoices: [a, b] }), 'double_invoice').dedupeKey).toBe('double:l1:s1');
    expect(types(run({ invoices: [a, { ...b, issuedOn: '2026-11-30' }] }))).not.toContain('double_invoice');
  });
  test('Datumsangaben in Hinweistexten sind deutsch formatiert', () => {
    const stripe = { invoices: [inv('l1', 5000, { company: 'nexus', connectionId: 'lexware_nexus', number: 'RE-100', contactId: 'm-kaya' })], payments: [tx({ source: 'stripe', connectionId: 'stripe_nexus', reference: 'RE-100' })] };
    expect(find(run(stripe), 'stripe_paid_lexware_open').body).toContain('am 12.11.2026,');
    expect(find(run({ invoices: [inv('a', 1000, { dueDate: '2026-11-01' })] }), 'invoice_overdue').body).toBe('Älteste Fälligkeit 01.11.2026 (11 Tage überfällig).');
    const c = { id: 'k1', messageId: 'm-schmidt-1', contactId: 'd-schmidt', kind: 'invoice' as const, text: 'Rechnung schicken', dueAt: '2026-11-11T17:00:00.000Z', status: 'open' as const };
    const body = find(run({ messages: [schmidtIn], commitments: [c] }), 'commitment_broken').body;
    expect(body).toBe('„Rechnung schicken“, zugesagt bis 11.11.2026, 18:00 Uhr.');
    for (const i of run({ ...stripe, messages: [schmidtIn], commitments: [c] })) expect(`${i.title} ${i.body}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  test('invoice_overdue fasst pro Kontakt zusammen', () => {
    const r = run({ invoices: [inv('a', 1000, { dueDate: '2026-11-01' }), inv('b', 2000, { dueDate: '2026-11-05' })] }).filter((i) => i.type === 'invoice_overdue');
    expect(r).toHaveLength(1);
    expect(r[0].amountCents).toBe(3000);
    expect(r[0].dedupeKey).toBe('inv-over:d-mueller');
  });
  test('NEXUS: ein Sammelhinweis mit Anzahl und Summe', () => {
    const r = detectInvoiceOverdue(stateWith({ invoices: [workshop, { ...workshop, id: 'i-2', number: 'RE-1102', openCents: 60000, totalCents: 60000, text: 'Event-Ticket' }] }), NOW_0930).filter((i) => i.company === 'nexus');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ dedupeKey: 'inv-over:nexus', title: '2 Rechnungen überfällig, zusammen 749,00 €', priority: 'today', needsSources: ['lexware_nexus'], amountCents: 74900, nextStep: 'Offene Forderungen ansehen' });
    expect(r[0].refs).toHaveLength(2);
    expect(r[0].refs.every((x) => x.href === '/nexus/offen')).toBe(true);
  });
  test('NEXUS: abgedeckte Mitgliedsrechnung und bezahlte zählen nicht', () => {
    const covered = { ...member('RE-1043'), contactExternalId: 'c-77', dueDate: '2026-10-01', status: 'overdue' as const };
    const st = stateWith({
      contracts: [{ ...base, id: 'k77', contactId: 'm-kaya', origin: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] }],
      invoices: [covered, { ...workshop, status: 'paid', openCents: 0 }],
    });
    expect(detectInvoiceOverdue(st, NOW_0930).filter((i) => i.company === 'nexus')).toHaveLength(0);
    const one = detectInvoiceOverdue({ ...st, invoices: [covered, workshop] }, NOW_0930).filter((i) => i.company === 'nexus');
    expect(one).toHaveLength(1);
    expect(one[0].title).toBe('1 Rechnung überfällig, zusammen 149,00 €');
  });
  test('call_slides_missing: heute now, morgen today', () => {
    const call = (id: string, startsAt: string) => ({ id, series: 's', startsAt, topic: 'T', slideCount: 5, slidesStatus: 'todo' as const, slides: [] });
    const r = run({ calls: [call('c-heute', '2026-11-12T17:00:00Z'), call('c-morgen', '2026-11-13T17:00:00Z'), call('c-spaet', '2026-11-20T17:00:00Z')] }).filter((i) => i.type === 'call_slides_missing');
    expect(r.map((i) => [i.dedupeKey, i.priority])).toEqual([['slides:c-heute', 'now'], ['slides:c-morgen', 'today']]);
  });
  test('commitment_broken: offen überfällig oder broken', () => {
    const c = { id: 'k1', messageId: 'm-schmidt-1', contactId: 'd-schmidt', kind: 'invoice' as const, text: 'Rechnung schicken', dueAt: '2026-11-12T06:00:00Z', status: 'open' as const };
    expect(types(run({ messages: [schmidtIn], commitments: [c] }))).toContain('commitment_broken');
    expect(types(run({ messages: [schmidtIn], commitments: [{ ...c, dueAt: '2026-11-13T06:00:00Z' }] }))).not.toContain('commitment_broken');
    expect(types(run({ messages: [schmidtIn], commitments: [{ ...c, dueAt: '2026-11-13T06:00:00Z', status: 'broken' }] }))).toContain('commitment_broken');
  });
  test('stale_source: Fehler ja, missing nein', () => {
    const r = run({ connections: [conn({ id: 'gmail', status: 'error' }), conn({ id: 'icloud', status: 'missing', lastSuccessAt: null })] }).filter((i) => i.type === 'stale_source');
    expect(r.map((i) => i.dedupeKey)).toEqual(['stale:gmail']);
  });
  test('stale:portal_nexus hat eigenen Text', () => {
    const r = run({ connections: [conn({ id: 'portal_nexus', status: 'connected', lastSuccessAt: '2026-10-01T08:00:00Z' }), conn({ id: 'gmail', status: 'connected', lastSuccessAt: '2026-11-12T07:00:00Z' })] }).filter((i) => i.type === 'stale_source');
    expect(r.find((i) => i.dedupeKey === 'stale:portal_nexus')?.body).toBe('Die Mitgliederliste ist älter als 30 Tage. Bitte neu einfügen.');
    expect(r.find((i) => i.dedupeKey === 'stale:gmail')?.body).toBe('Der letzte erfolgreiche Abruf ist älter als 45 Minuten.');
  });
});

describe('Rückstand je Vertragsquelle', () => {
  const stripeContractOverdue = (status: Partial<Record<Connection['id'], Connection['status']>>) =>
    stateWith({
      contracts: [{ ...base, contactId: 'm-kaya', billing: 'stripe', startDate: '2026-09-01' }],
      connections: stateWith().connections.map((c) => ({ ...c, status: status[c.id] ?? c.status })),
    });
  test('Rückstand-Hinweis braucht nur die Quelle des Vertrags', () => {
    const st = stripeContractOverdue({ bank_qonto: 'missing', stripe_nexus: 'connected' });
    expect(runDetectors(st, NOW_0930).some((i) => i.type === 'member_overdue')).toBe(true);
    expect(detectMemberOverdue(st, NOW_0930)[0].needsSources).toEqual(['stripe_nexus']);
  });
  test('Sammelhinweis bleibt bei fehlender Bank, wenn Stripe-Verträge überfällig sind', () => {
    const st = stripeContractOverdue({ bank_qonto: 'missing', stripe_nexus: 'connected' });
    const two = {
      ...st,
      contracts: [
        st.contracts[0],
        { ...st.contracts[0], id: 'c2', contactId: 'm-yilmaz' },
        { ...st.contracts[0], id: 'c3', contactId: 'm-kaya', billing: 'legacy' as const },
      ],
    };
    const all = runDetectors(two, NOW_0930).filter((i) => i.dedupeKey.startsWith('overdue:all:'));
    expect(all).toHaveLength(1);
    expect(all[0].title).toMatch(/^2 Mitglieder/);
    expect(all[0].needsSources).toEqual(['stripe_nexus']);
    expect(all[0].refs.map((r) => r.id)).toEqual(['c1', 'c2']);
  });
  test('Legacy-Vertrag ohne Bank → kein Rückstand-Hinweis', () => {
    const st = stateWith({
      contracts: [{ ...base, contactId: 'm-kaya', startDate: '2026-09-01' }],
      connections: stateWith().connections.map((c) => (c.id === 'bank_qonto' ? { ...c, status: 'missing' as const } : c)),
    });
    expect(detectMemberOverdue(st, NOW_0930)[0].needsSources).toEqual(['bank_qonto']);
    expect(runDetectors(st, NOW_0930).some((i) => i.type === 'member_overdue')).toBe(false);
  });
});

describe('Lebenszyklus', () => {
  test('neu → open, weg → done, dismissed bleibt, Duplikate kollabieren', () => {
    const r1 = reconcileInsights([], [ins('k1')], NOW_0930);
    expect(r1[0].status).toBe('open');
    const r2 = reconcileInsights(r1, [], NOW_0930);
    expect(r2[0].status).toBe('done');
    expect(r2[0].resolvedAt).toBeDefined();
    expect(reconcileInsights([{ ...r1[0], status: 'dismissed' }], [ins('k1')], NOW_0930)[0].status).toBe('dismissed');
    expect(reconcileInsights([{ ...r1[0], status: 'dismissed' }], [], NOW_0930)[0].status).toBe('done');
    expect(reconcileInsights(r1, [ins('k1'), ins('k1')], NOW_0930)).toHaveLength(1);
  });
  test('dismissed: gleiche Episode bleibt weg, nach Lücke kehrt der Hinweis zurück', () => {
    const r1 = reconcileInsights([], [ins('k1', { needsSources: ['bank_qonto'] })], NOW_0930);
    const dismissed: StoredInsight[] = [{ ...r1[0], status: 'dismissed' }];
    expect(reconcileInsights(dismissed, [ins('k1', { needsSources: ['bank_qonto'] })], NOW_0930)[0].status).toBe('dismissed');
    const gap = reconcileInsights(dismissed, [], NOW_0930);
    expect(gap[0].status).toBe('done');
    expect(reconcileInsights(gap, [ins('k1', { needsSources: ['bank_qonto'] })], NOW_0930)[0].status).toBe('open');
    // Quelle veraltet: unklar, ob die Episode vorbei ist → bleibt dismissed
    expect(reconcileInsights(dismissed, [], NOW_0930, ['bank_qonto'])[0].status).toBe('dismissed');
  });
  test('offen + Quelle veraltet → stale statt done', () => {
    const r1 = reconcileInsights([], [ins('k1', { needsSources: ['bank_qonto'] })], NOW_0930);
    expect(reconcileInsights(r1, [], NOW_0930, ['bank_qonto'])[0].status).toBe('stale');
    expect(reconcileInsights(r1, [], NOW_0930, ['gmail'])[0].status).toBe('done');
  });
  test('done und stale kehren zurück → open', () => {
    const r1 = reconcileInsights([], [ins('k1')], NOW_0930);
    const done = reconcileInsights(r1, [], NOW_0930);
    expect(reconcileInsights(done, [ins('k1')], NOW_0930)[0]).toMatchObject({ status: 'open' });
    expect(reconcileInsights(done, [ins('k1')], NOW_0930)[0].resolvedAt).toBeUndefined();
    const stale: StoredInsight[] = [{ ...r1[0], status: 'stale' }];
    expect(reconcileInsights(stale, [ins('k1')], NOW_0930)[0].status).toBe('open');
  });
  test('open/snoozed: Status bleibt, Inhalt wird aktualisiert', () => {
    const r1 = reconcileInsights([], [ins('k1')], NOW_0930);
    const snoozed: StoredInsight[] = [{ ...r1[0], status: 'snoozed' }];
    const r = reconcileInsights(snoozed, [ins('k1', { title: 'neu' })], NOW_0930);
    expect(r[0]).toMatchObject({ status: 'snoozed', title: 'neu' });
  });
  test('selectTop: Priorität, Betrag, Alter, nur open', () => {
    const mk = (k: string, priority: 'now' | 'today' | 'info', amountCents: number, status: StoredInsight['status'] = 'open'): StoredInsight => ({ ...ins(k, { priority, amountCents }), status, createdAt: '2026-11-12T08:00:00Z' });
    const list = [mk('a', 'info', 9), mk('b', 'today', 100), mk('c', 'now', 5), mk('d', 'now', 50), mk('e', 'now', 999, 'done'), mk('f', 'today', 200)];
    expect(selectTop(list).map((i) => i.dedupeKey)).toEqual(['d', 'c', 'f']);
  });
});

test('Fehler-Hinweis erst ab 3 Fehlversuchen, Demo-Störung (ohne sync) sofort', () => {
  const c = (failures?: number) => conn({ id: 'stripe_nexus', company: 'nexus', label: 'Stripe NEXUS', status: 'error', lastSuccessAt: null, lastError: 'x', ...(failures === undefined ? {} : { sync: { cursor: null, complete: true, failures } }) });
  const n = (failures?: number) => detectStaleSources(stateWith({ connections: [c(failures)] }), NOW_0930).length;
  expect(n(2)).toBe(0);
  expect(n(3)).toBe(1);
  expect(n()).toBe(1);
});

describe('Sparkasse-Auszug Frische', () => {
  test('Auszug älter als 7 Tage → Info-Hinweis mit Auszugsdatum', () => {
    const s = stateWith({ connections: [conn({ id: 'bank_sparkasse', lastSuccessAt: '2026-11-04T09:00:00Z', sync: { cursor: '2026-11-03', complete: true, failures: 0 } })] });
    const r = detectStaleSources(s, NOW_0930);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: 'Sparkasse-Auszug ist älter als 7 Tage – neuen hochladen', body: 'Letzter Auszug bis 03.11. Neuen Export (CAMT oder CSV) hochladen.', priority: 'info', company: 'zulassung', needsSources: [] });
  });
  test('ohne Cursor kürzerer Text', () => {
    const s = stateWith({ connections: [conn({ id: 'bank_sparkasse', lastSuccessAt: '2026-11-04T09:00:00Z' })] });
    expect(detectStaleSources(s, NOW_0930)[0].body).toBe('Neuen Export (CAMT oder CSV) hochladen.');
  });
  test('nie hochgeladen → kein Hinweis', () => {
    expect(detectStaleSources(stateWith({ connections: [conn({ id: 'bank_sparkasse', status: 'missing', lastSuccessAt: null })] }), NOW_0930)).toEqual([]);
  });
  test('frischer Auszug → kein Hinweis', () => {
    expect(detectStaleSources(stateWith({ connections: [conn({ id: 'bank_sparkasse', lastSuccessAt: '2026-11-10T09:00:00Z' })] }), NOW_0930)).toEqual([]);
  });
});

describe('buildMatchContext', () => {
  test('Schlüssel Vertrags-ID, abgedeckte Rechnungen mit contractId', () => {
    const covered = member('RE-1043');
    const s = stateWith({
      contracts: [{ ...base, id: 'k77', contactId: 'm-kaya', origin: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] }],
      invoices: [covered, workshop, { ...member('RE-1044'), status: 'paid' }],
    });
    const c = buildMatchContext(s, NOW_0930);
    expect([...c.expected.keys()]).toEqual(['k77']);
    expect(c.expected.get('k77')).toMatchObject({ contactId: 'm-kaya', rateCents: 30000 });
    expect(c.invoices.map((i) => i.id)).toEqual(['RE-1043', 'i-ws']);
    expect(c.invoices[0]).toMatchObject({ contractId: 'k77', openCents: 0 });
    expect(c.invoices[1]).toMatchObject({ contractId: null, openCents: 14900 });
  });
});

describe('Portal: Mitglieder ohne Rechnung', () => {
  const OLD = '2026-10-01T08:00:00.000Z';
  const NEW = '2026-11-12T08:00:00.000Z';
  const pm = (email: string, name: string, lastSeenInListAt = NEW): PortalMember =>
    ({ id: `pm-${email}`, connectionId: 'portal_nexus', externalId: email, email, name, firstSeenAt: OLD, lastSeenInListAt });
  const portal = (members: PortalMember[], extra: Parameters<typeof stateWith>[0] = {}) => stateWith({
    portalMembers: members,
    connections: [conn({ id: 'portal_nexus', status: 'connected', lastSuccessAt: '2026-11-12T08:00:00Z' }), conn({ id: 'lexware_nexus' })],
    ...extra,
  });
  const murat = { ...base, id: 'c-murat', contactId: 'm-kaya', origin: [{ connectionId: 'portal_nexus' as const, externalId: 'murat@x.de' }] };

  test('ein Sammelhinweis; ignorierte, Verträge und Nicht-mehr-in-Liste zählen nicht', () => {
    const s = portal(
      [pm('neu@x.de', 'Neu Eins'), pm('x@x.de', 'Xaver Zwei'), pm('alt@x.de', 'Alt Drei', OLD), pm('team@x.de', 'Team'), pm('murat@x.de', 'Murat')],
      { ignoredPortalMembers: ['team@x.de'], contracts: [murat] },
    );
    const r = detectPortalNoInvoice(s);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      dedupeKey: 'portal-no-invoice', type: 'portal_no_invoice', company: 'nexus', priority: 'info', title: '2 Mitglieder ohne Rechnung',
      body: 'Neu Eins, Xaver Zwei', nextStep: 'Mitglieder ohne Rechnung ansehen', needsSources: ['portal_nexus', 'lexware_nexus'],
      refs: [{ kind: 'member', href: '/nexus/mitglieder', label: 'Portal-Mitglieder' }],
    });
  });
  test('keiner ohne Rechnung: kein Hinweis; einer: Einzahl; mehr als drei: und N weitere', () => {
    expect(detectPortalNoInvoice(portal([]))).toEqual([]);
    expect(detectPortalNoInvoice(portal([pm('murat@x.de', 'Murat')], { contracts: [murat] }))).toEqual([]);
    expect(detectPortalNoInvoice(portal([pm('a@x.de', 'Anna')]))[0].title).toBe('1 Mitglied ohne Rechnung');
    const five = detectPortalNoInvoice(portal(['a', 'b', 'c', 'd', 'e'].map((k) => pm(`${k}@x.de`, `Name ${k}`))))[0];
    expect(five.title).toBe('5 Mitglieder ohne Rechnung');
    expect(five.body).toBe('Name a, Name b, Name c und 2 weitere');
  });
  test('runDetectors: Hinweis da; Portal-Liste älter als 30 Tage: unterdrückt', () => {
    const members = [pm('a@x.de', 'Anna')];
    expect(runDetectors(portal(members), NOW_0930).map((i) => i.dedupeKey)).toContain('portal-no-invoice');
    const stale = portal(members, { connections: [conn({ id: 'portal_nexus', status: 'connected', lastSuccessAt: '2026-10-12T08:00:00Z' }), conn({ id: 'lexware_nexus' })] });
    expect(runDetectors(stale, NOW_0930).map((i) => i.dedupeKey)).not.toContain('portal-no-invoice');
  });
});

describe('Portal: Mitglieder mit AB, aber ohne Rechnung', () => {
  const AT = '2026-11-12T08:00:00.000Z';
  const pm = (email: string, name: string, lastSeenInListAt = AT): PortalMember =>
    ({ id: `pm-${email}`, connectionId: 'portal_nexus', externalId: email, email, name, firstSeenAt: AT, lastSeenInListAt });
  const k = (id: string, email: string) => ({ id, company: 'nexus' as const, kind: 'member' as const, name: id, phones: [], emails: [email] });
  const ab = (id: string, contactId: string, number: string): OrderConfirmation =>
    ({ id, company: 'nexus', connectionId: 'lexware_nexus', externalId: id, contactExternalId: id, contactId, number, totalCents: 50000, issuedOn: '2026-07-01', status: 'open', text: 'Workshop' });
  const s = (members: PortalMember[], extra: Parameters<typeof stateWith>[0] = {}) => stateWith({
    portalMembers: members,
    contacts: [k('k-a', 'a@x.de'), k('k-b', 'b@x.de'), k('k-c', 'c@x.de')],
    orderConfirmations: [ab('o1', 'k-a', 'AB-1'), ab('o2', 'k-b', 'AB-2'), ab('o3', 'k-c', 'AB-3')],
    connections: [conn({ id: 'portal_nexus', status: 'connected', lastSuccessAt: '2026-11-12T08:00:00Z' }), conn({ id: 'lexware_nexus' })],
    ...extra,
  });

  test('ein Sammelhinweis ohne Datum im Schlüssel; Ausgeblendete und Nicht-mehr-in-Liste zählen nicht', () => {
    const r = detectPortalAbNoInvoice(s([pm('a@x.de', 'Anna'), pm('b@x.de', 'Berta'), pm('c@x.de', 'Carl', '2026-10-01T08:00:00.000Z')], { ignoredPortalMembers: ['b@x.de'] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      dedupeKey: 'ab-ohne-rechnung', type: 'portal_ab_no_invoice', company: 'nexus', priority: 'info',
      title: '1 Mitglied mit Auftragsbestätigung, aber ohne Rechnung', body: 'Anna (AB-1)',
      refs: [{ kind: 'member', href: '/nexus/mitglieder', label: 'Portal-Mitglieder' }], needsSources: ['portal_nexus', 'lexware_nexus'],
    });
    const two = detectPortalAbNoInvoice(s([pm('a@x.de', 'Anna'), pm('b@x.de', 'Berta')]))[0];
    expect(two.title).toBe('2 Mitglieder mit Auftragsbestätigung, aber ohne Rechnung');
  });
  test('keine AB ohne Rechnung → kein Hinweis; runDetectors enthält den Schlüssel', () => {
    expect(detectPortalAbNoInvoice(s([]))).toEqual([]);
    expect(detectPortalAbNoInvoice(s([pm('a@x.de', 'Anna')], { invoices: [inv('i-9', 10000, { company: 'nexus', connectionId: 'lexware_nexus', contactId: 'k-a' })] }))).toEqual([]);
    expect(runDetectors(s([pm('a@x.de', 'Anna')]), NOW_0930).map((i) => i.dedupeKey)).toContain('ab-ohne-rechnung');
  });
});
