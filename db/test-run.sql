-- Test run "TATY TEST" (2026-10-07): state of the test of the whole application in preview
-- (identical copy of the Drive, 5 missions over 3 months accelerated). One row per test firm.
begin;
create table if not exists public.office_test_runs (
  org_id uuid primary key,
  status text not null default 'new' check (status in ('new', 'copying', 'copied', 'seeded', 'running', 'stopped')),
  copy_state jsonb not null default '{}'::jsonb check (jsonb_typeof(copy_state) = 'object'),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  seed_result jsonb not null default '{}'::jsonb check (jsonb_typeof(seed_result) = 'object'),
  last_error text check (last_error is null or length(last_error) <= 1000),
  updated_by text check (updated_by is null or length(updated_by) <= 120),
  updated_at timestamptz not null default now()
);
alter table public.office_test_runs enable row level security;
commit;
