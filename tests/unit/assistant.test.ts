import { describe, expect, test } from 'vitest';
import { demoAI, demoPaymentLink } from '@/ai/demo-ai';
import { createDemoState } from '@/data/seed';
import { reducer, refresh, type StoreEvent } from '@/data/store';
import { handleButton, handleInbound } from '@/domain/assistant';
import type { AppState } from '@/domain/types';
import { NOW_0930 as NOW } from './helpers';

const apply = (st: AppState, events: StoreEvent[]) => events.reduce(reducer, st);
const s = refresh(createDemoState(), NOW);
const OWNER = '+491510000000';

describe('handleInbound', () => {
  test('Brief: fremde Nummer → kein Reply; Erinnerung mit Knöpfen; alter Knopf ungültig', async () => {
    expect((await handleInbound(s, '+4917099999', 'Hallo', NOW, demoAI)).reply).toBeNull();
    const r = await handleInbound(s, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI);
    expect(r.reply!.buttons!.map((b) => b.label)).toEqual(['Senden', 'Ändern', 'Später']);
    const btn = r.reply!.buttons![0];
    expect(handleButton(apply(s, r.events), { ...btn, issuedAt: '2026-11-11T07:00:00Z' }, NOW).reply.text).toContain('nicht mehr gültig');
  });

  test('fremde Nummer: ignorierte Nachricht und Protokolleintrag, keine Antwort', async () => {
    const r = await handleInbound(s, '+4917099999', 'Hallo, wer ist da?', NOW, demoAI);
    const st = apply(s, r.events);
    expect(st.assistantChat).toHaveLength(1);
    expect(st.assistantChat[0]).toMatchObject({ direction: 'ignored', from: '+4917099999' });
    expect(st.assistantChat[0].text).toContain('ignoriert');
    expect(st.audit.at(-1)!.text).toContain('ignoriert');
    expect(st.actions).toHaveLength(0);
  });

  test('Inhaber mit anderer Schreibweise der Nummer wird erkannt', async () => {
    const r = await handleInbound(s, '0151 0000000', 'Wer ist überfällig?', NOW, demoAI);
    expect(r.reply).not.toBeNull();
  });

  test('Erinnerung: Entwurf mit Task-14-Id, Payload, Knöpfe mit Version und Zeit', async () => {
    const r = await handleInbound(s, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI);
    const st = apply(s, r.events);
    const a = st.actions.find((x) => x.type === 'send_reminder')!;
    expect(a.id).toBe('reminder-mc-kaya-2026-11-01');
    expect(a.status).toBe('draft');
    const kaya = s.contacts.find((c) => c.id === 'm-kaya')!;
    const status = (await import('@/domain/detectors')).memberView(s, 'mc-kaya', '2026-11-12').status;
    const text = await demoAI.draftReminder(kaya, status, 'freundlich', demoPaymentLink('mc-kaya'));
    expect(a.payload).toEqual({ threadId: 't-m-kaya', channel: 'whatsapp', contactId: 'm-kaya', text });
    expect(r.reply!.text).toContain(text);
    expect(r.reply!.buttons).toEqual(['Senden', 'Ändern', 'Später'].map((label) => ({ label, actionId: a.id, version: 1, issuedAt: NOW.toISOString() })));
    expect(st.assistantChat.map((m) => m.direction)).toEqual(['from_owner', 'to_owner']);
    expect(st.assistantChat[1].buttons).toEqual(r.reply!.buttons);
  });

  test('Frage geht an ai.answer, Links als „Label: href“', async () => {
    const r = await handleInbound(s, OWNER, 'Wer ist überfällig?', NOW, demoAI);
    const ans = await demoAI.answer('Wer ist überfällig?', s, NOW);
    expect(r.reply!.text).toContain(ans.text);
    expect(r.reply!.text).toContain(`${ans.links[0].label}: ${ans.links[0].href}`);
    expect(r.reply!.buttons).toBeUndefined();
    const st = apply(s, r.events);
    expect(st.assistantChat.map((m) => [m.direction, m.text])).toEqual([['from_owner', 'Wer ist überfällig?'], ['to_owner', r.reply!.text]]);
  });
});

describe('handleButton', () => {
  async function withDraft() {
    const r = await handleInbound(s, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI);
    return { st: apply(s, r.events), buttons: r.reply!.buttons! };
  }

  test('Senden → freigegeben über WhatsApp, ausgeführt, „Gesendet (Demo)“', async () => {
    const { st, buttons } = await withDraft();
    const r = handleButton(st, buttons[0], NOW);
    expect(r.events.slice(0, 2)).toEqual([
      { type: 'approveAction', id: buttons[0].actionId, version: 1, via: 'whatsapp', buttonIssuedAt: buttons[0].issuedAt },
      { type: 'actionExecuted', id: buttons[0].actionId, result: 'ok' },
    ]);
    expect(r.reply.text).toBe('Gesendet (Demo): Mehmet Kaya');
    const after = apply(st, r.events);
    expect(after.actions.find((a) => a.id === buttons[0].actionId)).toMatchObject({ status: 'executed', approvedVia: 'whatsapp' });
    expect(after.assistantChat.at(-1)).toMatchObject({ direction: 'to_owner', text: 'Gesendet (Demo): Mehmet Kaya' });
    // Knopfdruck erzeugt keine Inhaber-Nachricht
    expect(after.assistantChat.filter((m) => m.direction === 'from_owner')).toHaveLength(1);
  });

  test('derselbe Knopf zweimal → nicht mehr gültig, nichts gesendet', async () => {
    const { st, buttons } = await withDraft();
    const once = apply(st, handleButton(st, buttons[0], NOW).events);
    const r = handleButton(once, buttons[0], NOW);
    expect(r.reply.text).toBe('Dieser Knopf ist nicht mehr gültig (Die Aktion wurde bereits freigegeben). Ich habe nichts gesendet.');
    const after = apply(once, r.events);
    expect(after.messages.filter((m) => m.id.startsWith(`m-out-${buttons[0].actionId}`))).toHaveLength(1);
  });

  test('abgelaufener Knopf → Grund auf Deutsch', async () => {
    const { st, buttons } = await withDraft();
    const r = handleButton(st, { ...buttons[0], issuedAt: '2026-11-11T07:00:00Z' }, NOW);
    expect(r.reply.text).toBe('Dieser Knopf ist nicht mehr gültig (Der Knopf ist abgelaufen). Ich habe nichts gesendet.');
    expect(apply(st, r.events).actions.find((a) => a.id === buttons[0].actionId)!.status).toBe('draft');
  });

  test('Ändern → Link zur Mitgliedsseite; Später → später erinnern', async () => {
    const { st, buttons } = await withDraft();
    expect(handleButton(st, buttons[1], NOW).reply.text).toContain('/nexus/mitglieder/mc-kaya');
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
    const r = await handleInbound(s, OWNER, 'Schick Kaya die Erinnerung', NOW, demoAI);
    const st = apply(s, r.events);
    const btn = r.reply!.buttons![0];
    // Beide Klicks entstehen aus demselben (veralteten) Seitenstand.
    const after = apply(st, [{ type: 'assistantButton', button: btn }, { type: 'assistantButton', button: btn }]);
    const replies = after.assistantChat.filter((m) => m.direction === 'to_owner').map((m) => m.text);
    expect(replies.filter((t) => t.startsWith('Gesendet (Demo)'))).toHaveLength(1);
    expect(replies.at(-1)).toBe('Dieser Knopf ist nicht mehr gültig (Die Aktion wurde bereits freigegeben). Ich habe nichts gesendet.');
    expect(after.messages.filter((m) => m.id.startsWith(`m-out-${btn.actionId}`))).toHaveLength(1);
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
      const r = await handleInbound(noOwner, from, 'Wer ist überfällig?', NOW, demoAI);
      expect(r.reply).toBeNull();
      expect(apply(noOwner, r.events).assistantChat.at(-1)!.direction).toBe('ignored');
    }
  });
});
