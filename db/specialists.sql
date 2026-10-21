-- Additive v1: server-only registry. No external endpoints or credentials in this release.
create table if not exists public.specialists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id),
  specialist_key text not null check (specialist_key ~ '^[a-z][a-z0-9-]{1,79}$'),
  name text not null check (length(name) between 1 and 160),
  adapter_type text not null check (adapter_type in ('mock','mcp','rest','huggingface','internal')),
  capabilities text[] not null default '{}',
  enabled boolean not null default false,
  requires_human_approval boolean not null default true,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (org_id, specialist_key), unique (org_id, id)
);
create table if not exists public.specialist_permissions (
  org_id uuid not null,
  specialist_id uuid not null,
  agent_key text not null check (agent_key in ('firm-manager','mission-controller','enhanced-auditor','orpailleur','sika','shadow')),
  allowed boolean not null default false,
  primary key (org_id,specialist_id,agent_key),
  foreign key (org_id,specialist_id) references public.specialists(org_id,id)
);
create table if not exists public.specialist_calls (
  id uuid primary key,
  org_id uuid not null references public.office_organizations(id),
  specialist_id uuid,
  agent_key text not null,
  mission_id uuid,
  capability text not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  registry_revision integer,
  status text not null check (status in ('pending_approval','approved','rejected','running','succeeded','failed','denied')),
  requested_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  confidence numeric check (confidence between 0 and 1),
  error_code text,
  result_hash text,
  foreign key (org_id,specialist_id) references public.specialists(org_id,id)
);
create index if not exists specialist_calls_org_created on public.specialist_calls(org_id,created_at desc);
alter table public.specialists enable row level security;
alter table public.specialist_permissions enable row level security;
alter table public.specialist_calls enable row level security;
revoke all on public.specialists, public.specialist_permissions, public.specialist_calls from public, anon, authenticated;
grant select,insert,update on public.specialists, public.specialist_permissions, public.specialist_calls to service_role;
revoke delete,truncate on public.specialists, public.specialist_permissions, public.specialist_calls from service_role;
-- No browser policies. Existing app sessions + server role checks authorize every operation.
