-- Security: journal of access to sensitive screens (team indicators, coordination),
-- and the "manager" role for application accounts.
-- Additive only. office_access_log is append-only: no update, no delete.
begin;
create table if not exists public.office_access_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  auth_user_id uuid not null,
  email text,
  role text,
  action text not null check (length(action) between 1 and 60),
  target text check (target is null or length(target) <= 200),
  at timestamptz not null default now()
);
create index if not exists office_access_log_org_idx on public.office_access_log (org_id, at desc);
alter table public.office_access_log enable row level security;
revoke all on public.office_access_log from public, anon, authenticated, service_role;
grant select, insert on public.office_access_log to service_role;

-- "manager": sees team indicators and coordination, but not the firm settings.
do $$
begin
  if to_regclass('public.office_app_users') is not null then
    alter table public.office_app_users drop constraint if exists office_app_users_role_check;
    alter table public.office_app_users add constraint office_app_users_role_check
      check (role in ('owner', 'partner', 'manager', 'collaborator'));
  end if;
end $$;
commit;
