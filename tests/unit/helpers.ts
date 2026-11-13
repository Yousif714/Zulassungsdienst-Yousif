import type { MemberContract } from '@/domain/types';

export const base: MemberContract = { id:'c1', contactId:'m1', totalCents:120000, installments:4, installmentCents:30000, dueDay:1, startDate:'2026-10-01', billing:'legacy', catchUpMode:'first_rate' };

import { applyEvent } from '@/data/engine';
import { executeApproved } from '@/data/executor';
import type { ExpectedContract, MatchContext } from '@/domain/matching/payments';
import { DemoProvider } from '@/domain/actions/demo-provider';
import type { AppState, Connection, Contact, IbanLink, Insight, Invoice, Job, Message, Payment, Vehicle } from '@/domain/types';

export const IBAN_KAYA = 'DE89370400440532013000';
export const IBAN_MUELLER = 'DE00100000000000000001';
export const NOW_0930 = new Date('2026-11-12T08:30:00Z');

export const contacts: Contact[] = [
  { id: 'm-kaya', company: 'nexus', kind: 'member', name: 'Mehmet Kaya', phones: [], emails: [] },
  { id: 'm-yilmaz', company: 'nexus', kind: 'member', name: 'Selin Yilmaz', phones: [], emails: [] },
  { id: 'd-schmidt', company: 'zulassung', kind: 'dealer', name: 'Autohaus Schmidt', phones: ['+49209111222'], emails: [] },
  { id: 'd-mueller', company: 'zulassung', kind: 'dealer', name: 'Autohaus Müller', phones: [], emails: [] },
];
export const ibanLinks: IbanLink[] = [{ iban: IBAN_KAYA, contactId: 'm-kaya', confirmedAt: '2026-10-01T10:00:00Z' }];
export const expected = new Map<string, ExpectedContract>([
  ['k-kaya', { contactId: 'm-kaya', rateCents: 30000, nextRateCents: 30000, arrearsCents: 15000, openCents: 90000 }],
  ['k-yilmaz', { contactId: 'm-yilmaz', rateCents: 30000, nextRateCents: 30000, arrearsCents: 0, openCents: 120000 }],
]);
export const ctx: MatchContext = { company: 'nexus', contacts, ibanLinks, expected, invoices: [] };

export const vehicles: Vehicle[] = [
  { id: 'v-bot', contactId: 'd-mueller', vin: 'WVWZZZ1KZAW123456', plate: 'BOT-MK 456', model: 'Golf' },
];
export const jobs: Job[] = [
  { id: 'j-mueller-1', vehicleId: 'v-bot', contactId: 'd-mueller', service: 'Zulassung', location: 'bottrop', priceCents: 10000, status: 'done', doneAt: '2026-11-10T10:00:00Z', invoiceIds: [] },
];

export function tx(p: Partial<Payment> = {}): Payment {
  return { id: 'p1', company: 'nexus', source: 'bank', connectionId: 'bank_qonto', externalId: 'x1', amountCents: 30000, bookedOn: '2026-11-12', kind: 'incoming', ...p };
}
export function sptx(p: Partial<Payment> = {}): Payment {
  return tx({ company: 'zulassung', connectionId: 'bank_sparkasse', id: 'sp1', externalId: 'spk-0000000000000001', ...p });
}
export function msg(p: Partial<Message> = {}): Message {
  return { id: 'm1', channel: 'whatsapp', connectionId: 'whatsapp_kunden', externalId: 'e1', threadId: 't1', direction: 'in', from: '+49151000', to: '+49000', body: 'Hallo', sentAt: '2026-11-12T05:30:00Z', contactId: null, jobId: null, needsReply: false, ...p };
}

const ALL_IDS: Connection['id'][] = ['lexware_nexus','lexware_zulassung','stripe_nexus','bank_qonto','bank_sparkasse','gmail','icloud','info_mail','calendar','whatsapp_kunden','whatsapp_assistent','portal_nexus','claude_invoices'];
export function conn(p: Partial<Connection> = {}): Connection {
  return { id: 'bank_qonto', company: null, label: p.id ?? 'bank_qonto', status: 'connected', lastSuccessAt: new Date(NOW_0930.getTime() - 10 * 60_000).toISOString(), ...p };
}
export function stateWith(p: Partial<AppState> = {}): AppState {
  return {
    connections: ALL_IDS.map((id) => conn({ id, label: id })),
    contacts, contracts: [], exceptions: {}, payments: [], allocations: [], ibanLinks: [], invoices: [], messages: [], commitments: [],
    events: [], calls: [], content: [], vehicles, jobs: [], insights: [], actions: [], audit: [], assistantChat: [], subscriptions: [], dismissedProposals: [], portalMembers: [], ignoredPortalMembers: [], orderConfirmations: [], invoiceReadings: [],
    settings: { replyThresholdHours: 2, briefingsEnabled: true, ownerPhone: '', suppressedCoachKeys: [] },
    ...p,
  };
}
export function inv(id: string, totalCents: number, p: Partial<Invoice> = {}): Invoice {
  return { id, company: 'zulassung', source: 'lexware', connectionId: 'lexware_zulassung', externalId: `x-${id}`, contactId: 'd-mueller', number: `RE-${id}`, totalCents, openCents: totalCents, issuedOn: '2026-11-10', dueDate: '2026-12-10', status: 'open', ...p };
}
export const workshop = inv('i-ws', 14900, { company: 'nexus', connectionId: 'lexware_nexus', contactId: 'm-kaya', number: 'RE-1101', dueDate: '2026-09-26', status: 'overdue', text: 'Workshop' });
export const member = (id: string) => inv(id, 30000, { company: 'nexus', connectionId: 'lexware_nexus', contactId: 'm-x', contactExternalId: 'c-77', number: id, text: 'NEXUS-Mitgliedschaft 6 Monate, Rate 1' });
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

export function contractOf(s: AppState, contactId: string): string {
  const c = s.contracts.find((x) => x.contactId === contactId);
  if (!c) throw new Error(`Kein Vertrag für ${contactId}`);
  return c.id;
}
export const open = (s: AppState) => s.insights.filter((i) => i.status === 'open');
export const isOpen = (s: AppState, key: string) => s.insights.some((i) => i.dedupeKey === key && i.status === 'open');

/** Lässt den gemeinsamen Ausführer (Demo-Anbieter) alle freigegebenen Aktionen ausführen. */
export async function drain(state: AppState, at: Date = NOW_0930): Promise<AppState> {
  let st = state;
  await executeApproved({
    current: () => st,
    async apply(e) { st = applyEvent(st, e, { at, isDemo: true, newId: () => crypto.randomUUID() }).state; return st; },
  }, new DemoProvider());
  return st;
}
