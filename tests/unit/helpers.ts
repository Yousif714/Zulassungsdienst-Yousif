import type { MemberContract } from '@/domain/types';

export const base: MemberContract = { id:'c1', contactId:'m1', totalCents:120000, installments:4, installmentCents:30000, dueDay:1, startDate:'2026-10-01', billing:'legacy', catchUpMode:'first_rate' };

import type { AppState, Connection, Contact, IbanLink, Insight, Invoice, Job, Message, Payment, Vehicle } from '@/domain/types';

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

const ALL_IDS: Connection['id'][] = ['lexware_nexus','lexware_zulassung','stripe_nexus','bank','gmail','icloud','info_mail','calendar','whatsapp_kunden','whatsapp_assistent'];
export function conn(p: Partial<Connection> = {}): Connection {
  return { id: 'bank', company: null, label: p.id ?? 'bank', status: 'connected', lastSuccessAt: new Date(NOW_0930.getTime() - 10 * 60_000).toISOString(), ...p };
}
export function stateWith(p: Partial<AppState> = {}): AppState {
  return {
    connections: ALL_IDS.map((id) => conn({ id, label: id })),
    contacts, contracts: [], exceptions: {}, payments: [], allocations: [], ibanLinks: [], invoices: [], messages: [], commitments: [],
    events: [], calls: [], content: [], vehicles, jobs: [], insights: [], actions: [], audit: [], jobRuns: [], assistantChat: [],
    settings: { replyThresholdHours: 2, briefingsEnabled: true, ownerPhone: '', suppressedCoachKeys: [] },
    ...p,
  };
}
export function inv(id: string, totalCents: number, p: Partial<Invoice> = {}): Invoice {
  return { id, company: 'zulassung', source: 'lexware', connectionId: 'lexware_zulassung', externalId: `x-${id}`, contactId: 'd-mueller', number: `RE-${id}`, totalCents, openCents: totalCents, issuedOn: '2026-11-10', dueDate: '2026-12-10', status: 'open', ...p };
}
export function ins(dedupeKey: string, p: Partial<Insight> = {}): Insight {
  return { dedupeKey, type: 'reply_waiting', company: null, priority: 'today', title: dedupeKey, body: '', refs: [], nextStep: 'Antwort senden', needsSources: [], ...p };
}
export const types = (l: { type: string }[]) => l.map((i) => i.type);
export function find<T extends { type: string }>(l: T[], type: string): T {
  const r = l.find((i) => i.type === type);
  if (!r) throw new Error(`Kein Hinweis vom Typ ${type}`);
  return r;
}
export const muellerDone: Job = { id: 'j-mueller-1', vehicleId: 'v-bot', contactId: 'd-mueller', service: 'Zulassung', location: 'bottrop', priceCents: 8900, status: 'done', doneAt: '2026-11-10T10:00:00Z', invoiceIds: [] };
export const schmidtIn: Message = msg({ id: 'm-schmidt-1', threadId: 't-schmidt', from: '+49209111222', contactId: 'd-schmidt', needsReply: true, sentAt: '2026-11-12T05:30:00Z' });
