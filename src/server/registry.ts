import 'server-only';
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

let repos: Repos | null = null;
const provider = new DemoProvider();

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
}

/** Phase 2a: nur der Demo-Assistent. */
export function getAI(): AIProvider {
  return demoAI;
}

/** Phase 2a: nur der Demo-Ausführer (sendet nichts). */
export function getActionProvider(): ActionProvider {
  return provider;
}

/** Echte Abhängigkeiten für den Abgleich: Schlüssel aus der Umgebung, echtes fetch und echte Wartezeit. */
export function getSyncDeps(o: { only?: ConnectionId[]; budgetMs?: number } = {}): SyncDeps {
  const env = readEnv();
  return {
    at: realNow,
    keys: { stripe_nexus: env.stripeRestrictedKey, lexware_nexus: env.lexwareNexusApiKey, lexware_zulassung: env.lexwareZulassungApiKey },
    fetch: (...a) => fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => realNow().getTime(),
    budgetMs: o.budgetMs ?? 40_000,
    provider,
    ...(o.only ? { only: o.only } : {}),
  };
}
