import 'server-only';
import { applyEvent, applyEvents, refresh, type EngineContext } from '@/data/engine';
import { checkAction, executeApproved, type EventSink } from '@/data/executor';
import type { ActionProvider } from '@/domain/actions/machine';
import type { StoreEvent } from '@/domain/events';
import { newId } from '@/domain/ids';
import type { AppState } from '@/domain/types';
import type { Repos, StateRepository } from './db/repository';
import { diffState, type ChangeSet } from './db/tables';

const MAX_ATTEMPTS = 3;

/** Ereignisse, die ein Client senden darf. Ausführer-, Demo-, Verbindungs- und Assistenten-Ereignisse entstehen nur auf dem Server. */
export const CLIENT_EVENTS: ReadonlySet<StoreEvent['type']> = new Set<StoreEvent['type']>([
  'confirmPaymentMatch', 'settleInvoice', 'linkInvoiceToJob', 'setJobStatus', 'createAction', 'editAction', 'approveAction',
  'retryAction', 'checkAction', 'dismissInsight', 'snoozeInsight', 'suppressCoach', 'setSlides', 'updateSettings',
]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Pflichtfelder je erlaubtem Ereignis (Grundform; die Fachregeln prüft die Engine). */
const SHAPE: Record<string, (e: Record<string, unknown>) => boolean> = {
  confirmPaymentMatch: (e) => isStr(e.paymentId) && isStr(e.contractId),
  settleInvoice: (e) => isStr(e.invoiceId) && isStr(e.paymentId),
  linkInvoiceToJob: (e) => isStr(e.jobId) && isStr(e.invoiceId),
  setJobStatus: (e) => isStr(e.jobId) && isStr(e.status),
  // Nur Entwürfe: eine Aktion darf nie ohne Freigabe als „approved“ hereinkommen.
  createAction: (e) => isObj(e.action) && isStr(e.action.id) && isStr(e.action.type) && typeof e.action.version === 'number' && e.action.status === 'draft' && isObj(e.action.payload),
  editAction: (e) => isStr(e.id) && isObj(e.payload),
  approveAction: (e) => isStr(e.id) && typeof e.version === 'number' && (e.via === 'app' || e.via === 'whatsapp'),
  retryAction: (e) => isStr(e.id),
  checkAction: (e) => isStr(e.id),
  dismissInsight: (e) => isStr(e.key),
  snoozeInsight: (e) => isStr(e.key),
  suppressCoach: (e) => isStr(e.key),
  setSlides: (e) => isStr(e.callId) && isStr(e.status),
  updateSettings: (e) => isObj(e.patch),
};

export function isClientEvent(e: unknown): e is StoreEvent {
  if (!isObj(e) || typeof e.type !== 'string') return false;
  if (!CLIENT_EVENTS.has(e.type as StoreEvent['type'])) return false;
  return SHAPE[e.type]?.(e) ?? false;
}

export async function loadState(repos: Repos, at: Date): Promise<AppState> {
  return refresh((await repos.state.load()).state, at, false);
}

const isEmpty = (c: ChangeSet) => Object.values(c).every((t) => !t.upsert.length && !t.delete.length);

/**
 * Laden → `step` anwenden → mit Revisionsprüfung speichern. Bei Konflikt neu laden und `step` auf dem frischen Stand
 * erneut anwenden, höchstens 3 Versuche, dann `Error('conflict')`. `skip`: nichts speichern (z. B. Start verloren).
 */
async function commit<T>(repo: StateRepository, step: (s: AppState) => { state: AppState; value: T; skip?: boolean }): Promise<{ state: AppState; value: T }> {
  for (let attempt = 1; ; attempt++) {
    const { state: prev, revision } = await repo.load();
    const { state, value, skip } = step(prev);
    if (skip) return { state: prev, value };
    const changes = diffState(prev, state);
    if (isEmpty(changes)) return { state, value };
    const r = await repo.save(changes, revision);
    if (r.ok) return { state, value };
    if (attempt >= MAX_ATTEMPTS) throw new Error('conflict');
  }
}

/** Sink des Ausführers: jedes Ereignis wird einzeln auf dieselbe Weise gespeichert. */
function serverSink(repo: StateRepository, initial: AppState, ctx: () => EngineContext): EventSink {
  let current = initial;
  return {
    current: () => current,
    async apply(e) {
      current = (await commit(repo, (s) => ({ state: applyEvent(s, e, ctx()).state, value: undefined }))).state;
      return current;
    },
    // Ausführen darf nur, wessen eigenes gespeichertes `actionStarted` die Aktion von „approved“ auf „executing“ gestellt hat.
    async claimStart(id) {
      const r = await commit(repo, (s) => {
        if (s.actions.find((a) => a.id === id)?.status !== 'approved') return { state: s, value: false, skip: true };
        const next = applyEvent(s, { type: 'actionStarted', id }, ctx()).state;
        return { state: next, value: next.actions.find((a) => a.id === id)?.status === 'executing' };
      });
      current = r.state;
      return r.value;
    },
  };
}

export async function dispatchEvents(
  repos: Repos,
  events: StoreEvent[],
  deps: { at: () => Date; provider: ActionProvider },
): Promise<{ state: AppState; created: string[] }> {
  const ctx = (): EngineContext => ({ at: deps.at(), isDemo: false, newId });
  const r = await commit(repos.state, (s) => {
    const res = applyEvents(s, events, ctx());
    return { state: res.state, value: res.created };
  });
  const sink = serverSink(repos.state, r.state, ctx);
  await executeApproved(sink, deps.provider);
  for (const e of events) if (e.type === 'checkAction') await checkAction(sink, deps.provider, e.id);
  return { state: sink.current(), created: r.value };
}
