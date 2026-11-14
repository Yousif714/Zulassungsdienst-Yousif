// Gemeinsame erfundene Ausgangslage für Umstellungs-Tests auf dem Server (keine echten Personen- oder Stripe-Daten).
import { applyEvents, type EngineContext } from '@/data/engine';
import type { StoreEvent } from '@/domain/events';
import type { AppState, Contact, MemberContract } from '@/domain/types';
import type { Repos } from '@/server/db/repository';
import { diffState } from '@/server/db/tables';
import { base, stateWith, tx } from '../helpers';

export const T0 = new Date('2026-11-13T09:00:00Z');
export const TAKEOVER_ID = 'stripe-takeover-c1-1';
export const OUT = { stripeCustomerId: 'cus_test_1', linkBase: 'https://nexus.example.de' };

function uuidIds(): () => string {
  let n = 0;
  return () => { n += 1; return `6f1c2b3a-0000-4000-8000-${n.toString(16).padStart(12, '0')}`; };
}
const ctx = (at = T0): EngineContext => ({ at, isDemo: false, newId: uuidIds() });

const erika: Contact = { id: 'm1', company: 'nexus', kind: 'member', name: 'Erika Muster', phones: [], emails: ['erika@example.de'] };
const contract: MemberContract = { ...base, id: 'c1', contactId: 'm1' };

export function paidState(extraCents = 0): AppState {
  const pays = [tx({ id: 'p-c1', externalId: 'x-p-c1', bookedOn: '2026-11-05', amountCents: 45000 })];
  if (extraCents) pays.push(tx({ id: 'p-c1-2', externalId: 'x-p-c1-2', bookedOn: '2026-11-12', amountCents: extraCents }));
  return stateWith({
    contacts: [erika], contracts: [contract], payments: pays,
    allocations: pays.map((p) => ({ paymentId: p.id, contractId: 'c1', amountCents: p.amountCents, method: 'manual' as const })),
  });
}

export const executeEvents = (id: string, version: number, output?: Record<string, string>): StoreEvent[] => [
  { type: 'approveAction', id, version, via: 'app' },
  { type: 'actionStarted', id },
  { type: 'actionExecuted', id, result: 'ok', ...(output ? { output } : {}) },
];

/** Vertrag c1 (Erika, 450 € von 1.200 € gezahlt), Umstellung mit Stripe-Kunde ausgeführt → `link_sent`, Raten 450 € (01.12.) und 300 € (01.01.). */
export function linkSentState(): AppState {
  return applyEvents(paidState(), [{ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }, ...executeEvents(TAKEOVER_ID, 1, OUT)], ctx()).state;
}

export function applyAt(s: AppState, events: StoreEvent[], at = T0): AppState {
  return applyEvents(s, events, ctx(at)).state;
}

/** Schreibt `next` als Stand in die (Memory-)Datenbank. */
export async function seed(repos: Repos, next: AppState): Promise<void> {
  const { state, revision } = await repos.state.load();
  const r = await repos.state.save(diffState(state, next), revision);
  if (!r.ok) throw new Error('seed fehlgeschlagen');
}
