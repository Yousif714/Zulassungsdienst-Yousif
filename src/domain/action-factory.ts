import type { MemberStatus } from './ledger/status';
import type { TakeoverPlan } from './ledger/takeover';
import { takeoverActionId } from './takeover/status';
import type { Action, Contact, Installment, IsoDate, Job, MemberContract, Message, StripeTakeover } from './types';

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

export const upcomingReminderId = (contractId: string, dueDate: IsoDate): string => `upcoming-${contractId}-${dueDate}`;

/** Erinnerung vor einer anstehenden Rate (Überweisungs-Vertrag). */
export function upcomingReminderAction(i: {
  contract: MemberContract; contact: Contact; dueDate: IsoDate; text: string; at: Date; isDemo: boolean;
}): Action {
  return {
    id: upcomingReminderId(i.contract.id, i.dueDate),
    type: 'send_reminder',
    company: 'nexus',
    title: `Erinnerung an ${i.contact.name}`,
    payload: { threadId: `t-${i.contact.id}`, channel: 'whatsapp', contactId: i.contact.id, text: i.text },
    version: 1,
    status: 'draft',
    createdAt: i.at.toISOString(),
    isDemo: i.isDemo,
    insightKey: `upcoming:${i.contract.id}:${i.dueDate}`,
  };
}

export const linkNudgeId = (takeoverId: string): string => `link-nudge-${takeoverId}`;

/** Nachfrage zu einem verschickten, noch nicht genutzten Zahlungslink. */
export function linkNudgeAction(i: { takeover: StripeTakeover; contact: Contact; text: string; at: Date; isDemo: boolean }): Action {
  return {
    id: linkNudgeId(i.takeover.id),
    type: 'send_reminder',
    company: 'nexus',
    title: `Link-Erinnerung an ${i.contact.name}`,
    payload: { threadId: `t-${i.contact.id}`, channel: 'whatsapp', contactId: i.contact.id, text: i.text },
    version: 1,
    status: 'draft',
    createdAt: i.at.toISOString(),
    isDemo: i.isDemo,
    insightKey: `takeover-link:${i.takeover.id}`,
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

export const jobInvoiceDraftId = (jobId: string): string => `invoice-draft-${jobId}`;

/** Rechnungsentwurf über den offenen Rest eines Auftrags (Zulassungsdienst). */
export function jobInvoiceDraftAction(i: {
  job: Job; contactName: string; plate: string | null; restCents: number; at: Date; isDemo: boolean;
}): Action {
  return {
    id: jobInvoiceDraftId(i.job.id),
    type: 'create_invoice_draft',
    company: 'zulassung',
    title: `Rechnungsentwurf für ${i.contactName}`,
    payload: { jobId: i.job.id, contactId: i.job.contactId, amountCents: i.restCents, text: `${i.job.service} ${i.plate ?? ''}`.trim() },
    version: 1,
    status: 'draft',
    createdAt: i.at.toISOString(),
    isDemo: i.isDemo,
  };
}

// Ein Stripe-Plan pro Vertrag.
export const stripePlanActionId = (contractId: string): string => `stripe-plan-${contractId}`;

export function stripePlanAction(i: {
  contract: MemberContract; name: string; mode: MemberContract['catchUpMode']; rates: Installment[]; at: Date; isDemo: boolean;
}): Action {
  return {
    id: stripePlanActionId(i.contract.id),
    type: 'create_invoice_draft',
    company: 'nexus',
    title: `Stripe-Ratenplan für ${i.name}`,
    payload: { contractId: i.contract.id, contactId: i.contract.contactId, mode: i.mode, rates: i.rates },
    version: 1,
    status: 'draft',
    createdAt: i.at.toISOString(),
    isDemo: i.isDemo,
  };
}

/**
 * Umstellung eines Bestandsmitglieds auf Stripe (ein Versuch je Aktion).
 * Kunde aus einem früheren Versuch wird weiterverwendet; das Zahlungsmittel nur nach „Plan geändert“ (dann ohne neuen Link).
 */
export function takeoverAction(i: {
  contract: MemberContract; contact: Contact; mode: MemberContract['catchUpMode']; plan: TakeoverPlan; attempt: number; prior?: StripeTakeover; at: Date; isDemo: boolean;
}): Action {
  const payload: Record<string, unknown> = {
    contractId: i.contract.id,
    contactId: i.contact.id,
    name: i.contact.name,
    email: i.contact.emails?.[0] ?? null,
    mode: i.mode,
    rates: i.plan.rates,
    openCents: i.plan.openCents,
  };
  if (i.prior?.stripeCustomerId) payload.stripeCustomerId = i.prior.stripeCustomerId;
  if (i.prior?.status === 'plan_changed' && i.prior.paymentMethodId) payload.paymentMethodId = i.prior.paymentMethodId;
  return {
    id: takeoverActionId(i.contract.id, i.attempt),
    type: 'stripe_takeover',
    company: 'nexus',
    title: `Umstellung auf Stripe: ${i.contact.name}`,
    payload,
    version: 1,
    status: 'draft',
    createdAt: i.at.toISOString(),
    isDemo: i.isDemo,
  };
}
