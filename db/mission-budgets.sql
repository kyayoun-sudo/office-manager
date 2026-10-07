begin;
create table if not exists public.office_mission_budget_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  office_mission_id uuid not null,
  data jsonb not null check(jsonb_typeof(data)='object'),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique(org_id,office_mission_id,content_hash), unique(org_id,id), unique(org_id,id,content_hash)
);
create table if not exists public.office_mission_budget_decisions (
  sequence bigint generated always as identity primary key,
  org_id uuid not null,
  budget_id uuid not null,
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  decision text not null check(decision in ('approve','reject')),
  created_at timestamptz not null default now(),
  foreign key(org_id,budget_id,content_hash) references public.office_mission_budget_versions(org_id,id,content_hash)
);
create index if not exists office_budget_mission_idx on public.office_mission_budget_versions(org_id,office_mission_id,created_at desc);
create index if not exists office_budget_decision_idx on public.office_mission_budget_decisions(org_id,budget_id,sequence desc);
alter table public.office_mission_budget_versions enable row level security;
alter table public.office_mission_budget_decisions enable row level security;
revoke all on public.office_mission_budget_versions, public.office_mission_budget_decisions from public,anon,authenticated,service_role;
grant select,insert on public.office_mission_budget_versions, public.office_mission_budget_decisions to service_role;
grant usage,select on sequence public.office_mission_budget_decisions_sequence_seq to service_role;
create table if not exists public.office_mission_budget_exports (
  org_id uuid not null, budget_id uuid not null, content_hash text not null,
  claimed_at timestamptz not null default now(), primary key(org_id,budget_id),
  foreign key(org_id,budget_id,content_hash) references public.office_mission_budget_versions(org_id,id,content_hash)
);
alter table public.office_mission_budget_exports enable row level security;
revoke all on public.office_mission_budget_exports from public,anon,authenticated,service_role;
grant select,insert on public.office_mission_budget_exports to service_role;
commit;
