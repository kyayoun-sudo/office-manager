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
-- The full list of roles lives in db/roles.sql (single source). This block only adds the constraint when it is missing,
-- with that full list: it never narrows it back to the first four roles (2026-10-11: re-running INSTALL_TOUT on a base
-- with « bdm », « auditor »… accounts failed with 23514).
do $$
begin
  if to_regclass('public.office_app_users') is not null
     and not exists (select 1 from pg_constraint where conname = 'office_app_users_role_check' and conrelid = 'public.office_app_users'::regclass) then
    alter table public.office_app_users add constraint office_app_users_role_check
      check (role in ('owner', 'partner', 'quality_reviewer', 'bdm', 'manager', 'supervisor', 'senior', 'auditor', 'secretary', 'it_admin', 'collaborator'));
  end if;
end $$;
commit;
