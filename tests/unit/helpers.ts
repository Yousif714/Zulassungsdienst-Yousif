import type { MemberContract } from '@/domain/types';

export const base: MemberContract = { id:'c1', contactId:'m1', totalCents:120000, installments:4, installmentCents:30000, dueDay:1, startDate:'2026-10-01', billing:'legacy', catchUpMode:'first_rate' };

import type { Contact, IbanLink, Job, Message, Payment, Vehicle } from '@/domain/types';

export const IBAN_KAYA = 'DE89370400440532013000';
export const NOW_0930 = new Date('2026-11-12T08:30:00Z');

export const contacts: Contact[] = [
  { id: 'm-kaya', company: 'nexus', kind: 'member', name: 'Mehmet Kaya', phones: [], emails: [] },
  { id: 'm-yilmaz', company: 'nexus', kind: 'member', name: 'Selin Yilmaz', phones: [], emails: [] },
  { id: 'd-schmidt', company: 'zulassung', kind: 'dealer', name: 'Autohaus Schmidt', phones: ['+49209111222'], emails: [] },
  { id: 'd-mueller', company: 'zulassung', kind: 'dealer', name: 'Autohaus Müller', phones: [], emails: [] },
];
export const ibanLinks: IbanLink[] = [{ iban: IBAN_KAYA, contactId: 'm-kaya', confirmedAt: '2026-10-01T10:00:00Z' }];
export const expected = new Map<string, { nextRateCents: number; arrearsCents: number }>([
  ['m-kaya', { nextRateCents: 30000, arrearsCents: 15000 }],
  ['m-yilmaz', { nextRateCents: 30000, arrearsCents: 0 }],
]);
export const ctx = { contacts, ibanLinks, expected };

export const vehicles: Vehicle[] = [
  { id: 'v-bot', contactId: 'd-mueller', vin: 'WVWZZZ1KZAW123456', plate: 'BOT-MK 456', model: 'Golf' },
];
export const jobs: Job[] = [
  { id: 'j-mueller-1', vehicleId: 'v-bot', contactId: 'd-mueller', service: 'Zulassung', location: 'bottrop', priceCents: 10000, status: 'done', doneAt: '2026-11-10T10:00:00Z', invoiceIds: [] },
];

export function tx(p: Partial<Payment> = {}): Payment {
  return { id: 'p1', company: 'nexus', source: 'bank', connectionId: 'bank', externalId: 'x1', amountCents: 30000, bookedOn: '2026-11-12', kind: 'incoming', ...p };
}
export function msg(p: Partial<Message> = {}): Message {
  return { id: 'm1', channel: 'whatsapp', connectionId: 'whatsapp_kunden', externalId: 'e1', threadId: 't1', direction: 'in', from: '+49151000', to: '+49000', body: 'Hallo', sentAt: '2026-11-12T05:30:00Z', contactId: null, jobId: null, needsReply: false, ...p };
}
