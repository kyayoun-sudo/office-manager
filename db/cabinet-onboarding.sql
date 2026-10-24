-- SEVERAL FIRMS IN ONE INSTALLATION (Paul, 2026-10-24): create a firm, invite people into it.
-- Safe to re-run: only « create … if not exists », « add column if not exists », « create or replace ».
-- Server only (service_role): no browser ever reads or writes these tables (RLS on, no policy).
begin;

-- A firm created from the application, once per (person, name): a double click or a retry returns the same firm.
create table if not exists public.office_cabinet_creations (
  org_id uuid primary key references public.office_organizations(id) on delete cascade,
  auth_user_id uuid not null,
  name_key text not null,
  created_at timestamptz not null default now(),
  unique (auth_user_id, name_key)
);
alter table public.office_cabinet_creations enable row level security;
revoke all on public.office_cabinet_creations from public, anon, authenticated;
grant select, insert, delete on public.office_cabinet_creations to service_role;

create or replace function public.office_create_cabinet(
  p_auth_user_id uuid, p_email text, p_name text, p_display_name text, p_timezone text default 'UTC'
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid;
  v_email text := lower(btrim(p_email));
  v_key text := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
begin
  if current_user <> 'service_role' and current_user <> 'postgres' then raise exception 'SERVER_ONLY'; end if;
  if p_auth_user_id is null or length(v_key) not between 1 and 120
     or length(btrim(coalesce(p_display_name, ''))) not between 1 and 120
     or v_email is null or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or length(coalesce(p_timezone, '')) not between 1 and 64 then
    raise exception 'INVALID_CABINET';
  end if;
  -- One provisioning at a time per person (double click, retry): the same name gives back the same firm.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_auth_user_id::text, 0));
  select org_id into v_org from public.office_cabinet_creations where auth_user_id = p_auth_user_id and name_key = v_key;
  if v_org is not null then return jsonb_build_object('org_id', v_org, 'created', false); end if;
  v_org := gen_random_uuid();
  insert into public.office_organizations(id, slug, name, timezone) values (v_org, 'cabinet-' || v_org::text, btrim(p_name), p_timezone);
  insert into public.office_app_users(org_id, auth_user_id, email, display_name, role, active)
    values (v_org, p_auth_user_id, v_email, btrim(p_display_name), 'owner', true);
  insert into public.office_memberships(org_id, user_id, role, active) values (v_org, p_auth_user_id, 'owner', true);
  insert into public.office_cabinet_creations(org_id, auth_user_id, name_key) values (v_org, p_auth_user_id, v_key);
  -- Nothing copied from another firm: no Drive, no Google, no agent authorisation, no settings.
  return jsonb_build_object('org_id', v_org, 'created', true);
end;
$$;
revoke all on function public.office_create_cabinet(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.office_create_cabinet(uuid, text, text, text, text) to service_role;

-- Invitations: a link for ONE address, or a code to share. Only a hash is kept; single use; expires; revocable.
create table if not exists public.office_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  kind text not null check (kind in ('link', 'code')),
  email text check (email is null or (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  secret_hash text not null unique,
  role text not null,
  invited_by text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid,
  revoked_at timestamptz,
  revoked_by text,
  created_at timestamptz not null default now(),
  check (kind = 'code' or email is not null)
);
create index if not exists office_invitations_org on public.office_invitations(org_id, created_at desc);
alter table public.office_invitations enable row level security;
revoke all on public.office_invitations from public, anon, authenticated;
grant select, insert, update on public.office_invitations to service_role;
commit;
