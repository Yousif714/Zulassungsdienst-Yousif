import { CONNECTION_CATALOG } from '@/domain/connections';
import { DEFAULT_SETTINGS } from '@/domain/settings';
import type { AppState } from '@/domain/types';

export { DEFAULT_SETTINGS };

/** Leerer Startzustand für den Echtmodus: nichts verbunden, keine Daten. */
export function createEmptyState(): AppState {
  return {
    connections: CONNECTION_CATALOG.map(({ id, company, label }) => ({ id, company, label, status: 'missing', lastSuccessAt: null })),
    contacts: [], contracts: [], exceptions: {}, payments: [], allocations: [], ibanLinks: [], invoices: [], messages: [],
    commitments: [], events: [], calls: [], content: [], vehicles: [], jobs: [], insights: [], actions: [], audit: [], assistantChat: [],
    subscriptions: [], dismissedProposals: [], portalMembers: [], ignoredPortalMembers: [], orderConfirmations: [], invoiceReadings: [], takeovers: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
