import { describe, expect, test } from 'vitest';
import { demoAI } from '@/ai/demo-ai';
import { createStateTools } from '@/ai/tools';
import { paymentLinkFor } from '@/domain/payment-link';
import { createDemoState } from '@/data/seed';
import { reducer, refresh, type StoreEvent } from '@/data/store';
import { draftLink, handleButton, handleInbound } from '@/domain/assistant';
import type { AppState } from '@/domain/types';
import { NOW_0930 as NOW, drain, stateWith } from './helpers';

const apply = (st: AppState, events: StoreEvent[]) => events.reduce(reducer, st);
// Ohne automatisch angelegte Erinnerungsentwürfe: die Tests prüfen nur ihre eigenen Aktionen.
const s: AppState = { ...refresh(createDemoState(), NOW), actions: [] };
/** Aktionen ohne die automatisch angelegten Erinnerungsentwürfe (`refresh`). */
const own = (st: AppState) => st.actions.filter((a) => !a.id.startsWith('upcoming-') && !a.id.startsWith('link-nudge-'));
const OWNER = '+491510000000';
/** WhatsApp-Kanal im Demo-Modus: Absender wird gegen die Inhaber-Nummer geprüft. */
const WA = { channel: 'whatsapp', isDemo: true } as const;
/** Ausgehende Nachricht mit dem Text der Aktion (IDs sind UUIDs und tragen keine Aktions-ID mehr). */
const isSentOf = (st: AppState, actionId: string, m: AppState['messages'][number]) =>
  m.direction === 'out' && m.body === String(st.actions.find((a) => a.id === actionId)!.payload.text);

describe('handleInbound', () => {
  test('Brief: fremde Nummer → kein Reply; Erinnerung mit Knöpfen; alter Knopf ungültig', async () => {
    expect((await handleInbound(s, '+4917099999', 'Hallo', NOW, demoAI, createStateTools(s, NOW), WA)).reply).toBeNull();
    const r = await handleInbound(s, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI, createStateTools(s, NOW), WA);
    expect(r.reply!.buttons!.map((b) => b.label)).toEqual(['Senden', 'Ändern', 'Später']);
    const btn = r.reply!.buttons![0];
    expect(handleButton(apply(s, r.events), { ...btn, issuedAt: '2026-11-11T07:00:00Z' }, NOW).reply.text).toContain('nicht mehr gültig');
  });

  test('fremde Nummer: ignorierte Nachricht und Protokolleintrag, keine Antwort', async () => {
    const r = await handleInbound(s, '+4917099999', 'Hallo, wer ist da?', NOW, demoAI, createStateTools(s, NOW), WA);
    const st = apply(s, r.events);
    expect(st.assistantChat).toHaveLength(1);
    expect(st.assistantChat[0]).toMatchObject({ direction: 'ignored', from: '+4917099999' });
    expect(st.assistantChat[0].text).toContain('ignoriert');
    expect(st.audit.at(-1)!.text).toContain('ignoriert');
    expect(own(st)).toHaveLength(0);
  });

  test('Erinnerung ohne Rückstand: keine Aktion, kurze Antwort', async () => {
    const r = await handleInbound(s, OWNER, 'Schick Anna Schulz die Erinnerung', NOW, demoAI, createStateTools(s, NOW), WA);
    expect(r.reply!.text).toBe('Anna Schulz hat keinen Rückstand – keine Erinnerung nötig.');
    expect(r.reply!.buttons).toBeUndefined();
    expect(r.events.some((e) => e.type === 'createAction')).toBe(false);
    expect(own(apply(s, r.events))).toHaveLength(0);
  });

  test('Inhaber mit anderer Schreibweise der Nummer wird erkannt', async () => {
    const r = await handleInbound(s, '0151 0000000', 'Wer ist überfällig?', NOW, demoAI, createStateTools(s, NOW), WA);
    expect(r.reply).not.toBeNull();
  });

  test('Erinnerung: Entwurf mit Task-14-Id, Payload, Knöpfe mit Version und Zeit', async () => {
    const r = await handleInbound(s, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI, createStateTools(s, NOW), WA);
    const st = apply(s, r.events);
    const a = own(st).find((x) => x.type === 'send_reminder')!;
    expect(a.id).toBe('reminder-mc-kaya-2026-11-01');
    expect(a.status).toBe('draft');
    const kaya = s.contacts.find((c) => c.id === 'm-kaya')!;
    const status = (await import('@/domain/detectors')).memberView(s, 'mc-kaya', '2026-11-12').status;
    const text = await demoAI.draftReminder({ contact: kaya, status, tone: 'freundlich', paymentLink: paymentLinkFor(stateWith(), 'mc-kaya') });
    expect(a.payload).toEqual({ threadId: 't-m-kaya', channel: 'whatsapp', contactId: 'm-kaya', text });
    expect(r.reply!.text).toContain(text);
    expect(r.reply!.buttons).toEqual(['Senden', 'Ändern', 'Später'].map((label) => ({ label, actionId: a.id, version: 1, issuedAt: NOW.toISOString() })));
    expect(st.assistantChat.map((m) => m.direction)).toEqual(['from_owner', 'to_owner']);
    expect(st.assistantChat[1].buttons).toEqual(r.reply!.buttons);
  });

  test('Frage geht an ai.answer, Links strukturiert an der Nachricht', async () => {
    const r = await handleInbound(s, OWNER, 'Wer ist überfällig?', NOW, demoAI, createStateTools(s, NOW), WA);
    const ans = await demoAI.answer('Wer ist überfällig?', { now: NOW, tools: createStateTools(s, NOW) });
    expect(ans.links.length).toBeGreaterThan(0);
    expect(r.reply!.text).toBe(ans.text);
    expect(r.reply!.links).toEqual(ans.links);
    expect(r.reply!.buttons).toBeUndefined();
    const st = apply(s, r.events);
    expect(st.assistantChat.map((m) => [m.direction, m.text])).toEqual([['from_owner', 'Wer ist überfällig?'], ['to_owner', r.reply!.text]]);
    expect(st.assistantChat[1].links).toEqual(ans.links);
  });
});

describe('handleButton', () => {
  async function withDraft() {
    const r = await handleInbound(s, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI, createStateTools(s, NOW), WA);
    return { st: apply(s, r.events), buttons: r.reply!.buttons! };
  }

  test('Senden → freigegeben über WhatsApp, ausgeführt, „Gesendet (Demo)“', async () => {
    const { st, buttons } = await withDraft();
    const r = handleButton(st, buttons[0], NOW);
    expect(r.events.slice(0, 1)).toEqual([
      { type: 'approveAction', id: buttons[0].actionId, version: 1, via: 'whatsapp', buttonIssuedAt: buttons[0].issuedAt },
    ]);
    expect(r.reply.text).toBe('Gesendet (Demo): Mehmet Kaya');
    const after = await drain(apply(st, r.events));
    expect(after.actions.find((a) => a.id === buttons[0].actionId)).toMatchObject({ status: 'executed', approvedVia: 'whatsapp' });
    expect(after.assistantChat.at(-1)).toMatchObject({ direction: 'to_owner', text: 'Gesendet (Demo): Mehmet Kaya' });
    // Knopfdruck erzeugt keine Inhaber-Nachricht
    expect(after.assistantChat.filter((m) => m.direction === 'from_owner')).toHaveLength(1);
  });

  test('schon freigegebene Erinnerung → Hinweis mit Link zur Mitgliedsseite', async () => {
    const { st, buttons } = await withDraft();
    const sent = await drain(apply(st, handleButton(st, buttons[0], NOW).events));
    const r = await handleInbound(sent, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI, createStateTools(sent, NOW), WA);
    expect(r.reply!.text).toBe('Die Erinnerung an Mehmet Kaya ist schon freigegeben.');
    expect(r.reply!.links).toEqual([{ label: 'Mehmet Kaya', href: '/nexus/mitglieder/mc-kaya' }]);
    expect(apply(sent, r.events).assistantChat.at(-1)!.links).toEqual(r.reply!.links);
  });

  test('derselbe Knopf zweimal → nicht mehr gültig, nichts gesendet', async () => {
    const { st, buttons } = await withDraft();
    const once = await drain(apply(st, handleButton(st, buttons[0], NOW).events));
    const r = handleButton(once, buttons[0], NOW);
    expect(r.reply.text).toBe('Dieser Knopf ist nicht mehr gültig (Die Aktion wurde bereits freigegeben). Ich habe nichts gesendet.');
    const after = await drain(apply(once, r.events));
    expect(after.messages.filter((m) => isSentOf(after, buttons[0].actionId, m))).toHaveLength(1);
  });

  test('abgelaufener Knopf → Grund auf Deutsch', async () => {
    const { st, buttons } = await withDraft();
    const r = handleButton(st, { ...buttons[0], issuedAt: '2026-11-11T07:00:00Z' }, NOW);
    expect(r.reply.text).toBe('Dieser Knopf ist nicht mehr gültig (Der Knopf ist abgelaufen). Ich habe nichts gesendet.');
    expect(apply(st, r.events).actions.find((a) => a.id === buttons[0].actionId)!.status).toBe('draft');
  });

  test('Ändern → Link zur Mitgliedsseite; Später → später erinnern', async () => {
    const { st, buttons } = await withDraft();
    const edit = handleButton(st, buttons[1], NOW).reply;
    expect(edit.text).toBe('Zum Ändern öffne den Entwurf in der App.');
    expect(edit.links).toEqual([{ label: 'Entwurf öffnen', href: '/nexus/mitglieder/mc-kaya' }]);
    const later = handleButton(st, buttons[2], NOW);
    expect(later.reply.text).toBe('Okay, ich erinnere dich später.');
    expect(apply(st, later.events).actions.find((a) => a.id === buttons[0].actionId)!.status).toBe('draft');
  });
});

describe('Store: Einstellungen', () => {
  test('updateSettings ändert nur die übergebenen Felder und protokolliert', () => {
    const r = reducer(s, { type: 'updateSettings', patch: { replyThresholdHours: 4, briefingsEnabled: false } });
    expect(r.settings).toEqual({ ...s.settings, replyThresholdHours: 4, briefingsEnabled: false });
    expect(r.audit.at(-1)).toMatchObject({ actor: 'owner', isDemo: true });
    expect(r.audit.at(-1)!.text).toContain('Einstellungen');
  });
});

describe('Fix-Runde 1', () => {
  test('Doppelklick auf Senden: der Store wertet den Knopf mit dem frischesten Stand aus', async () => {
    const r = await handleInbound(s, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI, createStateTools(s, NOW), WA);
    const st = apply(s, r.events);
    const btn = r.reply!.buttons![0];
    // Beide Klicks entstehen aus demselben (veralteten) Seitenstand.
    const after = await drain(apply(st, [{ type: 'assistantButton', button: btn }, { type: 'assistantButton', button: btn }]));
    const replies = after.assistantChat.filter((m) => m.direction === 'to_owner').map((m) => m.text);
    expect(replies.filter((t) => t.startsWith('Gesendet (Demo)'))).toHaveLength(1);
    expect(replies.at(-1)).toBe('Dieser Knopf ist nicht mehr gültig (Die Aktion wurde bereits freigegeben). Ich habe nichts gesendet.');
    expect(after.messages.filter((m) => isSentOf(after, btn.actionId, m))).toHaveLength(1);
    expect(after.assistantChat.filter((m) => m.direction === 'from_owner')).toHaveLength(1);
  });

  test('updateSettings: leere oder ungültige Inhaber-Nummer wird nicht übernommen', () => {
    for (const bad of ['', '   ', 'abc']) {
      const r = reducer(s, { type: 'updateSettings', patch: { ownerPhone: bad, replyThresholdHours: 3 } });
      expect(r.settings.ownerPhone).toBe(s.settings.ownerPhone);
      expect(r.settings.replyThresholdHours).toBe(3);
      expect(r.audit.at(-1)!.text).toContain('Inhaber-Nummer ungültig');
    }
    expect(reducer(s, { type: 'updateSettings', patch: { ownerPhone: '0151 2222222' } }).settings.ownerPhone).toBe('0151 2222222');
  });

  test('ohne Inhaber-Nummer wird jede Nachricht ignoriert, auch ein leerer Absender', async () => {
    const noOwner = { ...s, settings: { ...s.settings, ownerPhone: '' } };
    for (const from of ['', OWNER]) {
      const r = await handleInbound(noOwner, from, 'Wer ist überfällig?', NOW, demoAI, createStateTools(noOwner, NOW), WA);
      expect(r.reply).toBeNull();
      expect(apply(noOwner, r.events).assistantChat.at(-1)!.direction).toBe('ignored');
    }
  });
});

describe('In-App-Kanal (angemeldeter Inhaber) und isDemo', () => {
  const noOwner = { ...s, settings: { ...s.settings, ownerPhone: '' } };
  const APP = { channel: 'app', isDemo: false } as const;

  test('App-Kanal: Antwort auch ohne gespeicherte Inhaber-Nummer, Eingang als Inhaber-Nachricht', async () => {
    const r = await handleInbound(noOwner, 'App', 'Wer ist überfällig?', NOW, demoAI, createStateTools(noOwner, NOW), APP);
    expect(r.reply).not.toBeNull();
    const chat = apply(noOwner, r.events).assistantChat.slice(-2);
    expect(chat.map((m) => m.direction)).toEqual(['from_owner', 'to_owner']);
    expect(chat[0].text).toBe('Wer ist überfällig?');
  });

  test('WhatsApp-Kanal bleibt geschützt: fremde Nummer und fehlende Inhaber-Nummer → ignoriert', async () => {
    for (const st of [s, noOwner]) {
      const r = await handleInbound(st, '+4917099999', 'Hallo', NOW, demoAI, createStateTools(st, NOW), { channel: 'whatsapp', isDemo: false });
      expect(r.reply).toBeNull();
      expect(apply(st, r.events).assistantChat.at(-1)!.direction).toBe('ignored');
    }
  });

  test('Store: Eingang ohne App-Kanal von fremder Nummer bleibt ignoriert', () => {
    const st = reducer(noOwner, { type: 'assistantInbound', from: '+4917099999', text: 'Hallo' });
    expect(st.assistantChat.at(-1)!.direction).toBe('ignored');
  });

  test('isDemo wird an den Erinnerungsentwurf weitergegeben', async () => {
    for (const isDemo of [true, false]) {
      const r = await handleInbound(s, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI, createStateTools(s, NOW), { channel: 'whatsapp', isDemo });
      const created = r.events.find((e) => e.type === 'createAction');
      expect(created?.type === 'createAction' && created.action.isDemo).toBe(isDemo);
    }
  });

  test('draftLink: derselbe Entwurfs-Link wie beim Knopf „Ändern“', async () => {
    const r = await handleInbound(s, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI, createStateTools(s, NOW), WA);
    const st = apply(s, r.events);
    const id = r.reply!.buttons![0].actionId;
    expect(draftLink(st, id)).toEqual({ label: 'Entwurf öffnen', href: '/nexus/mitglieder/mc-kaya' });
    expect(handleButton(st, r.reply!.buttons![1], NOW).reply.links).toEqual([draftLink(st, id)]);
    expect(draftLink(st, 'gibt-es-nicht')).toBeNull();
  });
});

describe('Erinnerung bei laufender Stripe-Abbuchung (I1)', () => {
  test('„Erinnerung“ bei set_up mit Rückstand → keine Aktion, Hinweis auf Stripe', async () => {
    const contract = s.contracts.find((c) => c.id === 'mc-kaya')!;
    const takeover: AppState['takeovers'][number] = {
      id: 'stripe-takeover-mc-kaya-1', contractId: contract.id, contactId: contract.contactId, actionId: 'stripe-takeover-mc-kaya-1', actionVersion: 1,
      status: 'set_up', token: 'tok', link: 'https://app.example.de/zahlung/tok', mode: 'first_rate', rates: [], openCents: 0, stripeCustomerId: 'cus_test_1',
      paymentMethodId: 'pm_test_1', scheduleId: 'sub_sched_test_1', subscriptionExternalId: null, isDemo: false, linkSentAt: '2026-11-05T08:00:00Z', setUpAt: '2026-11-06T08:00:00Z',
    };
    const st = { ...s, takeovers: [takeover] };
    const r = await handleInbound(st, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI, createStateTools(st, NOW), WA);
    expect(r.events.some((e) => e.type === 'createAction')).toBe(false);
    expect(r.reply!.text).toBe('Mehmet Kaya: Raten laufen über Stripe – keine Erinnerung nötig.');
    expect(r.reply!.buttons).toBeUndefined();
  });
});
