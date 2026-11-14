import { describe, expect, it } from 'vitest';
import { reminderAction, reminderActionId, replyAction, replyActionId, takeoverAction } from '@/domain/action-factory';
import type { TakeoverPlan } from '@/domain/ledger/takeover';
import { paymentLinkFor } from '@/domain/payment-link';
import { stateWith } from './helpers';
import type { Contact, MemberContract, Message, StripeTakeover } from '@/domain/types';
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
    expect(paymentLinkFor(stateWith(), 'mc-kaya')).toBe('https://buy.stripe.com/demo/mc-kaya');
  });

  describe('takeoverAction', () => {
    const plan: TakeoverPlan = { arrearsCents: 15000, futureCents: 60000, openCents: 75000, mode: 'first_rate',
      rates: [{ no: 1, dueDate: '2026-12-01', amountCents: 45000 }, { no: 2, dueDate: '2027-01-01', amountCents: 30000 }] };
    const mail = { ...contact, emails: ['ali.kaya@example.de'] } as Contact;
    const prior = (status: StripeTakeover['status']): StripeTakeover => ({
      id: '6f1c2b3a-0000-4000-8000-000000000001', contractId: 'mc-kaya', contactId: 'c-kaya', actionId: 'stripe-takeover-mc-kaya-1', actionVersion: 1, status,
      token: 'a'.repeat(64), link: 'https://nexus.example.de/zahlung/x', mode: 'first_rate', rates: plan.rates, openCents: 75000,
      stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1', scheduleId: null, subscriptionExternalId: null, isDemo: false, linkSentAt: '2026-11-10T09:00:00.000Z',
    });

    it('Payload ohne frühere Umstellung', () => {
      expect(takeoverAction({ contract, contact: mail, mode: 'first_rate', plan, attempt: 1, at, isDemo: true })).toEqual({
        id: 'stripe-takeover-mc-kaya-1', type: 'stripe_takeover', company: 'nexus', title: 'Umstellung auf Stripe: Ali Kaya',
        payload: { contractId: 'mc-kaya', contactId: 'c-kaya', name: 'Ali Kaya', email: 'ali.kaya@example.de', mode: 'first_rate', rates: plan.rates, openCents: 75000 },
        version: 1, status: 'draft', createdAt: at.toISOString(), isDemo: true,
      });
    });
    it('ohne E-Mail → null', () => {
      expect(takeoverAction({ contract, contact: { ...contact, emails: [] } as Contact, mode: 'spread', plan, attempt: 2, at, isDemo: false }).payload)
        .toMatchObject({ email: null, mode: 'spread' });
    });
    it('paymentMethodId nur aus früherer Umstellung mit Plan geändert', () => {
      const changed = takeoverAction({ contract, contact: mail, mode: 'first_rate', plan, attempt: 2, prior: prior('plan_changed'), at, isDemo: false });
      expect(changed.id).toBe('stripe-takeover-mc-kaya-2');
      expect(changed.payload).toMatchObject({ stripeCustomerId: 'cus_test_1', paymentMethodId: 'pm_test_1' });
      const withdrawn = takeoverAction({ contract, contact: mail, mode: 'first_rate', plan, attempt: 2, prior: prior('withdrawn'), at, isDemo: false });
      expect(withdrawn.payload.stripeCustomerId).toBe('cus_test_1');
      expect('paymentMethodId' in withdrawn.payload).toBe(false);
    });
  });
});
