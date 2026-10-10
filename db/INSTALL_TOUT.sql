-- OFFICE MANAGER — INSTALLATION DE TOUTES LES TABLES DE L’APPLICATION
-- Fichier généré par scripts/build-install-sql.mjs : ne pas modifier à la main.
-- À coller UNE fois dans Supabase → SQL Editor → Run. Sans danger si on le relance.
-- Ensuite seulement : db/scheduler-cron.sql (après y avoir mis l’adresse et le secret).

-- ===== org-branding.sql =====
-- White-label branding per organisation (firm name, primary colour, logo).
-- Additive only: creates one new table. No existing table, function or policy is changed.
-- Backend (service_role) reads and writes; anon/authenticated have no access.
begin;
create table if not exists public.office_org_branding (
  org_id uuid primary key,
  firm_name text not null check (length(btrim(firm_name)) between 1 and 120),
  primary_color text not null default '#0E5A52' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text check (secondary_color is null or secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- Small raster logo kept inline (PNG/JPEG/WebP only; SVG refused to avoid script injection).
  logo_data_url text check (
    logo_data_url is null or (
      logo_data_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
      and length(logo_data_url) <= 400000
    )
  ),
  updated_by text check (updated_by is null or length(updated_by) <= 120),
  updated_at timestamptz not null default now()
);
alter table public.office_org_branding enable row level security;
revoke all on public.office_org_branding from public, anon, authenticated, service_role;
grant select, insert, update on public.office_org_branding to service_role;
commit;

-- ===== action-decisions.sql =====
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

-- ===== agent-persona.sql =====
-- Agent mail identity and internal tone, set only by the owner / managing partners.
-- Additive only: one new table. No existing table, function or policy is changed.
begin;
create table if not exists public.office_agent_persona (
  org_id uuid primary key,
  agent_display_name text not null default 'Office Manager'
    check (length(btrim(agent_display_name)) between 1 and 80),
  sender_email text check (sender_email is null or (length(sender_email) <= 254 and sender_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  reply_to text check (reply_to is null or (length(reply_to) <= 254 and reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 10),
  internal_domains text[] not null default '{}' check (cardinality(internal_domains) between 0 and 10),
  -- Tone with colleagues only. Clients always receive a formal tone (enforced in code).
  internal_tone text not null default 'nouchi_fun' check (internal_tone in ('nouchi_fun', 'relaxed_fun', 'professional')),
  humor_level smallint not null default 2 check (humor_level between 0 and 3),
  internal_frequency text not null default 'few_per_week' check (internal_frequency in ('off', 'weekly', 'few_per_week', 'daily')),
  signature text check (signature is null or length(signature) <= 500),
  updated_by text check (updated_by is null or length(updated_by) <= 120),
  updated_at timestamptz not null default now()
);
alter table public.office_agent_persona enable row level security;
revoke all on public.office_agent_persona from public, anon, authenticated, service_role;
grant select, insert, update on public.office_agent_persona to service_role;
commit;

-- ===== app-users.sql =====
-- Application accounts: who may log in to the firm's Office Manager, and with which role.
-- Passwords are NOT stored here: they are handled by Supabase Auth (auth.users).
-- Additive only: one new table. No existing table, function or policy is changed.
begin;
create table if not exists public.office_app_users (
  org_id uuid not null,
  auth_user_id uuid not null,
  email text not null check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  -- owner / partner (associé-gérant): firm settings; manager: team indicators and
  -- coordination; collaborator: daily use and own indicators.
  role text not null default 'collaborator' constraint office_app_users_role_check
    check (role in ('owner', 'partner', 'manager', 'collaborator')),
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

-- ===== tidy.sql =====
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

-- ===== agent-schedule.sql =====
-- Agent schedule (set by the firm owner) and journal of every pass.
-- Additive only: two new tables. No existing table, function or policy is changed.
--   Grand Contrôleur : times chosen by the owner at configuration
--   Sika             : once a week (day + time chosen by the owner)
--   Orpailleur       : 3 passes a day, 08:00, 12:00 and 20:00 (fixed)
begin;
create table if not exists public.office_agent_schedule (
  org_id uuid primary key,
  enabled boolean not null default false,
  timezone text not null default 'Africa/Abidjan' check (length(timezone) between 3 and 64),
  controller_times text[] not null default '{09:00,16:00}'
    check (cardinality(controller_times) between 1 and 6),
  sika_weekday smallint not null default 5 check (sika_weekday between 1 and 7), -- 1 = lundi … 7 = dimanche
  sika_time text not null default '09:00' check (sika_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  orpailleur_times text[] not null default '{08:00,12:00,20:00}',
  updated_by text check (updated_by is null or length(updated_by) <= 120),
  updated_at timestamptz not null default now()
);

create table if not exists public.office_agent_passes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  agent_key text not null check (agent_key in ('grand-controleur', 'orpailleur', 'sika')),
  -- Local slot, e.g. "2026-10-07 08:00" (or "manuel 2026-10-07 10:42:13"): one pass per slot.
  slot text not null check (length(slot) between 10 and 40),
  status text not null default 'started' check (status in ('started', 'done', 'failed')),
  summary text check (summary is null or length(summary) <= 2000),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (org_id, agent_key, slot)
);
create index if not exists office_agent_passes_org_idx on public.office_agent_passes (org_id, agent_key, started_at desc);

alter table public.office_agent_schedule enable row level security;
alter table public.office_agent_passes enable row level security;
revoke all on public.office_agent_schedule, public.office_agent_passes from public, anon, authenticated, service_role;
grant select, insert, update on public.office_agent_schedule, public.office_agent_passes to service_role;
commit;

-- ===== access-log.sql =====
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
do $$
begin
  if to_regclass('public.office_app_users') is not null then
    alter table public.office_app_users drop constraint if exists office_app_users_role_check;
    alter table public.office_app_users add constraint office_app_users_role_check
      check (role in ('owner', 'partner', 'manager', 'collaborator'));
  end if;
end $$;
commit;

-- ===== training.sql =====
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

-- ===== agent-messages.sql =====
-- Messages of the agent to COLLEAGUES (never to clients), validated before sending.
-- Additive only: one new table. Journal: no DELETE.
begin;
create table if not exists public.office_agent_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  recipients text[] not null check (cardinality(recipients) between 1 and 30),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 10000),
  tone text check (tone is null or length(tone) <= 40),
  source text not null default 'person' check (source in ('person', 'agent')),
  topic text check (topic is null or length(topic) <= 2000),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'sending', 'sent', 'failed', 'rejected')),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  requested_by text check (requested_by is null or length(requested_by) <= 120),
  decided_by text check (decided_by is null or length(decided_by) <= 120),
  decided_at timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 1000),
  sent_at timestamptz,
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  error text check (error is null or length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A message can only be marked sent once a person has decided it.
  check (status not in ('sending', 'sent') or (decided_by is not null and decided_at is not null))
);
create index if not exists office_agent_messages_org_idx on public.office_agent_messages (org_id, status, created_at desc);
alter table public.office_agent_messages enable row level security;
revoke all on public.office_agent_messages from public, anon, authenticated, service_role;
grant select, insert, update on public.office_agent_messages to service_role;
commit;

-- ===== agent-messages-client.sql =====
-- Client e-mails drafted by the agent (rule of 2026-10-07, Paul): the agent PROPOSES a draft,
-- a manager / partner / owner reviews (can edit) and validates it in "À valider"; only then is
-- it sent, and only to the client contact registered on the mission. Additive only.
begin;
alter table public.office_agent_messages add column if not exists audience text not null default 'colleagues';
alter table public.office_agent_messages add column if not exists office_mission_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'office_agent_messages_audience_check') then
    alter table public.office_agent_messages add constraint office_agent_messages_audience_check
      check (audience in ('colleagues', 'client'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'office_agent_messages_client_mission_check') then
    alter table public.office_agent_messages add constraint office_agent_messages_client_mission_check
      check (audience <> 'client' or office_mission_id is not null);
  end if;
end $$;
-- The client contact(s) of a mission: the only addresses a client e-mail can go to.
do $$ begin
  if to_regclass('public.office_missions') is not null then
    alter table public.office_missions add column if not exists client_contact_emails text[];
  end if;
end $$;
commit;

-- ===== test-run.sql =====
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

-- ===== google-connection.sql =====
-- "Connecter Google" (2026-10-07): the firm's Google account connected by the owner from
-- Paramètres. The refresh token is stored ENCRYPTED (AES-256-GCM, key held by the server only).
-- One row per firm; disconnecting revokes the token at Google and blanks it here. Additive only.
begin;
create table if not exists public.office_google_connections (
  org_id uuid primary key,
  google_email text not null check (length(google_email) between 3 and 254),
  refresh_token_enc text not null check (length(refresh_token_enc) between 5 and 4000),
  scopes text[] not null default '{}',
  connected_by text check (connected_by is null or length(connected_by) <= 120),
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500)
);
alter table public.office_google_connections enable row level security;
revoke all on public.office_google_connections from public, anon, authenticated;
commit;

-- "Drive du cabinet": the shared drive chosen by the owner in Paramètres (pasted link).
begin;
create table if not exists public.office_firm_drive (
  org_id uuid primary key,
  drive_id text not null check (length(drive_id) between 10 and 100),
  drive_name text check (drive_name is null or length(drive_name) <= 200),
  set_by text check (set_by is null or length(set_by) <= 120),
  set_at timestamptz not null default now()
);
alter table public.office_firm_drive enable row level security;
revoke all on public.office_firm_drive from public, anon, authenticated;
commit;

-- ===== personal-ai.sql =====
-- « Mon IA » (2026-10-10): each person may connect their own AI key (Claude, ChatGPT, Gemini), kept
-- ENCRYPTED (AES-GCM, sealed by the server; never readable by the browser), after accepting a
-- versioned warning (who, when, which version). Plus the firm's settings (personal AI allowed or not).
-- Additive only.
begin;
create table if not exists public.office_user_ai_keys (
  org_id uuid not null,
  auth_user_id uuid not null,
  email text,
  provider text not null check (provider in ('anthropic', 'openai', 'gemini')),
  key_enc text,
  key_hint text check (key_hint is null or length(key_hint) <= 10),
  model text check (model is null or length(model) <= 80),
  active boolean not null default true,
  notice_version text not null,
  notice_accepted_at timestamptz not null,
  notice_accepted_by text,
  last_used_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, auth_user_id, provider)
);
alter table public.office_user_ai_keys enable row level security;
revoke all on public.office_user_ai_keys from public, anon, authenticated, service_role;
grant select, insert, update on public.office_user_ai_keys to service_role;

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
