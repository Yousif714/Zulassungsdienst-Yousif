import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { repositoryContract } from '../unit/repo-contract';
import { createSupabaseRepos } from '@/server/db/supabase';
import { TABLES, diffState } from '@/server/db/tables';

const URL = process.env.SUPABASE_TEST_URL ?? '';
const KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.SUPABASE_TEST_ANON_KEY;

/** Leert alle Tabellen und setzt die Revision zurück (Testprojekt, nie Produktion). */
async function reset(): Promise<void> {
  const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const tables = [...new Set<string>(Object.values(TABLES)), 'passkeys'];
  const results = await Promise.all([
    ...tables.map((t) => db.from(t).delete().neq('id', '')),
    db.from('recovery_codes').delete().neq('hash', ''),
    db.from('job_runs').delete().neq('key', ''),
    db.from('meta').update({ value: 0 }).eq('key', 'revision'),
  ]);
  for (const r of results) if (r.error) throw new Error(r.error.message);
}

describe.skipIf(!URL || !KEY)('Supabase-Repository (Integration)', () => {
  repositoryContract('supabase', async () => {
    await reset();
    return createSupabaseRepos(URL, KEY);
  });

  it.skipIf(!ANON)('Anon-Key liest keine Kontakte', async () => {
    await reset();
    const repos = createSupabaseRepos(URL, KEY);
    const { state } = await repos.state.load();
    const next = { ...state, contacts: [{ id: 'k1', name: 'Geheim' }] as never };
    expect((await repos.state.save(diffState(state, next), 0)).ok).toBe(true);
    const anon = createClient(URL, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await anon.from('contacts').select('*');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});
