-- Additive server-only provisioning. Apply only after the complete tenant rollout review.
begin;
create table if not exists public.office_cabinet_registrations (
  auth_user_id uuid primary key references auth.users(id),
  org_id uuid not null unique references public.office_organizations(id),
  created_at timestamptz not null default now()
);
alter table public.office_cabinet_registrations enable row level security;
revoke all on public.office_cabinet_registrations from public, anon, authenticated;
grant select, insert on public.office_cabinet_registrations to service_role;

-- Invoker deliberately: callable only by the server role, with a server-verified identity.
create or replace function public.office_create_cabinet(
  p_auth_user_id uuid, p_email text, p_name text, p_display_name text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_org uuid;
  v_email text := lower(btrim(p_email));
begin
  if current_user <> 'service_role' then raise exception 'SERVER_ONLY'; end if;
  if p_auth_user_id is null or length(btrim(p_name)) not between 1 and 120
     or length(btrim(p_display_name)) not between 1 and 120
     or p_name is null or p_display_name is null or v_email is null
     or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_CABINET';
  end if;
  -- One provisioning transaction per identity, including retries/concurrent submissions.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_auth_user_id::text, 0));
  -- The API has verified the confirmed email with Auth /user. service_role
  -- cannot SELECT auth.users in the hosted project; no extra Auth grant needed.
  select org_id into v_org from public.office_cabinet_registrations where auth_user_id = p_auth_user_id;
  if v_org is not null then
    return jsonb_build_object('org_id', v_org, 'created', false);
  end if;
  -- Existing users never silently acquire a fresh owner space.
  if exists(select 1 from public.office_app_users where auth_user_id = p_auth_user_id)
     or exists(select 1 from public.office_memberships where user_id = p_auth_user_id) then
    raise exception 'ACCOUNT_ALREADY_HAS_CABINET';
  end if;
  v_org := gen_random_uuid();
  insert into public.office_organizations(id, slug, name, executive_name, executive_email)
    values(v_org, 'cabinet-' || v_org::text, btrim(p_name), btrim(p_display_name), v_email);
  insert into public.office_app_users(org_id, auth_user_id, email, display_name, role, active)
    values(v_org, p_auth_user_id, v_email, btrim(p_display_name), 'owner', true);
  insert into public.office_memberships(org_id, user_id, role, active)
    values(v_org, p_auth_user_id, 'owner', true);
  insert into public.office_cabinet_registrations(auth_user_id, org_id) values(p_auth_user_id, v_org);
  -- No copy from the pilot, no processing approvals, no Drive or agent credentials.
  return jsonb_build_object('org_id', v_org, 'created', true);
end;
$$;
revoke all on function public.office_create_cabinet(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.office_create_cabinet(uuid,text,text,text) to service_role;
commit;
