-- Manager decision journal for proposed actions (screen "À valider").
-- Additive only: one new append-only table. office_action_queue is NOT modified:
-- a decision recorded here does not execute, approve or change any queued action.
-- Each decision stores a hash of the exact action content it was taken on.
begin;
create table if not exists public.office_action_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  action_id uuid not null,
  decision text not null check (decision in ('approve', 'reject', 'defer')),
  note text check (note is null or length(note) <= 1000),
  decided_by text check (decided_by is null or length(decided_by) <= 120),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  action_snapshot jsonb not null check (jsonb_typeof(action_snapshot) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists office_action_decisions_org_action_idx
  on public.office_action_decisions (org_id, action_id, created_at desc);
alter table public.office_action_decisions enable row level security;
revoke all on public.office_action_decisions from public, anon, authenticated, service_role;
-- Append-only for the backend: read and insert, never update or delete.
grant select, insert on public.office_action_decisions to service_role;
commit;
