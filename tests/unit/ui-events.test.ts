import { describe, expect, it } from 'vitest';
import { demoAI } from '@/ai/demo-ai';
import { createDemoState } from '@/data/seed';
import { refresh } from '@/data/engine';
import { jobInvoiceDraftAction, reminderAction, replyAction, stripePlanAction } from '@/domain/action-factory';
import { todayBerlin } from '@/domain/clock';
import { memberView } from '@/domain/detectors';
import type { StoreEvent } from '@/domain/events';
import { planTakeover } from '@/domain/ledger/takeover';
import { isClientEvent } from '@/server/state-service';
import { NOW_0930 as NOW } from './helpers';

/**
 * Jedes Ereignis, das die Oberfläche im Echtmodus sendet, in der Form der Seiten gebaut (Fabriken mit `isDemo: false`).
 * Fällt hier eins durch, lehnt `/api/events` es mit 400 ab.
 */
describe('UI-Ereignisse im Echtmodus bestehen isClientEvent', () => {
  const s = refresh(createDemoState(), NOW, false);
  const today = todayBerlin(NOW);
  const lastIn = s.messages.filter((m) => m.direction === 'in').at(-1)!;
  const contact = s.contacts.find((c) => c.id === lastIn.contactId) ?? null;
  const contract = s.contracts.find((c) => memberView(s, c.id, today).status.arrearsCents > 0)!;
  const view = memberView(s, contract.id, today);
  const job = s.jobs[0];
  const call = s.calls[0];

  const events = async (): Promise<[string, StoreEvent][]> => [
    ['Antwort anlegen', { type: 'createAction', action: replyAction({ lastIn, contact, threadId: lastIn.threadId, text: 'Ja.', at: NOW, isDemo: false }) }],
    ['Erinnerung anlegen', { type: 'createAction', action: reminderAction({ contract, contact: view.contact!, status: view.status, text: 'Hallo', at: NOW, isDemo: false }) }],
    ['Rechnungsentwurf Auftrag', { type: 'createAction', action: jobInvoiceDraftAction({ job, contactName: 'Autohaus', plate: 'K-AB 1', restCents: 5000, at: NOW, isDemo: false }) }],
    ['Stripe-Ratenplan', { type: 'createAction', action: stripePlanAction({ contract, name: 'X', mode: 'first_rate', rates: planTakeover(view.states, today, 'first_rate').rates, at: NOW, isDemo: false }) }],
    ['Freigeben', { type: 'approveAction', id: 'reply-1', version: 1, via: 'app' }],
    ['Ändern', { type: 'editAction', id: 'reply-1', payload: { text: 'Neu' } }],
    ['Erneut versuchen', { type: 'retryAction', id: 'reply-1' }],
    ['Prüfen', { type: 'checkAction', id: 'reply-1' }],
    ['Buchung ausblenden', { type: 'dismissPayment', paymentId: 'p-1' }],
    ['Zahlung bestätigen', { type: 'confirmPaymentMatch', paymentId: 'p-1', contractId: contract.id }],
    ['Rechnung erledigt', { type: 'settleInvoice', invoiceId: 'i-1', paymentId: 'p-1' }],
    ['Rechnung zuordnen', { type: 'linkInvoiceToJob', jobId: job.id, invoiceId: 'i-1' }],
    ['Auftragsstatus', { type: 'setJobStatus', jobId: job.id, status: 'done' }],
    ['Hinweis erledigt', { type: 'dismissInsight', key: 'k' }],
    ['Hinweis später', { type: 'snoozeInsight', key: 'k' }],
    ['Coach nie', { type: 'suppressCoach', key: 'k' }],
    ['Folien Entwurf', { type: 'setSlides', callId: call.id, slides: await demoAI.slidesFor(call), status: 'draft' }],
    ['Folien kopiert', { type: 'setSlides', callId: call.id, slides: call.slides, status: 'copied' }],
    ['Schwelle', { type: 'updateSettings', patch: { replyThresholdHours: 4 } }],
    ['Inhaber-Nummer', { type: 'updateSettings', patch: { ownerPhone: '+491511234567' } }],
    ['Briefings', { type: 'updateSettings', patch: { briefingsEnabled: false } }],
    ['Coach zurücksetzen', { type: 'updateSettings', patch: { suppressedCoachKeys: [] } }],
  ];

  it('alle erlaubt', async () => {
    const rejected = (await events()).filter(([, e]) => !isClientEvent(JSON.parse(JSON.stringify(e)))).map(([n]) => n);
    expect(rejected).toEqual([]);
  });

  it('Demo-Werkzeuge sind keine Client-Ereignisse (im Echtmodus ausgeblendet)', () => {
    const demoOnly: StoreEvent[] = [
      { type: 'resetDemo' },
      { type: 'simulateTransfer', iban: 'DE1', payerName: 'X', amountCents: 100 },
      { type: 'setConnectionStatus', id: 'bank_qonto', status: 'error' },
      { type: 'assistantOutbound', text: 'Briefing' },
      { type: 'assistantInbound', from: '+4917099999', text: 'Hallo' },
    ];
    for (const e of demoOnly) expect(isClientEvent(e)).toBe(false);
  });
});
