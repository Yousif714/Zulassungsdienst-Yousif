import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ActionProvider } from '@/domain/actions/machine';
import { InvoiceReadError, type InvoiceReader } from '@/domain/ai-port';
import type { NewInvoiceReading } from '@/domain/events';
import { READ_LIMITS, costMicroCents, invoicesToRead, limitReached } from '@/domain/import/invoice-reading';
import type { Repos } from './db/repository';
import { dispatchEvents } from './state-service';
import type { SyncOutcome } from './sync';

/** Liest bis zu 5 offene NEXUS-Rechnungen mit Claude (eigenes Zeitbudget, Monatslimit) und speichert die Lesungen als ein Ereignis. */
export async function readInvoices(
  repos: Repos,
  deps: { at: () => Date; now: () => number; deadline: number; reader: InvoiceReader; provider: ActionProvider; newId?: () => string },
): Promise<SyncOutcome> {
  const newId = deps.newId ?? randomUUID;
  const deadline = Math.min(deps.now() + READ_LIMITS.budgetMs, deps.deadline);
  const readings: NewInvoiceReading[] = [];
  let outcome: SyncOutcome = 'ok';
  let error: string | undefined;
  let warning: string | undefined;
  try {
    const state = (await repos.state.load()).state;
    const all = invoicesToRead(state, Number.POSITIVE_INFINITY);
    const batch = all.slice(0, READ_LIMITS.maxPerRun);
    let spent = 0;
    let done = 0;
    for (const inv of batch) {
      const left = deadline - deps.now();
      if (left <= 0) break;
      if (limitReached(state, deps.at(), spent)) { warning = 'Monatslimit erreicht'; break; }
      const base = { id: newId(), invoiceId: inv.id, sourceUpdatedAt: inv.sourceUpdatedAt ?? '', model: deps.reader.model };
      try {
        const o = await deps.reader.read({ number: inv.number, totalCents: inv.totalCents, issuedOn: inv.issuedOn, dueDate: inv.dueDate, text: inv.text ?? '' }, { timeoutMs: left });
        const cost = costMicroCents(o);
        spent += cost;
        readings.push({ ...base, model: o.model, readAt: deps.at().toISOString(), result: o.result, inputTokens: o.inputTokens, outputTokens: o.outputTokens, costMicroCents: cost });
      } catch (e) {
        if (!(e instanceof InvoiceReadError)) throw e;
        if (e.fatal) { error = e.message; break; }
        readings.push({ ...base, readAt: deps.at().toISOString(), result: null, error: e.message, inputTokens: 0, outputTokens: 0, costMicroCents: 0 });
      }
      done++;
    }
    if (!warning && limitReached(state, deps.at(), spent) && done < all.length) warning = 'Monatslimit erreicht';
    outcome = error ? 'error' : done < all.length ? 'partial' : 'ok';
  } catch {
    outcome = 'error';
    error = 'Unbekannter Fehler';
  }
  await dispatchEvents(repos, [{ type: 'invoicesRead', readings, ...(warning ? { warning } : {}), ...(error ? { error } : {}) }], { at: deps.at, provider: deps.provider });
  return outcome;
}
