import type { StoreEvent } from '@/domain/events';
import type { AppState } from '@/domain/types';

/** Sitzung abgelaufen oder fehlt: der Aufrufer leitet zur Anmeldung. */
export class UnauthorizedError extends Error {
  constructor() {
    super('Nicht angemeldet');
  }
}

export interface RealClient {
  load(): Promise<AppState>;
  dispatch(e: StoreEvent): Promise<{ state: AppState; created: string[] }>;
  /** Stößt den Abgleich mit den Quellen an. `wait`: höchstens einmal pro Minute. */
  syncNow(): Promise<{ ok: true; state: AppState } | { ok: false; reason: 'wait' }>;
}

async function read<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Zugriff des Echtmodus auf den Server. Hält keinen Zustand und schreibt nichts in den Browser-Speicher.
 * Ereignisse gehen streng nacheinander raus: „Anlegen“ und sofortiges „Freigeben“ kommen in dieser Reihenfolge an.
 */
export function createRealClient(f: typeof fetch = (...a) => fetch(...a)): RealClient {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async load() {
      return (await read<{ state: AppState }>(await f('/api/state', { cache: 'no-store' }))).state;
    },
    async syncNow() {
      const res = await f('/api/sync', { method: 'POST', cache: 'no-store' });
      if (res.status === 429) return { ok: false, reason: 'wait' } as const;
      return { ok: true, state: (await read<{ state: AppState }>(res)).state } as const;
    },
    dispatch(e) {
      const run = async () => read<{ state: AppState; created: string[] }>(await f('/api/events', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: e }),
      }));
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p;
    },
  };
}
