-- Nexus-Assistent Phase 2a: Fundament (Schema, RLS, transaktionale Funktionen)
-- Zugriff ausschließlich serverseitig mit dem Service-Role-Key. anon/authenticated haben keinerlei Rechte,
-- RLS ist auf jeder Tabelle aktiv und es gibt bewusst keine Policy (deny all für alle außer service_role).

-- Zustandstabellen: eine Zeile je Element eines AppState-Arrays, ord = Position im Array.

create table connections (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table contacts (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table contracts (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table payments (
  id text primary key,
  ord int not null,
  data jsonb not null,
  connection_id text,
  external_id text,
  updated_at timestamptz not null default now()
);

create table invoices (
  id text primary key,
  ord int not null,
  data jsonb not null,
  connection_id text,
  external_id text,
  updated_at timestamptz not null default now()
);

create table messages (
  id text primary key,
  ord int not null,
  data jsonb not null,
  connection_id text,
  external_id text,
  updated_at timestamptz not null default now()
);

create table commitments (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table events (
  id text primary key,
  ord int not null,
  data jsonb not null,
  connection_id text,
  external_id text,
  updated_at timestamptz not null default now()
);

create table calls (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table content (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table vehicles (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table jobs (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table actions (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table insights (
  id text primary key,
  ord int not null,
  data jsonb not null,
  dedupe_key text not null,
  updated_at timestamptz not null default now()
);

create table assistant_messages (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table allocations (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table iban_links (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table contract_exceptions (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table audit (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table settings (
  id text primary key,
  ord int not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);


create unique index payments_connection_external_key on payments (connection_id, external_id);
create unique index invoices_connection_external_key on invoices (connection_id, external_id);
create unique index messages_connection_external_key on messages (connection_id, external_id);
create unique index events_connection_external_key on events (connection_id, external_id);
create unique index insights_dedupe_key on insights (dedupe_key);

-- Auth und Betrieb
create table passkeys (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table recovery_codes (
  hash text primary key,
  used_at timestamptz
);

create table job_runs (
  key text primary key,
  ran_at timestamptz not null default now()
);

create table meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into meta (key, value) values ('schema_version', '1'), ('revision', '0');

-- Row Level Security: aktiv, ohne Policy

alter table connections enable row level security;
alter table contacts enable row level security;
alter table contracts enable row level security;
alter table payments enable row level security;
alter table invoices enable row level security;
alter table messages enable row level security;
alter table commitments enable row level security;
alter table events enable row level security;
alter table calls enable row level security;
alter table content enable row level security;
alter table vehicles enable row level security;
alter table jobs enable row level security;
alter table actions enable row level security;
alter table insights enable row level security;
alter table assistant_messages enable row level security;
alter table allocations enable row level security;
alter table iban_links enable row level security;
alter table contract_exceptions enable row level security;
alter table audit enable row level security;
alter table settings enable row level security;
alter table passkeys enable row level security;
alter table recovery_codes enable row level security;
alter table job_runs enable row level security;
alter table meta enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

-- Speichert einen ChangeSet atomar (eine Funktion = eine Transaktion).
-- p_changes: { "<tabelle>": { "upsert": [{ id, ord, data, connection_id?, external_id?, dedupe_key? }], "delete": [id, ...] } }
create or replace function apply_changes(p_expected_revision int, p_changes jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'connections',
    'contacts',
    'contracts',
    'payments',
    'invoices',
    'messages',
    'commitments',
    'events',
    'calls',
    'content',
    'vehicles',
    'jobs',
    'actions',
    'insights',
    'assistant_messages',
    'allocations',
    'iban_links',
    'contract_exceptions',
    'audit',
    'settings'
  ];
  v_external constant text[] := array['payments', 'invoices', 'messages', 'events'];
  v_revision int;
  v_table text;
  v_change jsonb;
  v_upsert jsonb;
  v_delete jsonb;
begin
  select (value #>> '{}')::int into v_revision from meta where key = 'revision' for update;
  if v_revision is null then
    raise exception 'revision missing';
  end if;
  if v_revision <> p_expected_revision then
    raise exception 'conflict';
  end if;
  if jsonb_typeof(p_changes) <> 'object' then
    raise exception 'invalid changes';
  end if;

  -- Erst alle Tabellennamen prüfen, dann schreiben.
  for v_table in select jsonb_object_keys(p_changes) loop
    if not (v_table = any (v_allowed)) then
      raise exception 'unknown table: %', v_table;
    end if;
  end loop;

  for v_table, v_change in select key, value from jsonb_each(p_changes) loop
    v_delete := coalesce(v_change -> 'delete', '[]'::jsonb);
    v_upsert := coalesce(v_change -> 'upsert', '[]'::jsonb);

    if jsonb_array_length(v_delete) > 0 then
      execute format('delete from %I where id in (select jsonb_array_elements_text($1))', v_table) using v_delete;
    end if;

    if jsonb_array_length(v_upsert) > 0 then
      if v_table = any (v_external) then
        execute format(
          'insert into %I (id, ord, data, connection_id, external_id, updated_at) '
          'select r ->> ''id'', (r ->> ''ord'')::int, r -> ''data'', r ->> ''connection_id'', r ->> ''external_id'', now() '
          'from jsonb_array_elements($1) r '
          'on conflict (id) do update set ord = excluded.ord, data = excluded.data, '
          'connection_id = excluded.connection_id, external_id = excluded.external_id, updated_at = now()',
          v_table) using v_upsert;
      elsif v_table = 'insights' then
        execute format(
          'insert into %I (id, ord, data, dedupe_key, updated_at) '
          'select r ->> ''id'', (r ->> ''ord'')::int, r -> ''data'', r ->> ''dedupe_key'', now() '
          'from jsonb_array_elements($1) r '
          'on conflict (id) do update set ord = excluded.ord, data = excluded.data, '
          'dedupe_key = excluded.dedupe_key, updated_at = now()',
          v_table) using v_upsert;
      else
        execute format(
          'insert into %I (id, ord, data, updated_at) '
          'select r ->> ''id'', (r ->> ''ord'')::int, r -> ''data'', now() '
          'from jsonb_array_elements($1) r '
          'on conflict (id) do update set ord = excluded.ord, data = excluded.data, updated_at = now()',
          v_table) using v_upsert;
      end if;
    end if;
  end loop;

  update meta set value = to_jsonb(v_revision + 1), updated_at = now() where key = 'revision';
  return v_revision + 1;
end;
$$;

-- Genau ein Aufrufer je Schlüssel bekommt true.
create or replace function claim_job_run(p_key text, p_at timestamptz)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into job_runs (key, ran_at) values (p_key, p_at) on conflict (key) do nothing;
  return found;
end;
$$;

-- Erster Passkey nur, solange noch keiner existiert (Tabellensperre gegen parallele Registrierung).
create or replace function add_first_passkey(p_id text, p_data jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  lock table passkeys in exclusive mode;
  if exists (select 1 from passkeys) then
    return false;
  end if;
  insert into passkeys (id, data) values (p_id, p_data);
  return true;
end;
$$;

-- Wiederherstellungscode genau einmal einlösbar.
create or replace function consume_recovery_code(p_hash text, p_at timestamptz)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  update recovery_codes set used_at = p_at where hash = p_hash and used_at is null;
  return found;
end;
$$;

-- Ersetzt alle Wiederherstellungscodes atomar (Tabellensperre: parallele Aufrufe laufen nacheinander,
-- danach gilt genau ein vollständiger Satz).
create or replace function replace_recovery_codes(p_hashes text[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  lock table recovery_codes in exclusive mode;
  delete from recovery_codes where true; -- where: verträgt pg-safeupdate
  insert into recovery_codes (hash)
  select distinct h from unnest(p_hashes) as h where h is not null;
end;
$$;

revoke execute on function apply_changes(int, jsonb) from public, anon, authenticated;
revoke execute on function claim_job_run(text, timestamptz) from public, anon, authenticated;
revoke execute on function add_first_passkey(text, jsonb) from public, anon, authenticated;
revoke execute on function consume_recovery_code(text, timestamptz) from public, anon, authenticated;
revoke execute on function replace_recovery_codes(text[]) from public, anon, authenticated;
grant execute on function apply_changes(int, jsonb) to service_role;
grant execute on function claim_job_run(text, timestamptz) to service_role;
grant execute on function add_first_passkey(text, jsonb) to service_role;
grant execute on function consume_recovery_code(text, timestamptz) to service_role;
grant execute on function replace_recovery_codes(text[]) to service_role;
