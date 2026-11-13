import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseReposFromClient } from '@/server/db/supabase';

type Res = { data: unknown; error: null; count?: number };

/** Minimaler Fake: Builder sind wie bei postgrest-js lazy (Anfrage startet erst bei then). */
function fakeClient(log: string[], pageRows: (table: string, from: number) => unknown[], rpcs: [string, unknown][] = []) {
  function builder(table: string): Record<string, unknown> {
    let from = 0;
    let single = false;
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'overrideTypes']) b[m] = () => b;
    b.gte = (col: string, v: string) => { log.push(`gte ${table}.${col} ${v}`); return b; };
    b.range = (f: number) => { from = f; return b; };
    b.single = () => { single = true; return b; };
    b.then = (resolve: (r: Res) => void) => {
      log.push(`start ${table}`);
      const delay = table === 'meta' ? 20 : 0;
      setTimeout(() => {
        log.push(`end ${table}`);
        resolve(single ? { data: { value: 3 }, error: null } : { data: pageRows(table, from), error: null });
      }, delay);
    };
    return b;
  }
  return { from: (t: string) => builder(t), rpc: (fn: string, args: unknown) => { rpcs.push([fn, args]); return Promise.resolve({ data: null, error: null }); } } as unknown as SupabaseClient;
}

describe('Supabase-Repository (ohne Netz)', () => {
  it('load liest die Revision vollständig, bevor eine Tabelle gelesen wird', async () => {
    const log: string[] = [];
    const repos = createSupabaseReposFromClient(fakeClient(log, () => []));
    const r = await repos.state.load();
    expect(r.revision).toBe(3);
    const metaEnd = log.indexOf('end meta');
    const firstTable = log.findIndex((x) => x.startsWith('start ') && x !== 'start meta');
    expect(metaEnd).toBeGreaterThanOrEqual(0);
    expect(firstTable).toBeGreaterThan(metaEnd);
    expect(log).not.toContain('start job_runs');
  });

  it('recentJobRuns liest nur job_runs ab dem Stichtag', async () => {
    const log: string[] = [];
    const repos = createSupabaseReposFromClient(fakeClient(log, (t, from) => (t === 'job_runs' && from === 0 ? [{ key: 'sync:x' }] : [])));
    expect(await repos.state.recentJobRuns(new Date('2026-11-04T00:00:00Z'))).toEqual(['sync:x']);
    expect(log).toContain('gte job_runs.ran_at 2026-11-04T00:00:00.000Z');
  });

  it('Paging läuft weiter bis eine leere Seite kommt (auch bei kleinem max-rows)', async () => {
    const log: string[] = [];
    // Server liefert nur 2 Zeilen je Seite, unabhängig von der angefragten Spanne.
    const contacts = Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, ord: i, data: { id: `k${i}` } }));
    const repos = createSupabaseReposFromClient(fakeClient(log, (t, from) => {
      if (t !== 'contacts') return [];
      return contacts.slice(from, from + 2);
    }));
    const { state } = await repos.state.load();
    expect(state.contacts.map((c) => c.id)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
  });

  it('replaceRecoveryCodes ist ein einziger RPC-Aufruf', async () => {
    const rpcs: [string, unknown][] = [];
    const repos = createSupabaseReposFromClient(fakeClient([], () => [], rpcs));
    await repos.auth.replaceRecoveryCodes(['h1', 'h2']);
    expect(rpcs).toEqual([['replace_recovery_codes', { p_hashes: ['h1', 'h2'] }]]);
  });
});

describe('Supabase-Repository: Portal-Tabellen fehlen noch', () => {
  /** Client, dessen Portal-Tabellen mit `portalError` antworten; alles andere leer. */
  function clientWithPortalError(portalError: { message: string; code?: string }) {
    const base = fakeClient([], () => []) as unknown as { from: (t: string) => Record<string, unknown> };
    return {
      ...base,
      from: (t: string) => {
        const b = base.from(t);
        if (t !== 'portal_members') return b;
        b.then = (resolve: (r: unknown) => void) => resolve({ data: null, error: portalError });
        return b;
      },
    } as unknown as SupabaseClient;
  }

  it('fehlende Tabelle (PGRST205) → leere Liste, App lädt', async () => {
    const repos = createSupabaseReposFromClient(clientWithPortalError({ code: 'PGRST205', message: "Could not find the table 'public.portal_members' in the schema cache" }));
    const { state } = await repos.state.load();
    expect(state.portalMembers).toEqual([]);
  });

  it('Postgres 42P01 → leere Liste', async () => {
    const repos = createSupabaseReposFromClient(clientWithPortalError({ code: '42P01', message: 'relation "portal_members" does not exist' }));
    expect((await repos.state.load()).state.portalMembers).toEqual([]);
  });

  it('fehlende Tabelle order_confirmations → leere Liste, App lädt', async () => {
    const base = fakeClient([], () => []) as unknown as { from: (t: string) => Record<string, unknown> };
    const client = { ...base, from: (t: string) => {
      const b = base.from(t);
      if (t === 'order_confirmations') b.then = (resolve: (r: unknown) => void) => resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.order_confirmations' in the schema cache" } });
      return b;
    } } as unknown as SupabaseClient;
    expect((await createSupabaseReposFromClient(client).state.load()).state.orderConfirmations).toEqual([]);
  });

  it('anderer Fehler (Netz, Rechte) → load wirft', async () => {
    const repos = createSupabaseReposFromClient(clientWithPortalError({ message: 'FetchError: network down' }));
    await expect(repos.state.load()).rejects.toThrow(/portal_members/);
  });
});
