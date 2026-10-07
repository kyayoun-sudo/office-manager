-- Training of the agents on audit missions (5 days, automatic, graded).
-- Additive only: three new tables. No existing table, function or policy is changed.
-- The fake missions are NEVER written to the firm's mission tables (office_missions,
-- office_action_queue…): the team indicators and the coordination stay clean.
begin;

create table if not exists public.office_training_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  status text not null default 'active' check (status in ('active', 'done', 'stopped', 'cleaned')),
  start_date date not null,
  days smallint not null default 5 check (days between 1 and 10),
  run_time text not null default '07:00' check (run_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'Africa/Abidjan' check (length(timezone) between 3 and 64),
  provider text not null default 'auto' check (provider in ('auto', 'openai', 'anthropic')),
  mode text not null default 'drive' check (mode in ('drive', 'local')),
  drive_root_id text check (drive_root_id is null or length(drive_root_id) <= 200),
  drive_root_url text check (drive_root_url is null or length(drive_root_url) <= 500),
  created_by text check (created_by is null or length(created_by) <= 120),
  last_error text check (last_error is null or length(last_error) <= 1000),
  cleanup jsonb check (cleanup is null or jsonb_typeof(cleanup) = 'object'),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
-- One running campaign per firm.
create unique index if not exists office_training_one_active on public.office_training_campaigns (org_id) where status = 'active';

create table if not exists public.office_training_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  campaign_id uuid not null references public.office_training_campaigns(id),
  day smallint not null check (day between 1 and 10),
  -- F0..F3 for fake missions, R:<folder id> for real missions found in the training folder.
  ref text not null check (length(ref) between 2 and 220),
  kind text not null check (kind in ('fake', 'real')),
  agent_key text not null check (agent_key in ('grand-controleur', 'mission-controller', 'orpailleur', 'sika')),
  title text not null check (length(title) <= 300),
  drive_folder_id text check (drive_folder_id is null or length(drive_folder_id) <= 200),
  scenario jsonb not null default '{}'::jsonb check (jsonb_typeof(scenario) = 'object'),
  status text not null default 'pending' check (status in
    ('to_create', 'creating', 'pending', 'answering', 'answered', 'grading', 'graded', 'to_confirm', 'confirmed', 'failed')),
  answer text check (answer is null or length(answer) <= 20000),
  provider text check (provider is null or length(provider) <= 200),
  examiner text check (examiner is null or length(examiner) <= 300),
  grade jsonb check (grade is null or jsonb_typeof(grade) = 'object'),
  score numeric(5,1) check (score is null or score between 0 and 100),
  lesson text check (lesson is null or length(lesson) <= 500),
  feedback jsonb check (feedback is null or jsonb_typeof(feedback) = 'object'),
  attempts smallint not null default 0,
  error text check (error is null or length(error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, day, ref)
);
create index if not exists office_training_cases_status_idx on public.office_training_cases (org_id, campaign_id, status, day);

-- Registry of everything the app created on the Drive for the training.
-- Only folders listed here (kind = 'mission_folder') can ever be moved to the trash.
create table if not exists public.office_training_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  campaign_id uuid not null references public.office_training_campaigns(id),
  case_id uuid references public.office_training_cases(id),
  drive_file_id text not null unique check (length(drive_file_id) between 5 and 200),
  kind text not null check (kind in ('root', 'mission_folder', 'subfolder', 'file')),
  name text check (name is null or length(name) <= 300),
  parent_id text check (parent_id is null or length(parent_id) <= 200),
  created_at timestamptz not null default now(),
  trashed_at timestamptz
);
create index if not exists office_training_items_case_idx on public.office_training_items (org_id, case_id);

alter table public.office_training_campaigns enable row level security;
alter table public.office_training_cases enable row level security;
alter table public.office_training_items enable row level security;
revoke all on public.office_training_campaigns, public.office_training_cases, public.office_training_items from public, anon, authenticated, service_role;
grant select, insert, update on public.office_training_campaigns, public.office_training_cases, public.office_training_items to service_role;
commit;
