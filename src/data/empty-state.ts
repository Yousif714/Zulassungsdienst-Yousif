import { CONNECTION_CATALOG } from '@/domain/connections';
import type { AppState } from '@/domain/types';

/** Leerer Startzustand für den Echtmodus: nichts verbunden, keine Daten. */
export function createEmptyState(): AppState {
  return {
    connections: CONNECTION_CATALOG.map(({ id, company, label }) => ({ id, company, label, status: 'missing', lastSuccessAt: null })),
    contacts: [], contracts: [], exceptions: {}, payments: [], allocations: [], ibanLinks: [], invoices: [], messages: [],
    commitments: [], events: [], calls: [], content: [], vehicles: [], jobs: [], insights: [], actions: [], audit: [], jobRuns: [],
    assistantChat: [],
    settings: { replyThresholdHours: 2, briefingsEnabled: true, ownerPhone: '', suppressedCoachKeys: [] },
  };
}
