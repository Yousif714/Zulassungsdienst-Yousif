import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthRepository, Repos, StateRepository, StoredPasskey } from './repository';
import { fromRows, TABLES, type ChangeSet, type Row, type TableName } from './tables';

const PAGE = 1000; // PostgREST liefert standardmäßig höchstens 1000 Zeilen je Anfrage
const TABLE_NAMES = [...new Set(Object.values(TABLES))] as TableName[];
const WITH_EXTERNAL = new Set<TableName>(['payments', 'invoices', 'messages', 'events']);

function columns(t: TableName): string {
  if (WITH_EXTERNAL.has(t)) return 'id,ord,data,connection_id,external_id';
  if (t === 'insights') return 'id,ord,data,dedupe_key';
  return 'id,ord,data';
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`Supabase ${what}: ${error.message}`);
}

/** Liest alle Zeilen seitenweise in stabiler Reihenfolge. */
async function selectAll<T>(what: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) fail(what, error);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** Server-Repository auf Supabase. Nur mit Service-Role-Key und nur serverseitig verwenden. */
export function createSupabaseRepos(url: string, serviceRoleKey: string): Repos {
  const db: SupabaseClient = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const state: StateRepository = {
    async load() {
      const [tables, jobRuns, meta] = await Promise.all([
        Promise.all(
          TABLE_NAMES.map(async (t) => {
            const rows = await selectAll<Row>(`load ${t}`, (from, to) =>
              db.from(t).select(columns(t)).order('ord').order('id').range(from, to).returns<Row[]>(),
            );
            return [t, rows] as const;
          }),
        ),
        selectAll<{ key: string }>('load job_runs', (from, to) =>
          db.from('job_runs').select('key').order('ran_at').order('key').range(from, to).returns<{ key: string }[]>(),
        ),
        db.from('meta').select('value').eq('key', 'revision').single(),
      ]);
      if (meta.error) fail('load meta', meta.error);
      const rows = Object.fromEntries(tables) as Record<TableName, Row[]>;
      return { state: fromRows(rows, jobRuns.map((x) => x.key)), revision: Number(meta.data.value) };
    },

    async save(changes: ChangeSet, expectedRevision: number) {
      const payload = Object.fromEntries(Object.entries(changes).filter(([, c]) => c.upsert.length > 0 || c.delete.length > 0));
      const { data, error } = await db.rpc('apply_changes', { p_expected_revision: expectedRevision, p_changes: payload });
      if (error) {
        if (error.message === 'conflict') return { ok: false, reason: 'conflict' };
        fail('save', error);
      }
      return { ok: true, revision: Number(data) };
    },

    async claimJobRun(key, at) {
      const { data, error } = await db.rpc('claim_job_run', { p_key: key, p_at: at.toISOString() });
      if (error) fail('claimJobRun', error);
      return data === true;
    },
  };

  const auth: AuthRepository = {
    async passkeyCount() {
      const { count, error } = await db.from('passkeys').select('id', { count: 'exact', head: true });
      if (error) fail('passkeyCount', error);
      return count ?? 0;
    },
    async listPasskeys() {
      const rows = await selectAll<{ data: StoredPasskey }>('listPasskeys', (from, to) =>
        db.from('passkeys').select('data').order('id').range(from, to).returns<{ data: StoredPasskey }[]>(),
      );
      return rows.map((r) => r.data).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
    async addFirstPasskey(p) {
      const { data, error } = await db.rpc('add_first_passkey', { p_id: p.id, p_data: p });
      if (error) fail('addFirstPasskey', error);
      return data === true;
    },
    async addPasskey(p) {
      const { error } = await db.from('passkeys').insert({ id: p.id, data: p });
      if (error) fail('addPasskey', error);
    },
    async updateCounter(id, counter) {
      const { data, error } = await db.from('passkeys').select('data').eq('id', id).maybeSingle<{ data: StoredPasskey }>();
      if (error) fail('updateCounter', error);
      if (!data) return;
      const res = await db.from('passkeys').update({ data: { ...data.data, counter }, updated_at: new Date().toISOString() }).eq('id', id);
      if (res.error) fail('updateCounter', res.error);
    },
    async replaceRecoveryCodes(hashes) {
      // Erst die neuen anlegen, dann alle anderen löschen: bricht der zweite Schritt ab, bleibt man nicht ohne Codes.
      if (hashes.length > 0) {
        const ins = await db.from('recovery_codes').upsert(hashes.map((hash) => ({ hash, used_at: null })), { onConflict: 'hash' });
        if (ins.error) fail('replaceRecoveryCodes', ins.error);
      }
      const del = hashes.length > 0
        ? await db.from('recovery_codes').delete().not('hash', 'in', `(${hashes.map((h) => `"${h}"`).join(',')})`)
        : await db.from('recovery_codes').delete().neq('hash', '');
      if (del.error) fail('replaceRecoveryCodes', del.error);
    },
    async consumeRecoveryCode(hash, at) {
      const { data, error } = await db.rpc('consume_recovery_code', { p_hash: hash, p_at: at.toISOString() });
      if (error) fail('consumeRecoveryCode', error);
      return data === true;
    },
  };

  return { state, auth };
}
