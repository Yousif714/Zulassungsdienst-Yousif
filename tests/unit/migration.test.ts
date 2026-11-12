import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TABLES } from '@/server/db/tables';

const FILE = 'supabase/migrations/20261112000000_fundament.sql';
const sql = existsSync(FILE) ? readFileSync(FILE, 'utf8').toLowerCase().replace(/\s+/g, ' ') : '';
const ALL = [...new Set<string>(Object.values(TABLES)), 'passkeys', 'recovery_codes', 'job_runs', 'meta'];
const FUNCS = ['apply_changes', 'claim_job_run', 'add_first_passkey', 'consume_recovery_code'];

describe('Migration Fundament', () => {
  it('Datei existiert', () => {
    expect(existsSync(FILE)).toBe(true);
  });

  it.each(ALL)('Tabelle %s: create table und RLS', (t) => {
    expect(sql).toContain(`create table ${t} (`);
    expect(sql).toContain(`alter table ${t} enable row level security;`);
  });

  it('jede Zustandstabelle hat eine ord-Spalte', () => {
    for (const t of new Set(Object.values(TABLES))) {
      expect(sql).toMatch(new RegExp(`create table ${t} \\([^;]*\\bord int not null`));
    }
  });

  it('keine Policies, anon/authenticated ohne Rechte', () => {
    expect(sql).not.toContain('create policy');
    expect(sql).toContain('revoke all on all tables in schema public from anon, authenticated;');
  });

  it.each(FUNCS)('Funktion %s existiert, search_path fest, execute entzogen', (f) => {
    expect(sql).toMatch(new RegExp(`create (or replace )?function ${f}\\(`));
    const body = sql.slice(sql.indexOf(`function ${f}(`));
    expect(body.slice(0, body.indexOf('$$'))).toContain('set search_path = public');
    expect(sql).toMatch(new RegExp(`revoke execute on function ${f}\\([^)]*\\) from public, anon, authenticated;`));
  });

  it('apply_changes prüft gegen feste Liste und nutzt format(%I)', () => {
    expect(sql).toContain("raise exception 'conflict'");
    expect(sql).toContain("format('");
    expect(sql).toContain('%i');
    for (const t of new Set(Object.values(TABLES))) expect(sql).toContain(`'${t}'`);
  });

  it('Unique-Indizes laut Spec', () => {
    for (const t of ['payments', 'invoices', 'messages', 'events']) {
      expect(sql).toMatch(new RegExp(`unique index [a-z_]+ on ${t} \\(connection_id, external_id\\)`));
    }
    expect(sql).toMatch(/unique index [a-z_]+ on insights \(dedupe_key\)/);
    expect(sql).toContain('create table job_runs ( key text primary key');
    expect(sql).toContain('create table recovery_codes ( hash text primary key');
    expect(sql).toContain('create table meta ( key text primary key');
    expect(sql).toMatch(/\('schema_version', '1'\)/);
    expect(sql).toMatch(/\('revision', '0'\)/);
  });
});
