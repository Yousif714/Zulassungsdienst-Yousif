import type { AIProvider, AITools } from './ai-port';
import { newId } from './ids';
import { reminderAction, reminderActionId } from './action-factory';
import { REJECT_REASON_DE, approve } from './actions/machine';
import { todayBerlin } from './clock';
import { memberView } from './detectors';
import type { StoreEvent } from './events';
import { normalizePhone, validPhone } from './matching/messages';
import { paymentLinkFor } from './payment-link';
import type { Action, AppState, AssistantMessage, Contact, MemberContract } from './types';

type Button = NonNullable<AssistantMessage['buttons']>[number];
type LinkRef = NonNullable<AssistantMessage['links']>[number];

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

/** Die Antwort wird über `assistantOutbound` zugestellt; sie ist das letzte Ereignis. Die Id wird hier vergeben und im Ereignis mitgegeben. */
/** Links reisen strukturiert an der Nachricht (die Oberfläche zeigt sie als Karten), nicht als Text. */
function deliver(
  s: AppState, events: StoreEvent[], text: string, at: Date, extra: { buttons?: Button[]; links?: LinkRef[] } = {},
): { events: StoreEvent[]; reply: AssistantMessage } {
  const { buttons, links } = extra;
  const more = { ...(buttons ? { buttons } : {}), ...(links?.length ? { links } : {}) };
  const reply: AssistantMessage = {
    id: newId(), direction: 'to_owner', from: 'Nexus Assistent', text, at: at.toISOString(), ...more,
  };
  return { events: [...events, { type: 'assistantOutbound', id: reply.id, text, ...more }], reply };
}

export async function handleInbound(
  s: AppState, from: string, text: string, now: Date, ai: AIProvider, tools: AITools,
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
    const id = reminderActionId(contract.id, status.oldestUnpaidDue);
    const stored = s.actions.find((a) => a.id === id);
    if (stored && stored.status !== 'draft') {
      return deliver(s, [inbound], `Die Erinnerung an ${contact.name} ist schon freigegeben.`, now, {
        links: [{ label: contact.name, href: `/nexus/mitglieder/${contract.id}` }],
      });
    }
    const action: Action = stored ?? reminderAction({
      contract, contact, status, at: now, isDemo: true,
      text: await ai.draftReminder({ contact, status, tone: 'freundlich', paymentLink: paymentLinkFor(contract.id) }),
    });
    const buttons: Button[] = (['Senden', 'Ändern', 'Später'] as const).map((label) => ({ label, actionId: id, version: action.version, issuedAt: now.toISOString() }));
    const events: StoreEvent[] = stored ? [inbound] : [inbound, { type: 'createAction', action }];
    return deliver(s, events, `Entwurf: ${action.title}\n\n${String(action.payload.text ?? '')}`, now, { buttons });
  }

  const ans = await ai.answer(text, { now, tools });
  return deliver(s, [inbound], ans.text, now, { links: ans.links });
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
  if (b.label === 'Ändern') {
    return deliver(s, [], 'Zum Ändern öffne den Entwurf in der App.', now, { links: [{ label: 'Entwurf öffnen', href: editHref(s, a) }] });
  }

  const approveEvent: StoreEvent = { type: 'approveAction', id: a.id, version: b.version, via: 'whatsapp', buttonIssuedAt: b.issuedAt };
  const r = approve(a, { version: b.version, via: 'whatsapp', buttonIssuedAt: b.issuedAt }, now);
  // Auch die Ablehnung läuft durch den Store, damit sie im Protokoll steht.
  if (!r.ok) return deliver(s, [approveEvent], invalid(REJECT_REASON_DE[r.reason]), now);
  const contact = s.contacts.find((c) => c.id === (a.payload as { contactId?: string }).contactId);
  return deliver(s, [approveEvent], `Gesendet (Demo): ${contact?.name ?? a.title}`, now);
}
