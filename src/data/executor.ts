import { EXECUTE_TIMEOUT_MS, STALE_EXECUTING_MS, idempotencyKey, type ActionProvider } from '@/domain/actions/machine';
import type { StoreEvent } from '@/domain/events';
import type { AppState } from '@/domain/types';

/**
 * Wohin der Ausführer seine Ereignisse schreibt (Client-Store, Server-Dienst).
 * Ohne `claimStart` muss `apply` den Stand synchron umstellen (Client). Ein Sink, dessen Speichern nebenläufig
 * mit anderen Geräten konkurriert (Server), muss `claimStart` anbieten.
 */
export interface EventSink {
  current(): AppState;
  apply(e: StoreEvent): Promise<AppState>;
  /** Wendet `actionStarted` an. true nur, wenn GENAU dieser Aufruf die Aktion von „approved“ auf „executing“ gestellt hat. */
  claimStart?(id: string): Promise<boolean>;
}

async function claimStart(sink: EventSink, id: string): Promise<boolean> {
  if (sink.claimStart) return sink.claimStart(id);
  await sink.apply({ type: 'actionStarted', id });
  return sink.current().actions.find((x) => x.id === id)?.status === 'executing';
}

async function runWithTimeout(run: () => Promise<'ok' | 'error' | 'timeout'>, ms: number): Promise<{ result: 'ok' | 'error' | 'timeout'; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), ms); });
  try {
    return { result: await Promise.race([run(), limit]) };
  } catch (err) {
    return { result: 'error', error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Führt jede freigegebene Aktion genau einmal aus (Schlüssel `aktion:version`). Bei Zeitüberschreitung: Ausgang unklar, nie automatisch erneut senden. */
export async function executeApproved(sink: EventSink, provider: ActionProvider, timeoutMs = EXECUTE_TIMEOUT_MS): Promise<void> {
  for (const id of sink.current().actions.filter((a) => a.status === 'approved').map((a) => a.id)) {
    if (sink.current().actions.find((a) => a.id === id)?.status !== 'approved') continue;
    // Nur wer die Aktion selbst gestartet hat, führt aus: sonst könnten zwei Geräte dieselbe Freigabe doppelt senden.
    if (!(await claimStart(sink, id))) continue;
    const a = sink.current().actions.find((x) => x.id === id);
    if (!a || a.status !== 'executing') continue;
    const { result, error } = await runWithTimeout(() => provider.execute(a, idempotencyKey(a)), timeoutMs);
    await sink.apply({ type: 'actionExecuted', id, result, ...(error ? { error } : {}), simulated: provider.simulated });
  }
}

/** „Prüfen“: nur bei unklarem Ausgang. Fragt den Anbieter nach dem Schlüssel, sendet nie ein zweites Mal. */
export async function checkAction(sink: EventSink, provider: ActionProvider, id: string): Promise<void> {
  const a = sink.current().actions.find((x) => x.id === id);
  if (!a || a.status !== 'uncertain') return;
  const found = await provider.lookup(idempotencyKey(a));
  await sink.apply({ type: 'actionReconciled', id, found, simulated: provider.simulated });
}

/** Eine Ausführung, die zu lange „executing“ ist (z. B. Seite geschlossen), wird zu „Ausgang unklar“. */
export async function sweepStaleExecutions(sink: EventSink, at: Date): Promise<void> {
  for (const a of sink.current().actions) {
    if (a.status !== 'executing' || !a.executingSince) continue;
    if (at.getTime() - Date.parse(a.executingSince) <= STALE_EXECUTING_MS) continue;
    await sink.apply({ type: 'actionExecuted', id: a.id, result: 'timeout' });
  }
}
