import 'server-only';
import type { ActionProvider } from '@/domain/actions/machine';
import type { InvoiceReader } from '@/domain/ai-port';
import type { ConnectionId } from '@/domain/types';
import type { LexwareConnection } from '@/domain/import/lexware';
import type { Repos } from './db/repository';
import { pullQonto } from './connectors/qonto';
import { pullLexware } from './connectors/lexware';
import { pullStripe } from './connectors/stripe';
import { ConnectorError, type PullContext, type PullResult } from './connectors/types';
import { readInvoices } from './read-invoices';
import { dispatchEvents } from './state-service';

export type SyncId = 'stripe_nexus' | 'lexware_nexus' | 'bank_qonto' | 'lexware_zulassung';
export type ConnectorKeys = Partial<Record<SyncId, string>>;
export interface SyncDeps {
  at: () => Date;
  keys: ConnectorKeys;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  budgetMs: number;
  provider: ActionProvider;
  only?: ConnectionId[];
  /** Claude-Leser für „Rechnungen lesen“; fehlt = Schritt übersprungen. */
  reader?: InvoiceReader;
}
export type SyncOutcome = 'ok' | 'partial' | 'error' | 'skipped';

const ORDER: SyncId[] = ['stripe_nexus', 'lexware_nexus', 'bank_qonto', 'lexware_zulassung'];

/** Alle zu maskierenden Geheimnisse: jeder Schlüssel und jeder Teil von 'login:secret' (≥ 8 Zeichen). */
export function syncSecrets(keys: ConnectorKeys): string[] {
  const out = new Set<string>();
  for (const k of Object.values(keys)) {
    if (!k) continue;
    for (const part of [k, ...k.split(':')]) if (part.length >= 8) out.add(part);
  }
  return [...out];
}

/** Nur die Meldung eines ConnectorError (bereits sicher), sonst fester Text. Geheimnisse werden zusätzlich maskiert. */
export function sanitizeError(err: unknown, secrets: string[]): string {
  let text = err instanceof ConnectorError ? err.message : 'Unbekannter Fehler';
  for (const s of secrets) if (s) text = text.split(s).join('***');
  return text;
}

export async function syncConnections(repos: Repos, deps: SyncDeps): Promise<Partial<Record<ConnectionId, SyncOutcome>>> {
  const out: Partial<Record<ConnectionId, SyncOutcome>> = {};
  const secrets = syncSecrets(deps.keys);
  const deadline = deps.now() + deps.budgetMs; // geteilt über alle Verbindungen
  for (const id of ORDER) {
    if (deps.only && !deps.only.includes(id)) continue;
    const key = deps.keys[id];
    if (!key) {
      out[id] = 'skipped';
      continue;
    }
    try {
      const state = (await repos.state.load()).state;
      const conn = state.connections.find((c) => c.id === id);
      if (!conn) {
        out[id] = 'skipped';
        continue;
      }
      const known = new Map<string, string | undefined>(
        id === 'bank_qonto' ? [] : [...state.invoices, ...(state.orderConfirmations ?? [])].filter((i) => i.connectionId === id).map((i) => [i.externalId, i.sourceUpdatedAt]),
      );
      const ctx: PullContext = { fetch: deps.fetch, key, sleep: deps.sleep, now: deps.now, deadline, known };
      const cursor = conn.sync?.cursor ?? null;
      const r: PullResult = id === 'stripe_nexus' ? await pullStripe(cursor, ctx)
        : id === 'bank_qonto' ? await pullQonto(cursor, ctx)
        : await pullLexware(id as LexwareConnection, cursor, ctx);
      await dispatchEvents(repos, [{ type: 'importBatch', connectionId: id, batch: r.batch, cursor: r.cursor, complete: r.complete, ...(r.warning ? { warning: sanitizeError(new ConnectorError(r.warning), secrets) } : {}) }], { at: deps.at, provider: deps.provider });
      out[id] = r.complete ? 'ok' : 'partial';
      if (id === 'lexware_nexus' && deps.reader) {
        // Eigener Fehlerbereich: ein Problem beim Lesen ist kein Lexware-Fehler (Final-Review I4).
        out.claude_invoices = await readInvoices(repos, { at: deps.at, now: deps.now, deadline, reader: deps.reader, provider: deps.provider }).catch(() => 'error' as const);
      }
    } catch (err) {
      out[id] = 'error';
      try {
        await dispatchEvents(repos, [{ type: 'syncFailed', connectionId: id, error: sanitizeError(err, secrets) }], { at: deps.at, provider: deps.provider });
      } catch { /* Speichern des Fehlers scheitert: andere Verbindungen laufen weiter */ }
    }
  }
  if (!deps.only || deps.only.includes('claude_invoices')) out.claude_invoices ??= 'skipped';
  return out;
}
