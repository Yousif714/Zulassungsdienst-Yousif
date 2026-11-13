import { mapLexwareContacts, mapLexwareInvoice } from '@/domain/import/lexware';
import { emptyBatch, type ImportBatch } from '@/domain/import/batch';
import { mapStripe } from '@/domain/import/stripe';
import { mergeBatch } from '@/domain/import/merge';
import type { AppState, MemberContract, Subscription } from '@/domain/types';
import { applyEvent } from '@/data/engine';
import { parsePortalList } from '@/domain/import/portal-list';
import { lexContacts, lexInvoices, portalListText, stripeRaw } from '../../fixtures';
import { NOW_0930, stateWith } from '../helpers';

/** Fortlaufende Test-IDs `id-1`, `id-2`, … */
export const seq = (): (() => string) => { let n = 0; return () => `id-${++n}`; };

/** Leerer Zustand (alle Verbindungen verbunden, keine Kontakte). */
export const emptyState = (): AppState => stateWith({ contacts: [], vehicles: [] });

export const stripeBatch: ImportBatch = mapStripe(stripeRaw);
export const lexwareBatch: ImportBatch = {
  ...emptyBatch(),
  contacts: mapLexwareContacts(lexContacts('nexus'), 'lexware_nexus'),
  invoices: lexInvoices('nexus').map((d) => mapLexwareInvoice(d, 'lexware_nexus')),
};

/** Zustand nach Stripe-Import der Fixtures. */
export const stripeState: AppState = mergeBatch(emptyState(), stripeBatch, seq()).state;
/** Zustand nach Lexware-Import (NEXUS) der Fixtures. */
export const lexState: AppState = mergeBatch(emptyState(), lexwareBatch, seq()).state;

/** Zustand nach Import der Portal-Mitgliederliste (Fixture) um 09:30. */
export const portalState: AppState = applyEvent(emptyState(), { type: 'importPortalList', entries: parsePortalList(portalListText).entries }, { at: NOW_0930, isDemo: true, newId: seq() }).state;

/** Ersetzt Felder eines Abos (nach `externalId`). */
export const patchSub = (s: AppState, externalId: string, patch: Partial<Subscription>): AppState => ({
  ...s, subscriptions: s.subscriptions.map((x) => (x.externalId === externalId ? { ...x, ...patch } : x)),
});

/** Fügt einen Vertrag hinzu (Standard: Stripe-Vertrag, bestätigt). */
export const withContract = (s: AppState, patch: Partial<MemberContract> = {}): AppState => ({
  ...s,
  contracts: [...s.contracts, { id: 'k-test', contactId: 'm1', totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-10-01', billing: 'stripe', catchUpMode: 'first_rate', ...patch }],
});

/** Abo bestätigt: Vertrag `contractId` (mit eigenem Kontakt) angelegt, Bestätigungswerte aus dem Abo übernommen. */
export const confirmedSub = (s: AppState, externalId: string, contractId: string): AppState => {
  const sub = s.subscriptions.find((x) => x.externalId === externalId)!;
  const contactId = `ct-${contractId}`;
  const withC: AppState = {
    ...s,
    contacts: [...s.contacts, { id: contactId, company: 'nexus', kind: 'member', name: sub.customerName, phones: [], emails: sub.customerEmail ? [sub.customerEmail] : [] }],
  };
  const price = sub.priceCents ?? sub.amountCents ?? 0;
  return patchSub(
    withContract(withC, { id: contractId, contactId, billing: 'stripe', totalCents: price * (sub.installments ?? 1), installments: sub.installments ?? 1, installmentCents: price, startDate: sub.startDate, dueDay: sub.anchorDay, origin: [{ connectionId: 'stripe_nexus', externalId }] }),
    externalId,
    { contractId, confirmedPriceCents: sub.priceCents, confirmedEndDate: sub.endDate },
  );
};

/** Legacy-Vertrag (Banküberweisung), Bank nicht verbunden. */
export const legacyNoBank: AppState = (() => {
  const s = stateWith({ contracts: [{ id: 'c1', contactId: 'm1', totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-10-01', billing: 'legacy', catchUpMode: 'first_rate' }] });
  return { ...s, connections: s.connections.map((c) => (c.id === 'bank_qonto' ? { ...c, status: 'missing' as const, lastSuccessAt: null } : c)) };
})();

/** Speicher im Arbeitsspeicher (wie Web-Storage). */
export const memStorage = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
