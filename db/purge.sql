-- ERASING A FIRM'S SPACE (Paul, 2026-10-11: « quand je ferme mon compte, je veux que toutes les données du
-- cabinet partent ; quand je recrée un compte, je remplis ce qu'il y a à remplir »).
-- The application's backend may NOT delete rows (most tables are insert / update only, the audit tables
-- append-only). This ONE function, owned by the database owner, is the only way to erase a firm's data:
--   - every table of the public schema whose name starts with office_, orpailleur_ or taty_ and that has an
--     org_id column: its rows for this firm are deleted (foreign keys: several passes, children first);
--   - office_organizations (the firm's identity, referenced by memberships and permissions) is kept;
--   - the firm's documents in its Drive are never touched here (they belong to the firm).
-- Safety: callable by the backend only (service_role), never by a browser; it refuses unless p_confirm is
-- exactly 'EFFACER ' || the firm's id; p_dry_run = true only counts what would be erased.
-- Safe to re-run (create or replace).
begin;
create or replace function public.office_purge_firm(p_org uuid, p_confirm text, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  n bigint;
  counts jsonb := '{}'::jsonb;
  pending text[] := '{}';
  next_pending text[];
  pass int := 0;
begin
  if p_org is null or p_confirm is distinct from ('EFFACER ' || p_org::text) then
    raise exception 'PURGE_CONFIRMATION_REQUIRED' using errcode = '22023';
  end if;
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'org_id'
       and (c.table_name like 'office\_%' or c.table_name like 'orpailleur\_%' or c.table_name like 'taty\_%')
       and c.table_name <> 'office_organizations'
     order by c.table_name
  loop
    execute format('select count(*) from public.%I where org_id::text = $1', t.table_name) into n using p_org::text;
    counts := counts || jsonb_build_object(t.table_name, n);
    if n > 0 then pending := pending || t.table_name::text; end if;
  end loop;
  if p_dry_run then
    return jsonb_build_object('dry_run', true, 'rows', counts, 'tables', coalesce(array_length(pending, 1), 0));
  end if;
  -- Children before parents: a table refused because others still point to it is retried in a later pass.
  while coalesce(array_length(pending, 1), 0) > 0 and pass < 12 loop
    pass := pass + 1;
    next_pending := '{}';
    for i in 1 .. array_length(pending, 1) loop
      begin
        execute format('delete from public.%I where org_id::text = $1', pending[i]) using p_org::text;
      exception when foreign_key_violation then
        next_pending := next_pending || pending[i];
      end;
    end loop;
    exit when next_pending = pending;
    pending := next_pending;
  end loop;
  -- The mission change log is fed by triggers: deleting the missions above wrote new lines into it after it was
  -- emptied. Erase them last, so nothing of the firm remains (db/mission-shared-memory.sql, 2026-10-24).
  if to_regclass('public.office_mission_change_log') is not null then
    delete from public.office_mission_change_log where org_id = p_org;
  end if;
  return jsonb_build_object('dry_run', false, 'rows', counts, 'passes', pass, 'not_erased', to_jsonb(pending));
end;
$$;
revoke all on function public.office_purge_firm(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.office_purge_firm(uuid, text, boolean) to service_role;
commit;
