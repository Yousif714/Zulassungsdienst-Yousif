import { describe, expect, test } from 'vitest';
import { readEnv } from '@/server/env';

const FULL = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SESSION_SECRET: 's'.repeat(32),
  OWNER_SETUP_TOKEN: 'setup',
  CRON_SECRET: 'cron',
  APP_ORIGIN: 'https://nexus.example',
};

describe('readEnv', () => {
  test('vollständige Umgebung wird gelesen', () => {
    expect(readEnv(FULL)).toEqual({
      supabaseUrl: FULL.SUPABASE_URL, supabaseServiceRoleKey: FULL.SUPABASE_SERVICE_ROLE_KEY, sessionSecret: FULL.SESSION_SECRET,
      ownerSetupToken: 'setup', cronSecret: 'cron', appOrigin: 'https://nexus.example', testMemoryDb: false,
    });
  });

  test('Qonto-Schlüssel optional', () => expect(readEnv(FULL).qontoLogin).toBeUndefined());
  test('Qonto-Schlüssel gelesen', () => expect(readEnv({ ...FULL, QONTO_LOGIN: 'l', QONTO_SECRET_KEY: 's' })).toMatchObject({ qontoLogin: 'l', qontoSecretKey: 's' }));

  test('Schlüssel sind optional', () => {
    const e = readEnv(FULL);
    expect([e.stripeRestrictedKey, e.stripeWebhookSecret, e.lexwareNexusApiKey, e.lexwareZulassungApiKey]).toEqual([undefined, undefined, undefined, undefined]);
  });

  test('Schlüssel werden gelesen (leer = fehlt)', () => {
    const e = readEnv({ ...FULL, STRIPE_RESTRICTED_KEY: 'rk', STRIPE_WEBHOOK_SECRET: 'wh', LEXWARE_NEXUS_API_KEY: 'lx', LEXWARE_ZULASSUNG_API_KEY: '  ' });
    expect(e).toMatchObject({ stripeRestrictedKey: 'rk', stripeWebhookSecret: 'wh', lexwareNexusApiKey: 'lx' });
    expect(e.lexwareZulassungApiKey).toBeUndefined();
  });

  test('alle fehlenden Variablen werden genannt', () => {
    expect(() => readEnv({})).toThrow('Fehlende Umgebungsvariablen: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET, OWNER_SETUP_TOKEN, CRON_SECRET, APP_ORIGIN');
    expect(() => readEnv({ ...FULL, CRON_SECRET: '', APP_ORIGIN: undefined })).toThrow('Fehlende Umgebungsvariablen: CRON_SECRET, APP_ORIGIN');
  });

  test('ohne Supabase und ohne Testmodus → Fehler', () => {
    const { SUPABASE_URL: _u, SUPABASE_SERVICE_ROLE_KEY: _k, ...rest } = FULL;
    expect(() => readEnv(rest)).toThrow('Fehlende Umgebungsvariablen: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  });

  test('Testmodus ohne Supabase ist erlaubt, aber nicht auf Vercel', () => {
    const { SUPABASE_URL: _u, SUPABASE_SERVICE_ROLE_KEY: _k, ...rest } = FULL;
    expect(readEnv({ ...rest, NEXUS_TEST_MEMORY_DB: '1' }).testMemoryDb).toBe(true);
    expect(() => readEnv({ ...rest, NEXUS_TEST_MEMORY_DB: '1', VERCEL: '1' })).toThrow(/NEXUS_TEST_MEMORY_DB/);
    expect(() => readEnv({ ...FULL, NEXUS_TEST_MEMORY_DB: '1', VERCEL: '1' })).toThrow(/NEXUS_TEST_MEMORY_DB/);
    expect(readEnv({ ...FULL, NEXUS_TEST_MEMORY_DB: 'true' }).testMemoryDb).toBe(false);
  });

  test('SESSION_SECRET muss mindestens 32 Zeichen haben', () => {
    expect(() => readEnv({ ...FULL, SESSION_SECRET: 's'.repeat(31) })).toThrow(/SESSION_SECRET/);
  });
});

test('ANTHROPIC_API_KEY optional', () => {
  expect(readEnv(FULL).anthropicApiKey).toBeUndefined();
  expect(readEnv({ ...FULL, ANTHROPIC_API_KEY: ' ' }).anthropicApiKey).toBeUndefined();
  expect(readEnv({ ...FULL, ANTHROPIC_API_KEY: 'sk-ant-x' }).anthropicApiKey).toBe('sk-ant-x');
});
