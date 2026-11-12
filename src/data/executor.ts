import { EXECUTE_TIMEOUT_MS, STALE_EXECUTING_MS, idempotencyKey, type ActionProvider } from '@/domain/actions/machine';
import type { StoreEvent } from '@/domain/events';
import type { AppState } from '@/domain/types';

/** Wohin der Ausführer seine Ereignisse schreibt (Client-Store jetzt, Server später). `apply` muss den Stand synchron umstellen. */
export interface EventSink {
  current(): AppState;
  apply(e: StoreEvent): Promise<AppState>;
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
    await sink.apply({ type: 'actionStarted', id });
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
