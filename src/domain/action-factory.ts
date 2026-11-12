import type { MemberStatus } from './ledger/status';
import type { Action, Contact, IsoDate, MemberContract, Message } from './types';

// Eine Erinnerung je Rückstandsstand: kommt eine neue überfällige Rate dazu, gibt es eine neue Aktion.
export const reminderActionId = (contractId: string, oldestUnpaidDue: IsoDate | null): string =>
  `reminder-${contractId}-${oldestUnpaidDue ?? 'none'}`;

export const replyActionId = (lastInboundId: string): string => `reply-${lastInboundId}`;

export function reminderAction(i: {
  contract: MemberContract; contact: Contact; status: MemberStatus; text: string; at: Date; isDemo: boolean;
}): Action {
  return {
    id: reminderActionId(i.contract.id, i.status.oldestUnpaidDue),
    type: 'send_reminder',
    company: 'nexus',
    title: `Erinnerung an ${i.contact.name}`,
    payload: { threadId: `t-${i.contact.id}`, channel: 'whatsapp', contactId: i.contact.id, text: i.text },
    version: 1,
    status: 'draft',
    createdAt: i.at.toISOString(),
    isDemo: i.isDemo,
    insightKey: `overdue:${i.contract.id}`,
  };
}

export function replyAction(i: {
  lastIn: Message; contact: Contact | null; threadId: string; text: string; at: Date; isDemo: boolean;
}): Action {
  const { lastIn, contact } = i;
  return {
    id: replyActionId(lastIn.id),
    type: lastIn.channel === 'email' ? 'send_email' : 'send_whatsapp',
    company: contact?.company ?? null,
    title: `Antwort an ${contact?.name ?? lastIn.from}`,
    payload: { threadId: i.threadId, channel: lastIn.channel, contactId: contact?.id ?? null, text: i.text },
    version: 1,
    status: 'draft',
    createdAt: i.at.toISOString(),
    isDemo: i.isDemo,
    insightKey: `reply:${lastIn.id}`,
  };
}
