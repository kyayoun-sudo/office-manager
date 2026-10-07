-- Application accounts: who may log in to the firm's Office Manager, and with which role.
-- Passwords are NOT stored here: they are handled by Supabase Auth (auth.users).
-- Additive only: one new table. No existing table, function or policy is changed.
begin;
create table if not exists public.office_app_users (
  org_id uuid not null,
  auth_user_id uuid not null,
  email text not null check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  -- owner / partner (associé-gérant): firm settings; collaborator: daily use.
  role text not null default 'collaborator' check (role in ('owner', 'partner', 'collaborator')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, auth_user_id),
  unique (org_id, email)
);
alter table public.office_app_users enable row level security;
revoke all on public.office_app_users from public, anon, authenticated, service_role;
-- Accounts are deactivated, never deleted (traceability).
grant select, insert, update on public.office_app_users to service_role;
commit;
