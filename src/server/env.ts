import 'server-only';

export interface ServerEnv {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  sessionSecret: string;
  ownerSetupToken: string;
  cronSecret: string;
  appOrigin: string;
  testMemoryDb: boolean;
  /** Optionale Integrationsschlüssel; fehlen sie, bleibt die Verbindung `missing`. */
  stripeRestrictedKey?: string;
  stripeWebhookSecret?: string;
  lexwareNexusApiKey?: string;
  lexwareZulassungApiKey?: string;
  qontoLogin?: string;
  qontoSecretKey?: string;
  anthropicApiKey?: string;
}

const SUPABASE = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const ALWAYS = ['SESSION_SECRET', 'OWNER_SETUP_TOKEN', 'CRON_SECRET', 'APP_ORIGIN'] as const;

/** Liest die Server-Umgebung. Wirft mit allen fehlenden Variablen auf einmal. Keine NEXT_PUBLIC_-Variablen. */
export function readEnv(e: Record<string, string | undefined> = process.env): ServerEnv {
  const val = (k: string) => (e[k] && e[k]!.trim() ? e[k] : undefined);
  const testMemoryDb = e.NEXUS_TEST_MEMORY_DB === '1';
  if (testMemoryDb && e.VERCEL) throw new Error('NEXUS_TEST_MEMORY_DB ist auf Vercel nicht erlaubt');
  const required = [...(testMemoryDb ? [] : SUPABASE), ...ALWAYS];
  const missing = required.filter((k) => !val(k));
  if (missing.length) throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(', ')}`);
  const sessionSecret = val('SESSION_SECRET')!;
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET muss mindestens 32 Zeichen lang sein');
  return {
    supabaseUrl: val('SUPABASE_URL'),
    supabaseServiceRoleKey: val('SUPABASE_SERVICE_ROLE_KEY'),
    sessionSecret,
    ownerSetupToken: val('OWNER_SETUP_TOKEN')!,
    cronSecret: val('CRON_SECRET')!,
    appOrigin: val('APP_ORIGIN')!,
    testMemoryDb,
    stripeRestrictedKey: val('STRIPE_RESTRICTED_KEY'),
    stripeWebhookSecret: val('STRIPE_WEBHOOK_SECRET'),
    lexwareNexusApiKey: val('LEXWARE_NEXUS_API_KEY'),
    lexwareZulassungApiKey: val('LEXWARE_ZULASSUNG_API_KEY'),
    qontoLogin: val('QONTO_LOGIN'),
    qontoSecretKey: val('QONTO_SECRET_KEY'),
    anthropicApiKey: val('ANTHROPIC_API_KEY'),
  };
}
