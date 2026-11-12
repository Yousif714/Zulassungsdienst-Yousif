import { describe, expect, it } from 'vitest';
import { reminderAction, reminderActionId, replyAction, replyActionId } from '@/domain/action-factory';
import { paymentLinkFor } from '@/domain/payment-link';
import type { Contact, MemberContract, Message } from '@/domain/types';
import type { MemberStatus } from '@/domain/ledger/status';

const contract = { id: 'mc-kaya', contactId: 'c-kaya' } as MemberContract;
const contact = { id: 'c-kaya', name: 'Ali Kaya', company: 'nexus' } as Contact;
const status = { oldestUnpaidDue: '2026-10-01' } as MemberStatus;
const at = new Date('2026-11-12T10:00:00Z');
const lastIn = { id: 'm-1', channel: 'whatsapp' } as Message;

describe('Aktions-Fabrik', () => {
  it('IDs', () => {
    expect(reminderActionId('mc-kaya', '2026-10-01')).toBe('reminder-mc-kaya-2026-10-01');
    expect(reminderActionId('mc-kaya', null)).toBe('reminder-mc-kaya-none');
    expect(replyActionId('m-1')).toBe('reply-m-1');
  });
  it('Erinnerung entspricht dem bisherigen Objekt', () => {
    expect(reminderAction({ contract, contact, status, text: 'Hallo', at, isDemo: true })).toEqual({
      id: 'reminder-mc-kaya-2026-10-01', type: 'send_reminder', company: 'nexus', title: 'Erinnerung an Ali Kaya',
      payload: { threadId: 't-c-kaya', channel: 'whatsapp', contactId: 'c-kaya', text: 'Hallo' },
      version: 1, status: 'draft', createdAt: at.toISOString(), isDemo: true, insightKey: 'overdue:mc-kaya',
    });
  });
  it('Antwort per WhatsApp', () => {
    expect(replyAction({ lastIn, contact, threadId: 't-c-kaya', text: 'Hi', at, isDemo: true })).toEqual({
      id: 'reply-m-1', type: 'send_whatsapp', company: 'nexus', title: 'Antwort an Ali Kaya',
      payload: { threadId: 't-c-kaya', channel: 'whatsapp', contactId: 'c-kaya', text: 'Hi' },
      version: 1, status: 'draft', createdAt: at.toISOString(), isDemo: true, insightKey: 'reply:m-1',
    });
  });
  it('E-Mail-Thread ergibt send_email, isDemo false wird übernommen', () => {
    const a = replyAction({ lastIn: { ...lastIn, channel: 'email', from: 'x@y.de' } as Message, contact: null, threadId: 't-1', text: 'Hi', at, isDemo: false });
    expect(a.type).toBe('send_email');
    expect(a.isDemo).toBe(false);
    expect(a.company).toBeNull();
    expect(a.title).toBe('Antwort an x@y.de');
    expect(a.payload.contactId).toBeNull();
  });
  it('paymentLinkFor', () => {
    expect(paymentLinkFor('mc-kaya')).toBe('https://buy.stripe.com/demo/mc-kaya');
  });
});
