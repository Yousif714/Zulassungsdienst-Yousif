import { demoPaymentLink } from '@/ai/demo-ai';
import type { AIProvider } from '@/ai/provider';
import { REJECT_REASON_DE, approve } from './actions/machine';
import { todayBerlin } from './clock';
import { memberView } from './detectors';
import type { StoreEvent } from './events';
import { normalizePhone, validPhone } from './matching/messages';
import type { Action, AppState, AssistantMessage, Contact, MemberContract } from './types';

type Button = NonNullable<AssistantMessage['buttons']>[number];

const words = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Mitglied, dessen Vor- oder Nachname als ganzes Wort im Text steht. */
function findMember(s: AppState, text: string): { contract: MemberContract; contact: Contact } | null {
  const w = new Set(words(text));
  for (const contract of s.contracts) {
    const contact = s.contacts.find((c) => c.id === contract.contactId && c.kind === 'member');
    if (contact && words(contact.name).some((n) => w.has(n))) return { contract, contact };
  }
  return null;
}

const isReminderCommand = (text: string) => {
  const t = text.toLowerCase();
  return t.includes('schick') && t.includes('erinnerung');
};

/** Die Antwort wird über `assistantOutbound` zugestellt; sie ist das letzte Ereignis. Die Id entspricht der, die der Store vergibt. */
function deliver(s: AppState, events: StoreEvent[], text: string, at: Date, buttons?: Button[]): { events: StoreEvent[]; reply: AssistantMessage } {
  const chatEvents = events.filter((e) => e.type === 'assistantInbound' || e.type === 'assistantOutbound').length;
  const reply: AssistantMessage = {
    id: `am-${s.assistantChat.length + chatEvents + 1}`, direction: 'to_owner', from: 'Nexus Assistent', text, at: at.toISOString(),
    ...(buttons ? { buttons } : {}),
  };
  return { events: [...events, { type: 'assistantOutbound', text, ...(buttons ? { buttons } : {}) }], reply };
}

export async function handleInbound(
  s: AppState, from: string, text: string, now: Date, ai: AIProvider,
): Promise<{ events: StoreEvent[]; reply: AssistantMessage | null }> {
  const inbound: StoreEvent = { type: 'assistantInbound', from, text };
  // Der Store legt fremde Absender als `ignored` ab und protokolliert sie. Ohne gültige Inhaber-Nummer gilt niemand als Inhaber.
  const owner = validPhone(s.settings.ownerPhone);
  if (owner === null || normalizePhone(from) !== owner) return { events: [inbound], reply: null };

  const member = isReminderCommand(text) ? findMember(s, text) : null;
  if (member) {
    const { contract, contact } = member;
    const status = memberView(s, contract.id, todayBerlin(now)).status;
    if (status.arrearsCents === 0) return deliver(s, [inbound], `${contact.name} hat keinen Rückstand – keine Erinnerung nötig.`, now);
    const id = `reminder-${contract.id}-${status.oldestUnpaidDue ?? 'none'}`;
    const stored = s.actions.find((a) => a.id === id);
    if (stored && stored.status !== 'draft') {
      return deliver(s, [inbound], `Die Erinnerung an ${contact.name} ist schon freigegeben. Details: /nexus/mitglieder/${contract.id}`, now);
    }
    const action: Action = stored ?? {
      id, type: 'send_reminder', company: 'nexus', title: `Erinnerung an ${contact.name}`,
      payload: {
        threadId: `t-${contact.id}`, channel: 'whatsapp', contactId: contact.id,
        text: await ai.draftReminder(contact, status, 'freundlich', demoPaymentLink(contract.id)),
      },
      version: 1, status: 'draft', createdAt: now.toISOString(), isDemo: true, insightKey: `overdue:${contract.id}`,
    };
    const buttons: Button[] = (['Senden', 'Ändern', 'Später'] as const).map((label) => ({ label, actionId: id, version: action.version, issuedAt: now.toISOString() }));
    const events: StoreEvent[] = stored ? [inbound] : [inbound, { type: 'createAction', action }];
    return deliver(s, events, `Entwurf: ${action.title}\n\n${String(action.payload.text ?? '')}`, now, buttons);
  }

  const ans = await ai.answer(text, s, now);
  const body = [ans.text, ...ans.links.map((l) => `${l.label}: ${l.href}`)].join('\n');
  return deliver(s, [inbound], body, now);
}

/** Bearbeiten-Ziel einer Aktion in der App. */
function editHref(s: AppState, a: Action): string {
  const p = a.payload as { contactId?: string; threadId?: string };
  const contract = s.contracts.find((c) => c.contactId === p.contactId);
  if (a.type === 'send_reminder' && contract) return `/nexus/mitglieder/${contract.id}`;
  return p.threadId ? `/nachrichten/${p.threadId}` : '/';
}

const invalid = (reason: string) => `Dieser Knopf ist nicht mehr gültig (${reason.replace(/\.$/, '')}). Ich habe nichts gesendet.`;

export function handleButton(s: AppState, b: Button, now: Date): { events: StoreEvent[]; reply: AssistantMessage } {
  const a = s.actions.find((x) => x.id === b.actionId);
  if (!a) return deliver(s, [], invalid('Die Aktion gibt es nicht mehr.'), now);

  if (b.label === 'Später') return deliver(s, [], 'Okay, ich erinnere dich später.', now);
  if (b.label === 'Ändern') return deliver(s, [], `Zum Ändern öffne den Entwurf in der App: ${editHref(s, a)}`, now);

  const approveEvent: StoreEvent = { type: 'approveAction', id: a.id, version: b.version, via: 'whatsapp', buttonIssuedAt: b.issuedAt };
  const r = approve(a, { version: b.version, via: 'whatsapp', buttonIssuedAt: b.issuedAt }, now);
  // Auch die Ablehnung läuft durch den Store, damit sie im Protokoll steht.
  if (!r.ok) return deliver(s, [approveEvent], invalid(REJECT_REASON_DE[r.reason]), now);
  const contact = s.contacts.find((c) => c.id === (a.payload as { contactId?: string }).contactId);
  return deliver(s, [approveEvent, { type: 'actionExecuted', id: a.id, result: 'ok' }], `Gesendet (Demo): ${contact?.name ?? a.title}`, now);
}
