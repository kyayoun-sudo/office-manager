-- Simulation : un cabinet d'entraînement, fils d'un cabinet réel (2026-11-18). Additif : rien n'est modifié ni supprimé.
alter table public.office_organizations add column if not exists parent_org_id uuid references public.office_organizations(id);
create index if not exists office_organizations_parent on public.office_organizations(parent_org_id) where parent_org_id is not null;
create table if not exists public.office_simulation_creations (
  org_id uuid primary key references public.office_organizations(id) on delete cascade,
  auth_user_id uuid not null,
  parent_org_id uuid not null,
  name_key text not null,
  created_at timestamptz not null default now(),
  unique (auth_user_id, parent_org_id, name_key)
);
alter table public.office_simulation_creations enable row level security;

create or replace function public.office_create_simulation(
  p_auth_user_id uuid, p_parent_org uuid, p_name text, p_display_name text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid;
  v_kind text;
  v_email text;
  v_key text := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
begin
  if current_user <> 'service_role' and current_user <> 'postgres' then raise exception 'SERVER_ONLY'; end if;
  if p_auth_user_id is null or p_parent_org is null or length(v_key) not between 1 and 120
     or length(btrim(coalesce(p_display_name, ''))) not between 1 and 120 then
    raise exception 'INVALID_SIMULATION';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_auth_user_id::text || p_parent_org::text, 1));
  select account_kind into v_kind from public.office_organizations where id = p_parent_org;
  if v_kind = 'simulation' then raise exception 'PARENT_IS_SIMULATION'; end if;
  select email into v_email from public.office_app_users where org_id = p_parent_org and auth_user_id = p_auth_user_id and active = true limit 1;
  if v_email is null then raise exception 'NOT_IN_PARENT'; end if;
  select org_id into v_org from public.office_simulation_creations where auth_user_id = p_auth_user_id and parent_org_id = p_parent_org and name_key = v_key;
  if v_org is not null then return jsonb_build_object('org_id', v_org, 'created', false); end if;
  v_org := gen_random_uuid();
  insert into public.office_organizations(id, slug, name, timezone, account_kind, parent_org_id)
    select v_org, 'simulation-' || v_org::text, btrim(p_name), coalesce(o.timezone, 'UTC'), 'simulation', p_parent_org
    from public.office_organizations o where o.id = p_parent_org;
  insert into public.office_app_users(org_id, auth_user_id, email, display_name, role, active)
    values (v_org, p_auth_user_id, v_email, btrim(p_display_name), 'owner', true);
  insert into public.office_memberships(org_id, user_id, role, active) values (v_org, p_auth_user_id, 'owner', true);
  insert into public.office_simulation_creations(org_id, auth_user_id, parent_org_id, name_key) values (v_org, p_auth_user_id, p_parent_org, v_key);
  return jsonb_build_object('org_id', v_org, 'created', true);
end;
$$;
revoke all on function public.office_create_simulation(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.office_create_simulation(uuid, uuid, text, text) to service_role;
