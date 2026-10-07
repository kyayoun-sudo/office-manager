-- Orpailleur "Rangement": tidy-up requests, per-file plan, and learned preferences.
-- Additive only: three new tables. No existing table, function or policy is changed.
-- Nothing is ever deleted: files are only moved, each move keeps the previous folder
-- so it can be undone.
begin;

create table if not exists public.office_tidy_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  scope_path text check (scope_path is null or length(scope_path) <= 500),
  instructions text check (instructions is null or length(instructions) <= 3000),
  -- Scheduled passes only look at files new or modified since this moment.
  since timestamptz,
  requested_by text check (requested_by is null or length(requested_by) <= 120),
  status text not null default 'planning'
    check (status in ('planning', 'ready', 'executing', 'done', 'stopped', 'failed')),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  last_error text check (last_error is null or length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.office_tidy_requests add column if not exists since timestamptz;
create index if not exists office_tidy_requests_org_idx on public.office_tidy_requests (org_id, created_at desc);

create table if not exists public.office_tidy_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  request_id uuid not null references public.office_tidy_requests(id),
  file_id text not null,
  file_name text not null,
  current_parent_id text,
  current_path text,
  dest_folder_id text,
  dest_path text,
  new_folder_parent_id text,
  new_folder_name text check (new_folder_name is null or length(new_folder_name) <= 200),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  rationale text check (rationale is null or length(rationale) <= 1000),
  source text not null default 'none' check (source in ('preference', 'rule', 'ai', 'none')),
  mode text not null check (mode in ('auto', 'proposal', 'in_place', 'unsure', 'needs_reading')),
  status text not null default 'planned'
    check (status in ('planned', 'approved', 'rejected', 'moved', 'skipped', 'failed', 'undone')),
  decided_by text check (decided_by is null or length(decided_by) <= 120),
  decided_at timestamptz,
  moved_at timestamptz,
  previous_parent_id text,
  error text check (error is null or length(error) <= 500),
  -- Renaming (content-based): proposed new name, and the old one kept for undo.
  new_name text check (new_name is null or length(new_name) between 1 and 250),
  previous_name text,
  -- File features the decision teaches about (client, type…), for learning.
  learn_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (request_id, file_id)
);
-- Safe if an earlier version of this file was already applied.
alter table public.office_tidy_items add column if not exists new_name text;
alter table public.office_tidy_items add column if not exists previous_name text;
create index if not exists office_tidy_items_request_idx on public.office_tidy_items (org_id, request_id, status);

-- What the firm taught the Orpailleur: a file feature (client, type, extension)
-- that leads to a destination folder, with a weight raised or lowered by decisions.
create table if not exists public.office_tidy_preferences (
  org_id uuid not null,
  key text not null check (length(key) between 3 and 200),
  dest_folder_id text not null,
  dest_path text,
  weight integer not null default 0 check (weight between -50 and 50),
  updated_at timestamptz not null default now(),
  primary key (org_id, key, dest_folder_id)
);

alter table public.office_tidy_requests enable row level security;
alter table public.office_tidy_items enable row level security;
alter table public.office_tidy_preferences enable row level security;
revoke all on public.office_tidy_requests, public.office_tidy_items, public.office_tidy_preferences
  from public, anon, authenticated, service_role;
grant select, insert, update on public.office_tidy_requests, public.office_tidy_items, public.office_tidy_preferences
  to service_role;
commit;
