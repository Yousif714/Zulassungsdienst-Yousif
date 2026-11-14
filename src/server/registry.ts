import 'server-only';
import { createClaudeInvoiceReader } from '@/ai/claude-invoice-reader';
import { demoAI } from '@/ai/demo-ai';
import { DemoProvider } from '@/domain/actions/demo-provider';
import type { ActionProvider } from '@/domain/actions/machine';
import type { AIProvider } from '@/domain/ai-port';
import { createMemoryRepos } from './db/memory';
import type { Repos } from './db/repository';
import { createSupabaseRepos } from './db/supabase';
import { readEnv } from './env';
import type { ConnectionId } from '@/domain/types';
import { realNow } from '@/domain/clock';
import type { SyncDeps } from './sync';
import { createActionProvider } from './action-provider';
import { createStripeWriter, type StripeWriter } from './connectors/stripe-write';

let repos: Repos | null = null;
const demo = new DemoProvider();
/** Test-Überschreibung des Stripe-Schreibers; `undefined` = aus der Umgebung. */
let testWriter: StripeWriter | null | undefined;

/** Supabase im Betrieb, eine modulweite Memory-Instanz im Testmodus (NEXUS_TEST_MEMORY_DB=1). */
export function getRepos(): Repos {
  if (repos) return repos;
  const env = readEnv();
  repos = env.testMemoryDb ? createMemoryRepos() : createSupabaseRepos(env.supabaseUrl!, env.supabaseServiceRoleKey!);
  return repos;
}

/** Nur im Testmodus: frische Memory-Datenbank. */
export function resetTestRepos(): void {
  if (!readEnv().testMemoryDb) throw new Error('resetTestRepos nur im Testmodus');
  repos = createMemoryRepos();
  testWriter = undefined;
}

/** Stripe-Schreibzugriff nur mit STRIPE_WRITE_KEY (oder Test-Überschreibung); sonst null → Umstellung als Demo. */
export function getStripeWriter(): StripeWriter | null {
  if (testWriter !== undefined) return testWriter;
  const key = readEnv().stripeWriteKey;
  if (!key) return null;
  return createStripeWriter({ key, fetch: (...a) => fetch(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => realNow().getTime() });
}

/** Nur im Testmodus: Stripe-Schreiber ersetzen (`null` = keiner). */
export function setTestStripeWriter(w: StripeWriter | null): void {
  if (!readEnv().testMemoryDb) throw new Error('setTestStripeWriter nur im Testmodus');
  testWriter = w;
}

/** Phase 2a: nur der Demo-Assistent. */
export function getAI(): AIProvider {
  return demoAI;
}

/** Nachrichten bleiben Demo; `stripe_takeover` läuft mit Schreib-Schlüssel echt gegen Stripe. */
export function getActionProvider(): ActionProvider {
  return createActionProvider({ writer: getStripeWriter(), linkBase: readEnv().paymentLinkBaseUrl, now: realNow, demo });
}

/** Echte Abhängigkeiten für den Abgleich: Schlüssel aus der Umgebung, echtes fetch und echte Wartezeit. */
export function getSyncDeps(o: { only?: ConnectionId[]; budgetMs?: number } = {}): SyncDeps {
  const env = readEnv();
  return {
    at: realNow,
    keys: { stripe_nexus: env.stripeRestrictedKey, lexware_nexus: env.lexwareNexusApiKey,
      bank_qonto: env.qontoLogin && env.qontoSecretKey ? `${env.qontoLogin}:${env.qontoSecretKey}` : undefined,
      lexware_zulassung: env.lexwareZulassungApiKey },
    fetch: (...a) => fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => realNow().getTime(),
    budgetMs: o.budgetMs ?? 40_000,
    provider: getActionProvider(),
    ...(o.only ? { only: o.only } : {}),
    ...(env.anthropicApiKey ? { reader: createClaudeInvoiceReader({ apiKey: env.anthropicApiKey }) } : {}),
  };
}
