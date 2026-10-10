-- Roles and positions in the firm (2026-10-10, branch « amelioration »). Additive: the existing roles
-- stay valid (owner, partner, manager, collaborator); new roles, a position (grade / title), who each
-- person reports to, and the firm's settings for people (who sees whose performance).
begin;
alter table public.office_app_users drop constraint if exists office_app_users_role_check;
alter table public.office_app_users add constraint office_app_users_role_check
  check (role in ('owner', 'partner', 'quality_reviewer', 'manager', 'supervisor', 'senior', 'auditor', 'secretary', 'it_admin', 'collaborator'));
alter table public.office_app_users add column if not exists position text check (position is null or length(position) <= 120);
alter table public.office_app_users add column if not exists reports_to uuid;
create index if not exists office_app_users_reports_to on public.office_app_users (org_id, reports_to);

create table if not exists public.office_firm_settings (
  org_id uuid primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.office_firm_settings enable row level security;
revoke all on public.office_firm_settings from public, anon, authenticated, service_role;
grant select, insert, update on public.office_firm_settings to service_role;
commit;
