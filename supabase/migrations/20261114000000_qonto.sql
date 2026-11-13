-- Paket 2b-2: Verbindung 'bank' heißt jetzt 'bank_qonto'. Idempotent, ohne Datenverlust.
insert into connections (id, ord, data, updated_at)
  select 'bank_qonto', ord, jsonb_set(jsonb_set(jsonb_set(data, '{id}', '"bank_qonto"'), '{label}', '"Qonto (NEXUS)"'), '{company}', '"nexus"'), now()
  from connections where id = 'bank' and not exists (select 1 from connections where id = 'bank_qonto');
delete from connections where id = 'bank';
update payments set connection_id = 'bank_qonto', data = jsonb_set(data, '{connectionId}', '"bank_qonto"') where connection_id = 'bank';
update insights set data = jsonb_set(data, '{needsSources}', (select coalesce(jsonb_agg(case when x = '"bank"'::jsonb then '"bank_qonto"'::jsonb else x end), '[]'::jsonb) from jsonb_array_elements(data -> 'needsSources') x))
  where data -> 'needsSources' ? 'bank';
