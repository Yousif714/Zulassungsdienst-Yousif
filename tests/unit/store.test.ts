import { describe, expect, test } from 'vitest';
import { createDemoState } from '@/data/seed';
import { STORE_KEY, loadInitial, reducer, refresh } from '@/data/store';
import type { AppState, Invoice } from '@/domain/types';
import type { Action } from '@/domain/types';
import { NOW_0930 as NOW, contractOf, isOpen } from './helpers';

const s = refresh(createDemoState(), NOW);

const draft = (p: Partial<Action> = {}): Action => ({
  id: 'a-1', type: 'send_whatsapp', company: 'zulassung', title: 'Antwort an Autohaus Schmidt',
  payload: { contactId: 'd-schmidt', threadId: 't-schmidt', channel: 'whatsapp', text: 'Ja, der Golf ist ab 14 Uhr fertig.' },
  version: 1, status: 'draft', createdAt: NOW.toISOString(), isDemo: true, ...p,
});

describe('Store-Abläufe aus dem Brief', () => {
  test('Zahlung bestätigen, IBAN lernen, nächste Überweisung automatisch', () => {
    const s2 = reducer(s, { type: 'confirmPaymentMatch', paymentId: 'p-yilmaz-1', contractId: contractOf(s, 'm-yilmaz') });
    expect(s2.allocations.at(-1)).toMatchObject({ paymentId: 'p-yilmaz-1', method: 'confirmed', amountCents: 30000 });
    expect(s2.ibanLinks.some((l) => l.iban === 'DE02120300000000202051' && l.contactId === 'm-yilmaz')).toBe(true);
    expect(isOpen(s2, 'unmatched:p-yilmaz-1')).toBe(false);
    const s3 = reducer(s2, { type: 'simulateTransfer', iban: 'DE02120300000000202051', payerName: 'Selin Yilmaz', amountCents: 30000 });
    expect(s3.allocations.at(-1)).toMatchObject({ method: 'auto', contractId: contractOf(s, 'm-yilmaz'), amountCents: 30000 });
    expect(s3.audit.some((a) => a.text === 'Automatisch zugeordnet: Selin Yilmaz')).toBe(true);
  });
  test('Rechnung dem Auftrag zuordnen', () => {
    const r = reducer(s, { type: 'linkInvoiceToJob', jobId: 'j-mueller-1', invoiceId: 'i-z-311' });
    expect(isOpen(r, 'job-inv:j-mueller-1')).toBe(false);
    expect(r.jobs.find((j) => j.id === 'j-mueller-1')!.invoiceIds).toEqual(['i-z-311']);
  });
  test('Stripe bezahlt → Lexware erledigt', () => {
    const r = reducer(s, { type: 'settleInvoice', invoiceId: 'i-lex-118', paymentId: 'p-stripe-118' });
    expect(isOpen(r, 'stripe-lex:i-lex-118')).toBe(false);
    expect(r.invoices.find((i) => i.id === 'i-lex-118')).toMatchObject({ status: 'paid', openCents: 0, settledByPaymentId: 'p-stripe-118' });
  });
  test('Wieder verbinden setzt den Stand auf jetzt (frisch)', () => {
    const old = { ...s, connections: s.connections.map((c) => (c.id === 'lexware_zulassung' ? { ...c, lastSuccessAt: '2026-11-12T06:00:00.000Z' } : c)) };
    const err = reducer(old, { type: 'setConnectionStatus', id: 'lexware_zulassung', status: 'error' });
    const back = reducer(err, { type: 'setConnectionStatus', id: 'lexware_zulassung', status: 'connected' });
    const c = back.connections.find((x) => x.id === 'lexware_zulassung')!;
    expect(c).toMatchObject({ status: 'connected', lastSuccessAt: NOW.toISOString() });
    expect(c.lastError).toBeUndefined();
  });
  test('Störung unterdrückt Hinweis (stale, nicht erledigt)', () => {
    const r = reducer(s, { type: 'setConnectionStatus', id: 'lexware_zulassung', status: 'error' });
    expect(isOpen(r, 'job-inv:j-mueller-1')).toBe(false);
    expect(r.insights.find((i) => i.dedupeKey === 'job-inv:j-mueller-1')!.status).toBe('stale');
    const back = reducer(r, { type: 'setConnectionStatus', id: 'lexware_zulassung', status: 'connected' });
    expect(isOpen(back, 'job-inv:j-mueller-1')).toBe(true);
  });
});

describe('Aktionen', () => {
  test('anlegen, freigeben, ausführen → ausgehende Nachricht, Hinweis zu, Protokoll', () => {
    let r = reducer(s, { type: 'createAction', action: draft() });
    expect(isOpen(r, 'reply:m-schmidt-in-1')).toBe(true);
    r = reducer(r, { type: 'approveAction', id: 'a-1', version: 1, via: 'app' });
    expect(r.actions.find((a) => a.id === 'a-1')!.status).toBe('approved');
    r = reducer(r, { type: 'actionExecuted', id: 'a-1', result: 'ok' });
    expect(r.actions.find((a) => a.id === 'a-1')!.status).toBe('executed');
    const m = r.messages.at(-1)!;
    expect(m).toMatchObject({ direction: 'out', threadId: 't-schmidt', channel: 'whatsapp', body: 'Ja, der Golf ist ab 14 Uhr fertig.', contactId: 'd-schmidt' });
    expect(isOpen(r, 'reply:m-schmidt-in-1')).toBe(false);
    expect(r.audit.some((a) => a.text.startsWith('Gesendet (Demo):') && a.text.includes('Autohaus Schmidt') && a.isDemo)).toBe(true);
  });
  test('Thread fehlt → t-<contactId>', () => {
    let r = reducer(s, { type: 'createAction', action: draft({ type: 'send_reminder', payload: { contactId: 'm-kaya', channel: 'whatsapp', text: 'Erinnerung' } }) });
    r = reducer(r, { type: 'approveAction', id: 'a-1', version: 1, via: 'app' });
    r = reducer(r, { type: 'actionExecuted', id: 'a-1', result: 'ok' });
    expect(r.messages.at(-1)!.threadId).toBe('t-m-kaya');
  });
  test('alte Version → abgelehnt, Protokoll, Aktion unverändert', () => {
    let r = reducer(s, { type: 'createAction', action: draft() });
    r = reducer(r, { type: 'editAction', id: 'a-1', payload: { ...draft().payload, text: 'neu' } });
    expect(r.actions[0].version).toBe(2);
    const before = r.actions[0];
    r = reducer(r, { type: 'approveAction', id: 'a-1', version: 1, via: 'app' });
    expect(r.actions[0]).toEqual(before);
    expect(r.audit.at(-1)!.text).toMatch(/^Abgelehnt: /);
  });
  test('Fehler → failed, keine Nachricht', () => {
    let r = reducer(s, { type: 'createAction', action: draft() });
    r = reducer(r, { type: 'approveAction', id: 'a-1', version: 1, via: 'app' });
    const n = r.messages.length;
    r = reducer(r, { type: 'actionExecuted', id: 'a-1', result: 'error' });
    expect(r.actions[0].status).toBe('failed');
    expect(r.messages).toHaveLength(n);
  });
  test('link_invoice_to_job als Aktion', () => {
    let r = reducer(s, { type: 'createAction', action: draft({ type: 'link_invoice_to_job', payload: { jobId: 'j-mueller-1', invoiceId: 'i-z-311' } }) });
    r = reducer(r, { type: 'approveAction', id: 'a-1', version: 1, via: 'app' });
    r = reducer(r, { type: 'actionExecuted', id: 'a-1', result: 'ok' });
    expect(isOpen(r, 'job-inv:j-mueller-1')).toBe(false);
  });
});

describe('Hinweise, Coach und Rest', () => {
  test('dismiss und snooze', () => {
    expect(reducer(s, { type: 'dismissInsight', key: 'slides:call-seele' }).insights.find((i) => i.dedupeKey === 'slides:call-seele')!.status).toBe('dismissed');
    expect(reducer(s, { type: 'snoozeInsight', key: 'slides:call-seele' }).insights.find((i) => i.dedupeKey === 'slides:call-seele')!.status).toBe('snoozed');
  });
  test('Coach unterdrücken', () => {
    const key = s.insights.find((i) => i.type === 'coach_quick_reply')!.dedupeKey;
    const r = reducer(s, { type: 'suppressCoach', key });
    expect(r.settings.suppressedCoachKeys).toContain(key);
    expect(isOpen(r, key)).toBe(false);
    expect(r.insights.find((i) => i.dedupeKey === key)!.status).toBe('dismissed');
  });
  test('Folien setzen', () => {
    const r = reducer(s, { type: 'setSlides', callId: 'call-seele', slides: [{ position: 1, title: 'Folie 1: Start', body: 'x' }], status: 'draft' });
    expect(r.calls[0]).toMatchObject({ slidesStatus: 'draft', slides: [{ position: 1 }] });
    expect(isOpen(r, 'slides:call-seele')).toBe(false);
  });
  test('Auftragsstatus', () => {
    expect(reducer(s, { type: 'setJobStatus', jobId: 'j-schmidt-1', status: 'done' }).jobs.find((j) => j.id === 'j-schmidt-1')!.status).toBe('done');
  });
  test('Assistent-Nachrichten', () => {
    const r = reducer(reducer(s, { type: 'assistantInbound', from: '+491510000000', text: 'Hallo' }), { type: 'assistantOutbound', text: 'Hi' });
    expect(r.assistantChat.map((m) => [m.direction, m.text])).toEqual([['from_owner', 'Hallo'], ['to_owner', 'Hi']]);
    expect(reducer(s, { type: 'assistantInbound', from: '+4917099999', text: 'x' }).assistantChat[0].direction).toBe('ignored');
  });
  test('jedes Ereignis protokolliert', () => {
    const r = reducer(s, { type: 'setJobStatus', jobId: 'j-schmidt-1', status: 'done' });
    expect(r.audit.at(-1)).toMatchObject({ actor: 'owner', isDemo: true });
  });
  test('resetDemo', () => {
    const r = reducer(reducer(s, { type: 'dismissInsight', key: 'slides:call-seele' }), { type: 'resetDemo' });
    expect(JSON.stringify(r)).toBe(JSON.stringify(refresh(createDemoState(), NOW)));
  });
});

describe('Zusagen', () => {
  const demirInv = (issuedOn: string): Invoice => ({
    id: 'i-z-demir', company: 'zulassung', source: 'lexware', connectionId: 'lexware_zulassung', externalId: 'lex-demir', contactId: 'p-demir',
    number: 'RE-Z-2026-320', totalCents: 4900, openCents: 4900, issuedOn, dueDate: '2026-11-26', status: 'open',
  });
  test('offen → eingehalten, wenn die Rechnung rechtzeitig kommt', () => {
    const fresh = createDemoState();
    const r = refresh({ ...fresh, invoices: [...fresh.invoices, demirInv('2026-11-11')] }, NOW);
    expect(r.commitments.find((c) => c.id === 'c-demir')!.status).toBe('kept');
    expect(isOpen(r, 'commit:c-demir')).toBe(false);
  });
  test('gebrochen → eingehalten, wenn die Rechnung nachgeholt wird; Hinweis schließt', () => {
    expect(s.commitments.find((c) => c.id === 'c-demir')!.status).toBe('broken');
    expect(isOpen(s, 'commit:c-demir')).toBe(true);
    const r = refresh({ ...s, invoices: [...s.invoices, demirInv('2026-11-12')] }, NOW);
    expect(r.commitments.find((c) => c.id === 'c-demir')!.status).toBe('kept');
    expect(isOpen(r, 'commit:c-demir')).toBe(false);
  });
});

describe('loadInitial', () => {
  const memStorage = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const old = (): AppState => reducer(s, { type: 'dismissInsight', key: 'slides:call-seele' });
  const status = (st: AppState) => st.insights.find((i) => i.dedupeKey === 'slides:call-seele')!.status;

  test('reset=1 → frische Demo, sofort gespeichert; zweiter Lauf ohne Parameter (StrictMode) behält sie', () => {
    const storage = memStorage({ [STORE_KEY]: JSON.stringify(old()) });
    const first = loadInitial(storage, '?reset=1', NOW);
    expect(first.stripReset).toBe(true);
    expect(status(first.state)).toBe('open');
    expect(JSON.parse(storage.m.get(STORE_KEY)!)).toEqual(first.state);
    const second = loadInitial(storage, '', NOW);
    expect(second.stripReset).toBe(false);
    expect(status(second.state)).toBe('open');
  });
  test('kaputtes JSON → Demo-Daten', () => {
    const r = loadInitial(memStorage({ [STORE_KEY]: '{kaputt' }), '', NOW);
    expect(JSON.stringify(r.state)).toBe(JSON.stringify(refresh(createDemoState(), NOW)));
  });
  test('leerer Speicher → Demo-Daten', () => {
    expect(JSON.stringify(loadInitial(memStorage(), '', NOW).state)).toBe(JSON.stringify(refresh(createDemoState(), NOW)));
  });
  test('normaler Start → gespeicherter Zustand, neu abgeglichen', () => {
    const stored = old();
    const raw = { ...stored, insights: stored.insights.filter((i) => i.dedupeKey !== 'reply:m-schmidt-in-1') };
    const r = loadInitial(memStorage({ [STORE_KEY]: JSON.stringify(raw) }), '?foo=1', NOW);
    expect(r.stripReset).toBe(false);
    expect(status(r.state)).toBe('dismissed');
    expect(isOpen(r.state, 'reply:m-schmidt-in-1')).toBe(true);
  });
});
