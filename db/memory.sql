-- Memory and recovery extension (2026-10-08). ADDITIVE ONLY: nothing is dropped, renamed or
-- rewritten. Run once in the Supabase SQL editor. The application works without it (the new
-- features report « migration manquante ») and uses it as soon as it exists.
--
-- Principle: Drive = detailed memory (agents' MEMORY folder, MISSION_MEMORY.json in each mission
-- folder); Supabase = state, index, relations and the useful cross-mission learnings only.
begin;

-- 1. Index of each mission's memory (no client detail): where its folder and memory file are,
--    and when its status last changed / it was closed / archived. status itself stays as it is
--    (free text); lib/mission-status.js maps old values (active, completed…) to the common list.
alter table public.office_missions add column if not exists client_name text check (client_name is null or length(client_name) <= 200);
alter table public.office_missions add column if not exists drive_folder_id text check (drive_folder_id is null or length(drive_folder_id) <= 200);
alter table public.office_missions add column if not exists memory_file_id text check (memory_file_id is null or length(memory_file_id) <= 200);
alter table public.office_missions add column if not exists status_changed_at timestamptz;
alter table public.office_missions add column if not exists closed_at timestamptz;
alter table public.office_missions add column if not exists archived_at timestamptz;
create index if not exists office_missions_client_idx on public.office_missions (org_id, client_name);

-- 2. Audit log, APPEND-ONLY (insert and select only: no update, no delete, for anyone).
--    References and hashes only — never the content of client documents, never the model's reasoning.
create table if not exists public.office_audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  at timestamptz not null default now(),
  agent text not null check (length(agent) between 1 and 60),
  mission_id uuid,
  action_type text not null check (length(action_type) between 1 and 80),
  source_ref text check (source_ref is null or length(source_ref) <= 500),
  input_hash text check (input_hash is null or input_hash ~ '^[0-9a-f]{64}$'),
  decision text check (decision is null or length(decision) <= 60),
  output_ref text check (output_ref is null or length(output_ref) <= 500),
  status text not null check (status in ('started', 'succeeded', 'failed', 'proposed', 'approved', 'rejected', 'executed', 'verified', 'retried', 'recovered', 'skipped')),
  error text check (error is null or length(error) <= 500),
  reviewer text check (reviewer is null or length(reviewer) <= 120),
  approved_by text check (approved_by is null or length(approved_by) <= 120),
  approved_at timestamptz,
  executed_at timestamptz,
  verified_at timestamptz,
  ref_id text check (ref_id is null or length(ref_id) <= 120)
);
create index if not exists office_audit_events_org_idx on public.office_audit_events (org_id, at desc);
create index if not exists office_audit_events_mission_idx on public.office_audit_events (org_id, mission_id, at desc);
alter table public.office_audit_events enable row level security;
revoke all on public.office_audit_events from public, anon, authenticated, service_role;
grant select, insert on public.office_audit_events to service_role;

-- 3. Cross-mission learnings, with their provenance. An isolated observation stays « observed »;
--    it becomes « confirmed » only when seen on 2+ missions or validated by a partner.
create table if not exists public.office_learnings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  category text not null check (category in ('risk', 'cycle_duration', 'overrun_cause', 'recurring_error', 'training_need', 'staffing', 'pbc_difficulty', 'management', 'other')),
  statement text not null check (length(statement) between 3 and 1000),
  key text not null check (length(key) between 3 and 200),
  source_mission_ids uuid[] not null default '{}',
  occurrences integer not null default 1 check (occurrences >= 1),
  status text not null default 'observed' check (status in ('observed', 'confirmed', 'rejected')),
  confirmed_by text check (confirmed_by is null or length(confirmed_by) <= 120),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (org_id, category, key)
);
create index if not exists office_learnings_org_idx on public.office_learnings (org_id, category, status);
alter table public.office_learnings enable row level security;
revoke all on public.office_learnings from public, anon, authenticated, service_role;
grant select, insert, update on public.office_learnings to service_role;

commit;
