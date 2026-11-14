import type { AIProvider, AITools } from './ai-port';
import { contractsOfContact, membershipContractOf } from './ledger/contracts';
import { newId } from './ids';
import { reminderAction, reminderActionId } from './action-factory';
import { REJECT_REASON_DE, approve } from './actions/machine';
import { todayBerlin } from './clock';
import { memberView } from './detectors';
import type { InboundChannel, StoreEvent } from './events';
import { normalizePhone, validPhone } from './matching/messages';
import { paymentLinkFor } from './payment-link';
import type { Action, AppState, AssistantMessage, Contact, IsoDate, MemberContract } from './types';

type Button = NonNullable<AssistantMessage['buttons']>[number];
type LinkRef = NonNullable<AssistantMessage['links']>[number];

const words = (t: string) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Mitglied, dessen Vor- oder Nachname als ganzes Wort im Text steht; bei mehreren Verträgen der mit dem höchsten Rückstand (9a). */
function findMember(s: AppState, text: string, today: IsoDate): { contract: MemberContract; contact: Contact } | null {
  const w = new Set(words(text));
  for (const first of s.contracts) {
    const contact = s.contacts.find((c) => c.id === first.contactId && c.kind === 'member');
    if (!contact || !words(contact.name).some((n) => w.has(n))) continue;
    const all = contractsOfContact(s, contact.id);
    const arrears = (c: MemberContract) => memberView(s, c.id, today).status.arrearsCents;
    const contract = all.reduce((best, c) => (arrears(c) > arrears(best) ? c : best), membershipContractOf(s, contact.id) ?? first);
    return { contract, contact };
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

/**
 * `channel`: `'whatsapp'` prüft den Absender gegen die Inhaber-Nummer (ohne gültige Nummer gilt niemand als Inhaber).
 * `'app'` nur für Eingaben aus einer angemeldeten Sitzung: der Absender ist dort bereits als Inhaber authentifiziert.
 * `isDemo`: Kennzeichen neu angelegter Entwürfe.
 */
export type InboundOptions = { channel: InboundChannel; isDemo: boolean };

export async function handleInbound(
  s: AppState, from: string, text: string, now: Date, ai: AIProvider, tools: AITools, opts: InboundOptions,
): Promise<{ events: StoreEvent[]; reply: AssistantMessage | null }> {
  const inbound: StoreEvent = { type: 'assistantInbound', from, text, ...(opts.channel === 'app' ? { channel: 'app' as const } : {}) };
  // Der Store legt fremde Absender als `ignored` ab und protokolliert sie.
  if (opts.channel !== 'app') {
    const owner = validPhone(s.settings.ownerPhone);
    if (owner === null || normalizePhone(from) !== owner) return { events: [inbound], reply: null };
  }

  const member = isReminderCommand(text) ? findMember(s, text, todayBerlin(now)) : null;
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
      contract, contact, status, at: now, isDemo: opts.isDemo,
      text: await ai.draftReminder({ contact, status, tone: 'freundlich', paymentLink: paymentLinkFor(s, contract.id) }),
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
  // Vertrag der Erinnerung (Hinweis overdue:<id>), sonst der Mitgliedsvertrag des Kontakts.
  const fromInsight = a.insightKey?.startsWith('overdue:') ? s.contracts.find((c) => c.id === a.insightKey!.slice('overdue:'.length)) : undefined;
  const contract = fromInsight ?? (p.contactId ? membershipContractOf(s, p.contactId) : undefined);
  if (a.type === 'send_reminder' && contract) return `/nexus/mitglieder/${contract.id}`;
  return p.threadId ? `/nachrichten/${p.threadId}` : '/';
}

/** Link „Entwurf öffnen“ zu einer Aktion (Knopf „Ändern“ und Echtmodus-Chat ohne Knöpfe); null, wenn es sie nicht gibt. */
export function draftLink(s: AppState, actionId: string): LinkRef | null {
  const a = s.actions.find((x) => x.id === actionId);
  return a ? { label: 'Entwurf öffnen', href: editHref(s, a) } : null;
}

const invalid = (reason: string) => `Dieser Knopf ist nicht mehr gültig (${reason.replace(/\.$/, '')}). Ich habe nichts gesendet.`;

export function handleButton(s: AppState, b: Button, now: Date): { events: StoreEvent[]; reply: AssistantMessage } {
  const a = s.actions.find((x) => x.id === b.actionId);
  if (!a) return deliver(s, [], invalid('Die Aktion gibt es nicht mehr.'), now);

  if (b.label === 'Später') return deliver(s, [], 'Okay, ich erinnere dich später.', now);
  if (b.label === 'Ändern') {
    return deliver(s, [], 'Zum Ändern öffne den Entwurf in der App.', now, { links: [draftLink(s, a.id)!] });
  }

  const approveEvent: StoreEvent = { type: 'approveAction', id: a.id, version: b.version, via: 'whatsapp', buttonIssuedAt: b.issuedAt };
  const r = approve(a, { version: b.version, via: 'whatsapp', buttonIssuedAt: b.issuedAt }, now);
  // Auch die Ablehnung läuft durch den Store, damit sie im Protokoll steht.
  if (!r.ok) return deliver(s, [approveEvent], invalid(REJECT_REASON_DE[r.reason]), now);
  const contact = s.contacts.find((c) => c.id === (a.payload as { contactId?: string }).contactId);
  return deliver(s, [approveEvent], `Gesendet (Demo): ${contact?.name ?? a.title}`, now);
}
