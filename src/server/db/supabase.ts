import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { realNow } from '@/domain/clock';
import type { AuthRepository, Repos, StateRepository, StoredPasskey } from './repository';
import { fromRows, TABLES, WITH_EXTERNAL_TABLES, type ChangeSet, type Row, type TableName } from './tables';

const PAGE = 1000; // PostgREST liefert standardmäßig höchstens 1000 Zeilen je Anfrage
const TABLE_NAMES = [...new Set(Object.values(TABLES))] as TableName[];

function columns(t: TableName): string {
  if (WITH_EXTERNAL_TABLES.has(t)) return 'id,ord,data,connection_id,external_id';
  if (t === 'insights') return 'id,ord,data,dedupe_key';
  return 'id,ord,data';
}

/** Tabellen, die fehlen dürfen (Migration noch nicht eingespielt). */
const OPTIONAL_TABLES: ReadonlySet<TableName> = new Set<TableName>(['portal_members', 'ignored_portal_members', 'order_confirmations', 'invoice_readings']);

function fail(what: string, error: { message: string; code?: string }): never {
  throw Object.assign(new Error(`Supabase ${what}: ${error.message}`), { code: error.code });
}

/** Nur „Tabelle existiert nicht“ (PostgREST PGRST205, Postgres 42P01); Netz-, Rechte- und Serverfehler nicht. */
function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string };
  return x.code === 'PGRST205' || x.code === '42P01' || /could not find the table|schema cache/i.test(x.message ?? '');
}

/**
 * Liest alle Zeilen seitenweise in stabiler Reihenfolge. Weiter bis eine leere Seite kommt: Ist max-rows im Projekt
 * kleiner als PAGE, liefert der Server weniger Zeilen, ohne dass die Tabelle zu Ende ist.
 */
async function selectAll<T>(what: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (;;) {
    const from = out.length;
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) fail(what, error);
    if (!data || data.length === 0) return out;
    out.push(...data);
  }
}

/** Server-Repository auf Supabase. Nur mit Service-Role-Key und nur serverseitig verwenden. */
export function createSupabaseRepos(url: string, serviceRoleKey: string): Repos {
  return createSupabaseReposFromClient(createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }));
}

/** Kern mit injiziertem Client (Testnaht). */
export function createSupabaseReposFromClient(db: SupabaseClient): Repos {

  const state: StateRepository = {
    async load() {
      // Reihenfolge ist Invariante: ERST die Revision vollständig lesen, DANN die Tabellen. Landet während des
      // Tabellenlesens ein Save, ist die gelesene Revision älter als der Stand, und der nächste Save scheitert mit
      // conflict (und lädt neu). Parallel gelesen könnte alter Inhalt mit neuer Revision zusammenkommen → Lost Update.
      const meta = await db.from('meta').select('value').eq('key', 'revision').single();
      if (meta.error) fail('load meta', meta.error);
      const revision = Number((meta.data as { value: unknown }).value);
      const tables = await Promise.all(
        TABLE_NAMES.map(async (t) => {
          try {
            const rows = await selectAll<Row>(`load ${t}`, (from, to) =>
              db.from(t).select(columns(t)).order('ord').order('id').range(from, to).overrideTypes<Row[], { merge: false }>(),
            );
            return [t, rows] as const;
          } catch (e) {
            // Portal-Tabellen kommen mit einer späteren Migration: läuft sie erst nach dem Deploy, startet die App mit leeren Listen.
            if (OPTIONAL_TABLES.has(t) && isMissingTable(e)) return [t, [] as Row[]] as const;
            throw e;
          }
        }),
      );
      const rows = Object.fromEntries(tables) as Record<TableName, Row[]>;
      return { state: fromRows(rows), revision };
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

    async recentJobRuns(since) {
      const rows = await selectAll<{ key: string }>('recentJobRuns', (from, to) =>
        db.from('job_runs').select('key').gte('ran_at', since.toISOString()).order('ran_at').order('key').range(from, to)
          .overrideTypes<{ key: string }[], { merge: false }>(),
      );
      return rows.map((x) => x.key);
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
        db.from('passkeys').select('data').order('id').range(from, to).overrideTypes<{ data: StoredPasskey }[], { merge: false }>(),
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
      const res = await db.from('passkeys').update({ data: { ...data.data, counter }, updated_at: realNow().toISOString() }).eq('id', id);
      if (res.error) fail('updateCounter', res.error);
    },
    async replaceRecoveryCodes(hashes) {
      // Ein RPC mit Tabellensperre: parallele Aufrufe können sich nicht gegenseitig die neuen Codes löschen.
      const { error } = await db.rpc('replace_recovery_codes', { p_hashes: hashes });
      if (error) fail('replaceRecoveryCodes', error);
    },
    async consumeRecoveryCode(hash, at) {
      const { data, error } = await db.rpc('consume_recovery_code', { p_hash: hash, p_at: at.toISOString() });
      if (error) fail('consumeRecoveryCode', error);
      return data === true;
    },
  };

  return { state, auth };
}
