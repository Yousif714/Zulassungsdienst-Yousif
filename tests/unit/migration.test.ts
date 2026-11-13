import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TABLES } from '@/server/db/tables';

const DIR = 'supabase/migrations';
const FILE = `${DIR}/20261112000000_fundament.sql`;
const read = (f: string) => readFileSync(f, 'utf8').toLowerCase().replace(/\s+/g, ' ');
// Alle Migrationen in Namensreihenfolge verkettet: die Prüfungen gelten für den Endstand des Schemas.
const sql = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => read(`${DIR}/${f}`)).join(' ') : '';
const ALL = [...new Set<string>(Object.values(TABLES)), 'passkeys', 'recovery_codes', 'job_runs', 'meta'];
const FUNCS = ['apply_changes', 'claim_job_run', 'add_first_passkey', 'consume_recovery_code', 'replace_recovery_codes'];

describe('Migration Fundament', () => {
  it('Datei existiert', () => {
    expect(existsSync(FILE)).toBe(true);
  });

  it.each(ALL)('Tabelle %s: create table und RLS', (t) => {
    expect(sql).toMatch(new RegExp(`create table (if not exists )?${t} \\(`));
    expect(sql).toContain(`alter table ${t} enable row level security;`);
  });

  it('jede Zustandstabelle hat eine ord-Spalte', () => {
    for (const t of new Set(Object.values(TABLES))) {
      expect(sql).toMatch(new RegExp(`create table (if not exists )?${t} \\([^;]*\\bord int not null`));
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

  it('replace_recovery_codes sperrt die Tabelle und ersetzt alle Codes', () => {
    const body = sql.slice(sql.indexOf('function replace_recovery_codes('));
    const fn = body.slice(0, body.indexOf('$$;'));
    expect(fn).toContain('lock table recovery_codes in exclusive mode');
    expect(fn).toContain('delete from recovery_codes');
    expect(fn).toContain('unnest(p_hashes)');
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

describe('Migration Verträge', () => {
  it('Tabellen, RLS, Unique-Index, apply_changes kennt die neuen Tabellen', () => {
    const v = read(`${DIR}/20261113000000_vertraege.sql`);
    for (const t of ['subscriptions', 'dismissed_proposals']) {
      expect(v).toContain(`create table ${t} (`);
      expect(v).toContain(`alter table ${t} enable row level security;`);
    }
    expect(v).toMatch(/unique index [a-z_]+ on subscriptions \(connection_id, external_id\)/);
    expect(v).toContain('create or replace function apply_changes(');
    expect(v).toMatch(/v_external constant text\[\] := array\[[^\]]*'subscriptions'/);
    expect(v).toMatch(/revoke execute on function apply_changes\(int, jsonb\) from public, anon, authenticated;/);
  });
});

describe('Migration Qonto (2b-2)', () => {
  it('2b-2: bank → bank_qonto in connections, payments, insights', () => {
    expect(sql).toContain("where connection_id = 'bank'");
    expect(sql).toContain("delete from connections where id = 'bank'");
    expect(sql).toContain("'\"bank_qonto\"'");
    expect(sql).toContain('order by n');
  });
});

describe('Migration Portal', () => {
  it('idempotent, apply_changes kennt beide Tabellen', () => {
    const p = read(`${DIR}/20261115000000_portal.sql`);
    expect(p).toContain('create table if not exists portal_members (');
    expect(p).toContain('create table if not exists ignored_portal_members (');
    expect(p).toContain('create unique index if not exists portal_members_connection_external_key');
    expect(p).toMatch(/v_external constant text\[\] := array\[[^\]]*'portal_members'/);
    expect(p).toMatch(/v_allowed constant text\[\] := array\[[^\]]*'ignored_portal_members'/);
  });
});

describe('Migration Auftragsbestätigungen', () => {
  it('idempotent, apply_changes kennt order_confirmations als Tabelle mit Schlüsselspalten', () => {
    const p = read(`${DIR}/20261116000000_auftragsbestaetigungen.sql`);
    expect(p).toContain('create table if not exists order_confirmations (');
    expect(p).toContain('create unique index if not exists order_confirmations_connection_external_key');
    expect(p).toContain('alter table order_confirmations enable row level security;');
    expect(p).toMatch(/v_external constant text\[\] := array\[[^\]]*'order_confirmations'/);
    expect(p).toMatch(/v_allowed constant text\[\] := array\[[^\]]*'ignored_portal_members', 'order_confirmations'/);
    expect(p).not.toMatch(/drop table|truncate|alter table \w+ drop/);
  });
});

describe('Migration Rechnungen lesen', () => {
  it('idempotent, RLS, apply_changes kennt invoice_readings', () => {
    const p = read(`${DIR}/20261117000000_rechnungen_lesen.sql`);
    expect(p).toContain('create table if not exists invoice_readings (');
    expect(p).toContain('alter table invoice_readings enable row level security;');
    expect(p).toMatch(/v_allowed constant text\[\] := array\[[^\]]*'order_confirmations', 'invoice_readings'/);
    expect(p).toMatch(/v_external constant text\[\] := array\['payments', 'invoices', 'messages', 'events', 'subscriptions', 'portal_members', 'order_confirmations'\]/);
    expect(p).not.toMatch(/drop table|truncate|alter table \w+ drop/);
  });
});
