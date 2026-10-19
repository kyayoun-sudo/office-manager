-- OFFICE MANAGER — INSTALLATION DE TOUTES LES TABLES DE L’APPLICATION
-- Fichier généré par scripts/build-install-sql.mjs : ne pas modifier à la main.
-- À coller UNE fois dans Supabase → SQL Editor → Run. Sans danger si on le relance.
-- Ensuite seulement : db/scheduler-cron.sql (après y avoir mis l’adresse et le secret).

-- ===== base.sql =====
-- OFFICE MANAGER — SOCLE DE LA BASE (tables de base d'un cabinet)
-- (2026-10-11, Paul : « on va faire un essai pour 4 cabinets ») — jusqu'ici ces tables n'existaient que dans la
-- base du premier cabinet pilote : un cabinet avec un Supabase neuf ne pouvait pas démarrer. Elles sont reconstruites
-- ici à partir de ce que le code lit et écrit (colonnes vérifiées par tests/schema-coverage.test.js).
-- Sans danger sur une base existante : uniquement « create … if not exists » et « add column if not exists » ;
-- rien n'est supprimé, aucune donnée n'est écrite.
-- Isolement : RLS activé partout (sans politique = aucune ligne pour une session) ; seul le serveur (service_role) lit et écrit, sauf l'autorisation des agents,
-- écrite avec la session du propriétaire (politiques plus bas).

create schema if not exists private;

-- ---- Le cabinet ----
create table if not exists public.office_organizations (
  id uuid primary key default gen_random_uuid(),
  slug text,
  name text not null default 'Cabinet',
  timezone text not null default 'UTC',
  account_kind text,
  created_at timestamptz not null default now()
);

create table if not exists public.office_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- Rôle de la personne connectée dans un cabinet (lu par les politiques ; contourne le RLS des adhésions).
-- Créée seulement si absente : une base existante garde la sienne.
do $fn$
begin
  if to_regprocedure('private.office_role(uuid)') is null then
    execute $body$
      create function private.office_role(p_org uuid)
      returns text language sql stable security definer set search_path = '' as $q$
        select m.role from public.office_memberships m
        where m.org_id = p_org and m.user_id = auth.uid() and m.active limit 1
      $q$
    $body$;
    revoke all on function private.office_role(uuid) from public;
    grant execute on function private.office_role(uuid) to authenticated, service_role;
  end if;
end $fn$;
grant usage on schema private to authenticated, service_role;

-- « Autoriser les agents » : écrit avec la session du propriétaire ou d'un associé (l'approbateur est une personne).
create table if not exists public.office_processing_permissions (
  org_id uuid primary key references public.office_organizations(id) on delete cascade,
  inventory_metadata_approved boolean not null default false,
  selected_content_approved boolean not null default false,
  external_ai_approved boolean not null default false,
  outbound_messaging_approved boolean not null default false,
  approval_scope text,
  approved_by uuid,
  approved_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function private.office_permissions_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The approver is the person whose session wrote the row, never a value sent by the client.
  if auth.uid() is not null then new.approved_by := auth.uid(); end if;
  if new.inventory_metadata_approved or new.selected_content_approved or new.external_ai_approved then
    new.approved_at := pg_catalog.now(); new.revoked_at := null;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end $$;
do $tr$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.office_processing_permissions'::regclass and not tgisinternal) then
    create trigger trg_office_permissions_stamp before insert or update on public.office_processing_permissions
      for each row execute function private.office_permissions_stamp();
  end if;
end $tr$;

-- ---- Les agents ----
create table if not exists public.office_agent_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  agent_key text not null,
  mode text not null default 'approval_required',
  instruction_version text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, agent_key)
);

create table if not exists public.office_agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  agent_key text not null,
  status text not null default 'running',
  summary text,
  metrics jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists office_agent_runs_org_agent on public.office_agent_runs (org_id, agent_key, started_at desc);

create table if not exists public.office_agent_tool_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  run_id uuid,
  parent_agent_key text,
  specialist_key text,
  tool_name text,
  phase text,
  input_summary text,
  output_summary text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists office_agent_tool_events_run on public.office_agent_tool_events (org_id, run_id);

-- ---- Missions et personnes ----
create table if not exists public.office_missions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  mission_code text,
  name text not null default 'Mission',
  status text not null default 'opportunity',
  planned_start date,
  planned_end date,
  client_name text,
  client_contact_emails text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create index if not exists office_missions_org_status on public.office_missions (org_id, status);

create table if not exists public.office_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  full_name text not null,
  email text,
  title text,
  role_title text,
  grade_title text,
  department text,
  skills text[] not null default '{}',
  weekly_capacity_hours numeric not null default 40,
  profile_status text,
  active boolean not null default true,
  cv_url text,
  cv_drive_file_id text,
  source_directory_url text,
  source_directory_modified_at timestamptz,
  last_directory_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);

create table if not exists public.office_mission_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  office_mission_id uuid references public.office_missions(id) on delete cascade,
  staff_profile_id uuid references public.office_staff_profiles(id) on delete cascade,
  mission_role text,
  cycle_codes text[] not null default '{}',
  planned_start date,
  planned_end date,
  allocation_pct numeric not null default 0,
  status text not null default 'proposed',
  responsibility_scope text,
  reviewer_profile_id uuid,
  source_plan_file_id text,
  source_plan_url text,
  source_plan_modified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_mission_assignments_mission on public.office_mission_assignments (org_id, office_mission_id);
create index if not exists office_mission_assignments_staff on public.office_mission_assignments (org_id, staff_profile_id);

-- Disponibilités et charges hors missions (lues par le conseil d'équipe ; vides au départ).
create table if not exists public.office_workforce_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  staff_profile_id uuid not null,
  office_mission_id uuid,
  start_date date,
  end_date date,
  planned_load_pct numeric not null default 0,
  status text,
  created_at timestamptz not null default now()
);
create table if not exists public.office_staff_availability (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  staff_profile_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Conflits d'affectation : même personne, périodes qui se chevauchent, plus de 100 % ensemble.
do $v$
begin
  if to_regclass('public.office_staffing_conflicts') is null then
    execute $sql$
create view public.office_staffing_conflicts with (security_invoker = true) as
select a.org_id, a.staff_profile_id, s.full_name,
       a.office_mission_id as mission_a_id, b.office_mission_id as other_mission_id,
       greatest(a.planned_start, b.planned_start) as overlap_start,
       least(a.planned_end, b.planned_end) as overlap_end,
       (a.allocation_pct + b.allocation_pct) as total_allocation_pct
from public.office_mission_assignments a
join public.office_mission_assignments b
  on b.org_id = a.org_id and b.staff_profile_id = a.staff_profile_id and b.id > a.id
 and b.office_mission_id is distinct from a.office_mission_id
join public.office_staff_profiles s on s.id = a.staff_profile_id
where a.planned_start is not null and a.planned_end is not null and b.planned_start is not null and b.planned_end is not null
  and greatest(a.planned_start, b.planned_start) <= least(a.planned_end, b.planned_end)
  and a.allocation_pct + b.allocation_pct > 100
  and lower(coalesce(a.status, '')) not in ('rejected', 'cancelled', 'canceled', 'completed')
  and lower(coalesce(b.status, '')) not in ('rejected', 'cancelled', 'canceled', 'completed')
    $sql$;
  end if;
end $v$;

create table if not exists public.office_mission_controls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  office_mission_id uuid references public.office_missions(id) on delete cascade,
  control_code text,
  control_area text,
  title text,
  standard_reference text,
  work_program_reference text,
  expected_evidence text,
  accountable_staff_profile_id uuid,
  status text not null default 'open',
  rationale text,
  evidence jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.office_archives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  office_mission_id uuid,
  archive_code text,
  title text,
  archive_provider text,
  source_folder_id text,
  archive_location text,
  status text not null default 'planned',
  retention_until date,
  archived_at timestamptz,
  restored_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---- « À valider » : l'IA propose, une personne décide ----
create table if not exists public.office_action_queue (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  agent_key text,
  office_mission_id uuid,
  assigned_staff_profile_id uuid,
  action_type text not null,
  idempotency_key text,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  -- « cancelled » est un work_state, jamais un statut (voir CLAUDE.md).
  status text not null default 'proposed',
  work_state text not null default 'requested',
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  executed_at timestamptz,
  verified_at timestamptz,
  verification_evidence jsonb,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);
create index if not exists office_action_queue_org_state on public.office_action_queue (org_id, work_state, created_at desc);
create index if not exists office_action_queue_mission on public.office_action_queue (org_id, office_mission_id);

-- Connexion Google faite avant « Connecter Google » (ancienne voie ; lue seulement).
create table if not exists public.office_integration_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  provider text not null,
  account_email text,
  granted_scopes text[] not null default '{}',
  status text,
  created_at timestamptz not null default now(),
  unique (org_id, provider)
);

-- ---- Inventaire du Drive (lu par la recherche et le rangement ; un Drive = un inventaire) ----
create table if not exists public.orpailleur_scan_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  drive_id text,
  status text not null default 'RUNNING',
  run_origin text,
  office_run_id uuid,
  page_count integer not null default 0,
  file_count integer not null default 0,
  folder_count integer not null default 0,
  last_error text,
  heartbeat_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.orpailleur_inventory (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  drive_id text not null default '',
  file_id text not null,
  parent_id text,
  folder_path text,
  name text,
  mime_type text,
  is_folder boolean not null default false,
  modified_at timestamptz,
  drive_version text,
  size_bytes bigint,
  web_url text,
  last_seen_at timestamptz,
  last_scan_id uuid,
  classification text,
  decision_status text,
  client_name text,
  office_mission_id uuid,
  document_type text,
  document_period text,
  document_version text,
  content_verified_at timestamptz,
  source_channel text,
  source_message_id text,
  archive_id uuid,
  archived_at timestamptz,
  unique (org_id, drive_id, file_id)
);
create index if not exists orpailleur_inventory_org_modified on public.orpailleur_inventory (org_id, drive_id, modified_at desc);

create table if not exists public.orpailleur_inspection_queue (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  drive_id text not null default '',
  file_id text not null,
  version_fingerprint text not null default '',
  status text not null default 'PENDING',
  content_excerpt text,
  decision_reason text,
  attempts integer not null default 0,
  lease_until timestamptz,
  updated_at timestamptz not null default now(),
  unique (org_id, drive_id, file_id, version_fingerprint)
);

-- Règles des agents (référentiel, sans donnée de cabinet).
create table if not exists private.agent_rules (
  rule_code text primary key,
  name text not null,
  description text,
  default_severity text,
  active boolean not null default true
);

-- ---- Isolement : seul le serveur, sauf l'autorisation des agents par le propriétaire ----
do $rls$
declare t text;
begin
  foreach t in array array['office_organizations','office_memberships','office_processing_permissions','office_agent_settings',
    'office_agent_runs','office_agent_tool_events','office_missions','office_staff_profiles','office_mission_assignments',
    'office_workforce_allocations','office_staff_availability','office_mission_controls','office_archives','office_action_queue',
    'office_integration_connections','orpailleur_scan_runs','orpailleur_inventory','orpailleur_inspection_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $rls$;
revoke all on public.office_staffing_conflicts from anon;
grant select on public.office_staffing_conflicts to service_role;

do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'office_processing_permissions') then
    grant select, insert, update on public.office_processing_permissions to authenticated;
    create policy office_permissions_lead_select on public.office_processing_permissions for select to authenticated
      using (private.office_role(org_id) in ('owner', 'partner'));
    create policy office_permissions_lead_insert on public.office_processing_permissions for insert to authenticated
      with check (private.office_role(org_id) in ('owner', 'partner'));
    create policy office_permissions_lead_update on public.office_processing_permissions for update to authenticated
      using (private.office_role(org_id) in ('owner', 'partner')) with check (private.office_role(org_id) in ('owner', 'partner'));
  else
    grant select, insert, update on public.office_processing_permissions to authenticated;
  end if;
end $pol$;

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
-- The full list of roles lives in db/roles.sql (single source). This block only adds the constraint when it is missing,
-- with that full list: it never narrows it back to the first four roles (2026-10-11: re-running INSTALL_TOUT on a base
-- with « bdm », « auditor »… accounts failed with 23514).
do $$
begin
  if to_regclass('public.office_app_users') is not null
     and not exists (select 1 from pg_constraint where conname = 'office_app_users_role_check' and conrelid = 'public.office_app_users'::regclass) then
    alter table public.office_app_users add constraint office_app_users_role_check
      check (role in ('owner', 'partner', 'quality_reviewer', 'bdm', 'manager', 'supervisor', 'senior', 'auditor', 'secretary', 'it_admin', 'collaborator'));
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

-- ===== roles.sql =====
-- Roles and positions in the firm (2026-10-10, branch « amelioration »). Additive: the existing roles
-- stay valid (owner, partner, manager, collaborator); new roles, a position (grade / title), who each
-- person reports to, and the firm's settings for people (who sees whose performance).
-- 2026-10-11: role 'bdm' (Business Development Manager) added; re-running this file is safe.
begin;
alter table public.office_app_users drop constraint if exists office_app_users_role_check;
alter table public.office_app_users add constraint office_app_users_role_check
  check (role in ('owner', 'partner', 'quality_reviewer', 'bdm', 'manager', 'supervisor', 'senior', 'auditor', 'secretary', 'it_admin', 'collaborator'));
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

-- ===== memory.sql =====
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
-- The client's folder (its permanent file holds 00_OFFICE_MANAGER/CLIENT_MEMORY.json, shared by all its missions).
alter table public.office_missions add column if not exists client_folder_id text check (client_folder_id is null or length(client_folder_id) <= 200);
alter table public.office_missions add column if not exists status_changed_at timestamptz;
alter table public.office_missions add column if not exists closed_at timestamptz;
alter table public.office_missions add column if not exists archived_at timestamptz;
-- Copies of a message (client e-mails: CFO, mission manager, the agent's alias in Cc).
alter table public.office_agent_messages add column if not exists cc text[];
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

-- 4. People (2026-10-08): documented observations on missions (R012: a manager validates) and the
--    successive versions of each Management Card (evolution over time). Owner / managers only.
create table if not exists public.office_people_observations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  staff_profile_id uuid not null,
  office_mission_id uuid,
  kind text not null default 'comportement' check (kind in ('force', 'developpement', 'comportement', 'resultat')),
  observation text not null check (length(observation) between 5 and 1500),
  source text check (source is null or length(source) <= 300),
  status text not null default 'proposed' check (status in ('proposed', 'validated', 'rejected')),
  created_by text check (created_by is null or length(created_by) <= 120),
  validated_by text check (validated_by is null or length(validated_by) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists office_people_observations_idx on public.office_people_observations (org_id, staff_profile_id, created_at desc);
alter table public.office_people_observations enable row level security;
revoke all on public.office_people_observations from public, anon, authenticated, service_role;
grant select, insert, update on public.office_people_observations to service_role;

create table if not exists public.office_management_card_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  staff_profile_id uuid not null,
  version integer not null check (version >= 1),
  card jsonb not null check (jsonb_typeof(card) = 'object'),
  created_by text check (created_by is null or length(created_by) <= 120),
  created_at timestamptz not null default now(),
  unique (org_id, staff_profile_id, version)
);
alter table public.office_management_card_versions enable row level security;
revoke all on public.office_management_card_versions from public, anon, authenticated, service_role;
grant select, insert on public.office_management_card_versions to service_role;

-- 5. Instant internal messaging (2026-10-08): between the people of the firm, no validation;
--    visible about 24 h, then archived (kept). External e-mails stay in office_agent_messages.
create table if not exists public.office_chat_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  conversation text not null check (length(conversation) between 3 and 300),
  sender_email text not null check (length(sender_email) <= 200),
  sender_name text check (sender_name is null or length(sender_name) <= 120),
  body text not null check (length(body) between 1 and 4000),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists office_chat_messages_idx on public.office_chat_messages (org_id, archived, created_at desc);
create index if not exists office_chat_messages_conv_idx on public.office_chat_messages (org_id, conversation, created_at desc);
alter table public.office_chat_messages enable row level security;
revoke all on public.office_chat_messages from public, anon, authenticated, service_role;
grant select, insert, update on public.office_chat_messages to service_role;

-- 5b. Group discussions (2026-10-08): a name and its members; only members read and write.
create table if not exists public.office_chat_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null check (length(name) between 1 and 80),
  members text[] not null check (cardinality(members) between 2 and 60),
  created_by text not null check (length(created_by) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists office_chat_groups_idx on public.office_chat_groups (org_id, created_at desc);
alter table public.office_chat_groups enable row level security;
revoke all on public.office_chat_groups from public, anon, authenticated, service_role;
grant select, insert, update on public.office_chat_groups to service_role;

-- 6. Sign-off of working papers (2026-10-08), APPEND-ONLY: each step on the REAL Drive file and its
--    version (modifiedTime): opened, prepared, reviewed, comment, correction requested, corrected, signed off.
create table if not exists public.office_workpaper_signoffs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  office_mission_id uuid,
  file_id text not null check (length(file_id) between 5 and 200),
  file_name text check (file_name is null or length(file_name) <= 250),
  file_url text check (file_url is null or length(file_url) <= 500),
  version text check (version is null or length(version) <= 60),
  step text not null check (step in ('opened', 'prepared', 'reviewed', 'comment', 'correction_requested', 'corrected', 'signed_off')),
  by_name text check (by_name is null or length(by_name) <= 120),
  by_email text check (by_email is null or length(by_email) <= 200),
  comment text check (comment is null or length(comment) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists office_workpaper_signoffs_idx on public.office_workpaper_signoffs (org_id, file_id, created_at);
alter table public.office_workpaper_signoffs enable row level security;
revoke all on public.office_workpaper_signoffs from public, anon, authenticated, service_role;
grant select, insert on public.office_workpaper_signoffs to service_role;

-- 7. Agents' names chosen by the firm and the « rangement automatique » switch (2026-10-08).
--    Office Manager becomes Firm Manager (only where the old default name was still in place).
alter table public.office_agent_persona add column if not exists agent_names jsonb not null default '{}'::jsonb check (jsonb_typeof(agent_names) = 'object');
alter table public.office_agent_persona add column if not exists auto_filing boolean not null default true;
alter table public.office_agent_persona alter column agent_display_name set default 'Firm Manager';
update public.office_agent_persona set agent_display_name = 'Firm Manager' where agent_display_name = 'Office Manager';

-- 8. The agents' SMALL memory in Supabase (2026-10-09, Paul: « une infime mémoire ira dans Supabase et il
--    écrira dans un Excel ce qu'il fait »): one line per agent — the hour of its last pass and its
--    result. The full memory stays in 00_TATY_AI_MANAGER/MEMORY, the journal in its Excel.
create table if not exists public.office_agent_checkpoints (
  org_id uuid not null,
  agent_key text not null check (length(agent_key) between 2 and 60),
  last_pass_at timestamptz,
  status text check (status is null or length(status) <= 40),
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object' and length(report::text) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (org_id, agent_key)
);
alter table public.office_agent_checkpoints enable row level security;
revoke all on public.office_agent_checkpoints from public, anon, authenticated, service_role;
grant select, insert, update on public.office_agent_checkpoints to service_role;

-- 9. THE EVENT BUS (2026-10-09, architecture §11-14): agents exchange small structured events, not
--    free conversations. One row per event; the idempotency key makes a repeated event a no-op.
--    small_payload stays small (ids, refs, a few words) — never the content of a document.
create table if not exists public.office_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  event_type text not null check (event_type ~ '^[A-Z][A-Z0-9_]{2,60}$'),
  agent_id text check (agent_id is null or length(agent_id) <= 60),
  actor_id text check (actor_id is null or length(actor_id) <= 200),
  engagement_id uuid,
  object_type text check (object_type is null or length(object_type) <= 60),
  object_id text check (object_id is null or length(object_id) <= 200),
  source_reference text check (source_reference is null or length(source_reference) <= 300),
  consumer text check (consumer is null or length(consumer) <= 60),
  idempotency_key text not null check (length(idempotency_key) between 8 and 300),
  small_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(small_payload) = 'object' and length(small_payload::text) <= 4000),
  occurred_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'handled', 'ignored', 'failed')),
  attempts integer not null default 0,
  handled_at timestamptz,
  result text check (result is null or length(result) <= 500),
  unique (org_id, idempotency_key)
);
create index if not exists office_events_pending_idx on public.office_events (org_id, status, occurred_at);
create index if not exists office_events_engagement_idx on public.office_events (org_id, engagement_id, occurred_at desc);
alter table public.office_events enable row level security;
revoke all on public.office_events from public, anon, authenticated, service_role;
grant select, insert, update on public.office_events to service_role;

commit;

-- ===== live-collaboration.sql =====
-- Additive, service-only collaboration metadata. No message bodies or activity history.
create table if not exists public.office_presence (
 org_id uuid not null, email text not null, last_seen_at timestamptz not null,
 primary key(org_id,email)
);
create index if not exists office_presence_recent on public.office_presence(org_id,last_seen_at);
create table if not exists public.office_chat_reads (
 org_id uuid not null, email text not null, message_id uuid not null references public.office_chat_messages(id) on delete cascade,
 primary key(org_id,email,message_id)
);
alter table public.office_presence enable row level security;
alter table public.office_chat_reads enable row level security;
revoke all on public.office_presence,public.office_chat_reads from public,anon,authenticated,service_role;
grant select,insert,update on public.office_presence to service_role;
grant select,insert on public.office_chat_reads to service_role;

-- ===== inspection-reader-leases.sql =====
-- Install after db/memory.sql. Small control lease only; no document content or parallel memory.
-- Server calls only. SECURITY INVOKER preserves the existing table privilege/RLS contract.
create or replace function public.office_claim_reader_lease(p_org_id uuid, p_scope text, p_token uuid, p_ttl integer default 600)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  if p_scope is null or p_token is null or p_ttl is null or p_scope !~ '^[a-f0-9]{64}$' or p_ttl not between 60 and 900 then raise exception 'INVALID_READER_LEASE'; end if;
  insert into public.office_agent_checkpoints(org_id,agent_key,status,report,updated_at)
  values(p_org_id,'orpailleur-reader:' || pg_catalog.md5(p_scope),'PROCESSING',pg_catalog.jsonb_build_object('scope',p_scope,'token',p_token,'expires_at',pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_ttl)),pg_catalog.clock_timestamp())
  on conflict(org_id,agent_key) do update set status='PROCESSING',report=excluded.report,updated_at=excluded.updated_at
  where (public.office_agent_checkpoints.report->>'expires_at') is null
     or (public.office_agent_checkpoints.report->>'expires_at')::timestamptz <= pg_catalog.clock_timestamp();
  get diagnostics affected = row_count;
  return affected = 1;
end $$;
create or replace function public.office_renew_reader_lease(p_org_id uuid, p_scope text, p_token uuid, p_ttl integer default 600)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  if p_scope is null or p_token is null or p_ttl is null or p_scope !~ '^[a-f0-9]{64}$' or p_ttl not between 60 and 900 then raise exception 'INVALID_READER_LEASE'; end if;
  update public.office_agent_checkpoints set report=pg_catalog.jsonb_set(report,'{expires_at}',pg_catalog.to_jsonb(pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_ttl))),updated_at=pg_catalog.clock_timestamp()
  where org_id=p_org_id and agent_key='orpailleur-reader:' || pg_catalog.md5(p_scope)
    and report->>'scope'=p_scope and report->>'token'=p_token::text and (report->>'expires_at')::timestamptz > pg_catalog.clock_timestamp();
  get diagnostics affected = row_count; return affected = 1;
end $$;
create or replace function public.office_release_reader_lease(p_org_id uuid, p_scope text, p_token uuid, p_ttl integer default 600)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  update public.office_agent_checkpoints set status='IDLE',report=pg_catalog.jsonb_build_object('scope',p_scope),updated_at=pg_catalog.clock_timestamp()
  where org_id=p_org_id and agent_key='orpailleur-reader:' || pg_catalog.md5(p_scope) and report->>'scope'=p_scope and report->>'token'=p_token::text;
  get diagnostics affected = row_count; return affected = 1;
end $$;
revoke all on function public.office_claim_reader_lease(uuid,text,uuid,integer),public.office_renew_reader_lease(uuid,text,uuid,integer),public.office_release_reader_lease(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.office_claim_reader_lease(uuid,text,uuid,integer),public.office_renew_reader_lease(uuid,text,uuid,integer),public.office_release_reader_lease(uuid,text,uuid,integer) to service_role;

-- ===== mission-plans.sql =====
-- Internal draft versions only. No approvals, assignments or scheduler jobs.
begin;
create table if not exists public.office_mission_plan_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  office_mission_id uuid not null,
  version integer not null check(version > 0),
  content text not null check(length(content) between 1 and 50000),
  phases jsonb not null check(jsonb_typeof(phases)='array'),
  content_hash text not null,
  source text not null default 'pilot_submission',
  created_at timestamptz not null default now(),
  foreign key(org_id,office_mission_id) references public.office_missions(org_id,id),
  unique(org_id,office_mission_id,version),
  unique(org_id,office_mission_id,content_hash)
);
alter table public.office_mission_plan_versions enable row level security;
revoke all on public.office_mission_plan_versions from public,anon,authenticated,service_role;
grant select on public.office_mission_plan_versions to service_role;

create or replace function public.office_save_mission_plan(
  p_org_id uuid, p_mission_id uuid, p_content text, p_phases jsonb
) returns public.office_mission_plan_versions
language plpgsql security definer set search_path=pg_catalog
as $plan$
declare
  v_hash text;
  v_result public.office_mission_plan_versions;
  v_version integer;
begin
  if p_org_id is null or p_mission_id is null or p_content is null
     or length(btrim(p_content)) not between 1 and 50000
     or p_phases is null or jsonb_typeof(p_phases) <> 'array' then
    raise exception 'INVALID_PLAN';
  end if;
  if jsonb_array_length(p_phases)>20 or exists (
    select 1 from jsonb_array_elements(p_phases) item
    where jsonb_typeof(item)<>'string' or length(btrim(item#>>'{}')) not between 1 and 500
  ) then raise exception 'INVALID_PHASES'; end if;
  perform 1 from public.office_missions where org_id=p_org_id and id=p_mission_id;
  if not found then raise exception 'MISSION_NOT_FOUND'; end if;
  -- Serializes only versions of the same org/mission; retries return the same row.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_mission_id::text,0));
  v_hash := encode(sha256(convert_to(jsonb_build_object('content',p_content,'phases',p_phases)::text,'UTF8')),'hex');
  select * into v_result from public.office_mission_plan_versions
    where org_id=p_org_id and office_mission_id=p_mission_id and content_hash=v_hash;
  if found then return v_result; end if;
  select coalesce(max(version),0)+1 into v_version from public.office_mission_plan_versions
    where org_id=p_org_id and office_mission_id=p_mission_id;
  insert into public.office_mission_plan_versions(org_id,office_mission_id,version,content,phases,content_hash)
    values(p_org_id,p_mission_id,v_version,p_content,p_phases,v_hash)
    returning * into v_result;
  return v_result;
end;
$plan$;
revoke all on function public.office_save_mission_plan(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.office_save_mission_plan(uuid,uuid,text,jsonb) to service_role;
commit;

-- ===== workfiles.sql =====
-- Work files opened in Excel with the Office Manager panel (branch « amelioration », 2026-10-08).
-- Additive only: two new tables, nothing changed elsewhere. No DELETE granted.
--   office_workfile_sessions : one row per work file opened in Excel with the panel (who, which
--     file, which mission, when, active time). Used for: files left open (Orpailleur proposes to
--     save and close), actual time per mission, overlaps.
--   office_workfile_remarks  : review remarks on a work file (Enhanced Auditor, manager), written
--     into the file by the panel and answered there; also visible in the application.
begin;

create table if not exists public.office_workfile_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  client_session text not null check (length(client_session) between 8 and 80),
  user_email text check (user_email is null or length(user_email) <= 254),
  user_name text check (user_name is null or length(user_name) <= 120),
  file_id text check (file_id is null or length(file_id) <= 200),
  file_name text not null check (length(file_name) between 1 and 300),
  file_path text check (file_path is null or length(file_path) <= 1000),
  mission_id uuid,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  active_seconds integer not null default 0 check (active_seconds >= 0),
  edits integer not null default 0 check (edits >= 0),
  dirty boolean,
  save_close_requested boolean not null default false,
  save_close_action_id uuid,
  closed_at timestamptz,
  close_reason text check (close_reason is null or close_reason in ('closed', 'saved_closed', 'timeout')),
  unique (org_id, client_session)
);
create index if not exists office_workfile_sessions_org_idx on public.office_workfile_sessions (org_id, last_seen_at desc);
create index if not exists office_workfile_sessions_mission_idx on public.office_workfile_sessions (org_id, mission_id, started_at desc);

create table if not exists public.office_workfile_remarks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  file_id text check (file_id is null or length(file_id) <= 200),
  file_name text not null check (length(file_name) between 1 and 300),
  mission_id uuid,
  sheet text check (sheet is null or length(sheet) <= 120),
  cell text check (cell is null or length(cell) <= 40),
  remark text not null check (length(remark) between 1 and 4000),
  severity text not null default 'medium' check (severity in ('high', 'medium', 'low')),
  source text not null default 'enhanced-auditor' check (source in ('enhanced-auditor', 'manager', 'person')),
  author text check (author is null or length(author) <= 120),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  reply text check (reply is null or length(reply) <= 4000),
  replied_by text check (replied_by is null or length(replied_by) <= 120),
  replied_at timestamptz,
  written_in_file_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists office_workfile_remarks_file_idx on public.office_workfile_remarks (org_id, file_id, created_at desc);
create index if not exists office_workfile_remarks_mission_idx on public.office_workfile_remarks (org_id, mission_id, status);

alter table public.office_workfile_sessions enable row level security;
alter table public.office_workfile_remarks enable row level security;
revoke all on public.office_workfile_sessions from public, anon, authenticated, service_role;
revoke all on public.office_workfile_remarks from public, anon, authenticated, service_role;
grant select, insert, update on public.office_workfile_sessions to service_role;
grant select, insert, update on public.office_workfile_remarks to service_role;
commit;

-- ===== people-intelligence.sql =====
-- Schema-only snapshot. No RH records, questionnaire responses or tenant identifiers.
-- Existing Office Manager foundation and private.office_role are prerequisites.
begin;
create table if not exists public.office_mission_people_requirements (
id uuid not null default gen_random_uuid(),
org_id uuid not null,
office_mission_id uuid,
autonomy_required smallint not null default 3,
structure_level smallint not null default 3,
ambiguity_level smallint not null default 3,
innovation_level smallint not null default 3,
collaboration_level smallint not null default 3,
decision_speed_required smallint not null default 3,
compliance_level smallint not null default 4,
stability_level smallint not null default 3,
client_contact_level smallint not null default 3,
urgency_level smallint not null default 3,
mission_context text,
source text not null default 'agent_analysis'::text,
confidence numeric(3,2) not null default 0.70,
created_at timestamp with time zone not null default now(),
updated_at timestamp with time zone not null default now()
);

create table if not exists public.office_staff_management_profiles (
id uuid not null default gen_random_uuid(),
org_id uuid not null,
staff_profile_id uuid not null,
profile_label text not null,
autonomy_score smallint not null,
structure_need_score smallint not null,
recognition_need_score smallint not null,
uncertainty_tolerance_score smallint not null,
innovation_score smallint not null,
team_orientation_score smallint not null,
decision_confidence_score smallint not null,
feedback_sensitivity_score smallint not null,
stability_preference_score smallint not null,
compliance_orientation_score smallint not null,
primary_motivators text[] not null default '{}'::text[],
demotivators text[] not null default '{}'::text[],
preferred_mission_types text[] not null default '{}'::text[],
best_mission_conditions text[] not null default '{}'::text[],
briefing_requirements text[] not null default '{}'::text[],
management_style text not null,
communication_guidance text not null,
feedback_guidance text not null,
risk_flags text[] not null default '{}'::text[],
development_focus text[] not null default '{}'::text[],
source_type text not null default 'work_preferences_questionnaire'::text,
source_ref text,
evidence_note text not null default 'Indicateur managérial issu de préférences de travail déclarées; ne constitue pas un diagnostic psychologique.'::text,
profile_confidence numeric(3,2) not null default 0.65,
profile_version integer not null default 1,
active boolean not null default true,
created_at timestamp with time zone not null default now(),
updated_at timestamp with time zone not null default now()
);
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_prof_compliance_orientation_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_prof_compliance_orientation_score_check CHECK (((compliance_orientation_score >= 1) AND (compliance_orientation_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profi_uncertainty_tolerance_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profi_uncertainty_tolerance_score_check CHECK (((uncertainty_tolerance_score >= 1) AND (uncertainty_tolerance_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profil_feedback_sensitivity_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profil_feedback_sensitivity_score_check CHECK (((feedback_sensitivity_score >= 1) AND (feedback_sensitivity_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profil_stability_preference_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profil_stability_preference_score_check CHECK (((stability_preference_score >= 1) AND (stability_preference_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profile_decision_confidence_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profile_decision_confidence_score_check CHECK (((decision_confidence_score >= 1) AND (decision_confidence_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_autonomy_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_autonomy_score_check CHECK (((autonomy_score >= 1) AND (autonomy_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_innovation_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_innovation_score_check CHECK (((innovation_score >= 1) AND (innovation_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_org_id_fkey') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_org_id_fkey FOREIGN KEY (org_id) REFERENCES office_organizations(id) ON DELETE CASCADE;
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_org_id_staff_profile_id_key') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_org_id_staff_profile_id_key UNIQUE (org_id, staff_profile_id);
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_pkey') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_pkey PRIMARY KEY (id);
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_profile_confidence_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_profile_confidence_check CHECK (((profile_confidence >= (0)::numeric) AND (profile_confidence <= (1)::numeric)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_recognition_need_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_recognition_need_score_check CHECK (((recognition_need_score >= 1) AND (recognition_need_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_staff_profile_id_fkey') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_staff_profile_id_fkey FOREIGN KEY (staff_profile_id) REFERENCES office_staff_profiles(id) ON DELETE CASCADE;
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_structure_need_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_structure_need_score_check CHECK (((structure_need_score >= 1) AND (structure_need_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_team_orientation_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_team_orientation_score_check CHECK (((team_orientation_score >= 1) AND (team_orientation_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirement_decision_speed_required_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirement_decision_speed_required_check CHECK (((decision_speed_required >= 1) AND (decision_speed_required <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_ambiguity_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_ambiguity_level_check CHECK (((ambiguity_level >= 1) AND (ambiguity_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_autonomy_required_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_autonomy_required_check CHECK (((autonomy_required >= 1) AND (autonomy_required <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_client_contact_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_client_contact_level_check CHECK (((client_contact_level >= 1) AND (client_contact_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_collaboration_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_collaboration_level_check CHECK (((collaboration_level >= 1) AND (collaboration_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_compliance_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_compliance_level_check CHECK (((compliance_level >= 1) AND (compliance_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_confidence_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_innovation_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_innovation_level_check CHECK (((innovation_level >= 1) AND (innovation_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_office_mission_id_fkey') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_office_mission_id_fkey FOREIGN KEY (office_mission_id) REFERENCES office_missions(id) ON DELETE CASCADE;
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_org_id_fkey') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_org_id_fkey FOREIGN KEY (org_id) REFERENCES office_organizations(id) ON DELETE CASCADE;
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_org_id_office_mission_id_key') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_org_id_office_mission_id_key UNIQUE (org_id, office_mission_id);
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_pkey') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_pkey PRIMARY KEY (id);
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_stability_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_stability_level_check CHECK (((stability_level >= 1) AND (stability_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_structure_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_structure_level_check CHECK (((structure_level >= 1) AND (structure_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_urgency_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_urgency_level_check CHECK (((urgency_level >= 1) AND (urgency_level <= 5)));
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.office_people_match(p_org_id uuid, p_requirements jsonb, p_limit integer DEFAULT 10)
 RETURNS TABLE(staff_profile_id uuid, full_name text, role_title text, profile_label text, fit_score numeric, fit_band text, recognition_need integer, management_brief jsonb)
 LANGUAGE sql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
with req as (
  select
    greatest(1,least(5,coalesce((p_requirements->>'autonomy_required')::int,3))) as autonomy_required,
    greatest(1,least(5,coalesce((p_requirements->>'structure_level')::int,3))) as structure_level,
    greatest(1,least(5,coalesce((p_requirements->>'ambiguity_level')::int,3))) as ambiguity_level,
    greatest(1,least(5,coalesce((p_requirements->>'innovation_level')::int,3))) as innovation_level,
    greatest(1,least(5,coalesce((p_requirements->>'collaboration_level')::int,3))) as collaboration_level,
    greatest(1,least(5,coalesce((p_requirements->>'decision_speed_required')::int,3))) as decision_speed_required,
    greatest(1,least(5,coalesce((p_requirements->>'compliance_level')::int,4))) as compliance_level,
    greatest(1,least(5,coalesce((p_requirements->>'stability_level')::int,3))) as stability_level
), scored as (
  select
    mp.staff_profile_id,
    sp.full_name,
    sp.role_title,
    mp.profile_label,
    mp.recognition_need_score,
    mp.management_style,
    mp.communication_guidance,
    mp.feedback_guidance,
    mp.briefing_requirements,
    mp.primary_motivators,
    mp.risk_flags,
    round((
      100
      - (abs(mp.autonomy_score-r.autonomy_required) * 5.0)
      - (abs(mp.structure_need_score-r.structure_level) * 4.0)
      - (abs(mp.uncertainty_tolerance_score-r.ambiguity_level) * 5.0)
      - (abs(mp.innovation_score-r.innovation_level) * 4.0)
      - (abs(mp.team_orientation_score-r.collaboration_level) * 3.0)
      - (abs(mp.decision_confidence_score-r.decision_speed_required) * 4.0)
      - (abs(mp.compliance_orientation_score-r.compliance_level) * 3.0)
      - (abs(mp.stability_preference_score-r.stability_level) * 2.0)
    )::numeric,1) as fit_score
  from public.office_staff_management_profiles mp
  join public.office_staff_profiles sp on sp.id=mp.staff_profile_id and sp.org_id=mp.org_id
  cross join req r
  where mp.org_id=p_org_id and mp.active=true and sp.active=true
    and (not (p_requirements ? 'eligible_staff_profile_ids')
      or mp.staff_profile_id::text in (
        select jsonb_array_elements_text(p_requirements->'eligible_staff_profile_ids')
      ))
)
select
  s.staff_profile_id,
  s.full_name,
  s.role_title,
  s.profile_label,
  greatest(0,least(100,s.fit_score)) as fit_score,
  case when s.fit_score >= 85 then 'TRES_BON'
       when s.fit_score >= 70 then 'BON'
       when s.fit_score >= 55 then 'MOYEN'
       else 'FAIBLE' end as fit_band,
  s.recognition_need_score::int as recognition_need,
  jsonb_build_object(
    'management_style',s.management_style,
    'communication',s.communication_guidance,
    'feedback',s.feedback_guidance,
    'briefing_requirements',to_jsonb(s.briefing_requirements),
    'motivators',to_jsonb(s.primary_motivators),
    'watchouts',to_jsonb(s.risk_flags),
    'guardrail','Utiliser ce profil comme aide au management et à la composition d équipe, jamais comme diagnostic clinique ni comme base unique de décision RH.'
  ) as management_brief
from scored s
order by greatest(0,least(100,s.fit_score)) desc, s.full_name
limit greatest(1,least(coalesce(p_limit,10),50));
$function$;

alter table public.office_mission_people_requirements add column if not exists required_skills text[] not null default '{}';
alter table public.office_mission_people_requirements add column if not exists preferred_team_size smallint not null default 4;

CREATE OR REPLACE FUNCTION public.office_mission_staffing_advice(p_org_id uuid, p_office_mission_id uuid)
 RETURNS TABLE(staff_profile_id uuid, full_name text, role_title text, role_family text, skills text[], technical_eligible boolean, available_for_window boolean, current_load_pct numeric, profile_available boolean, management_support jsonb, data_quality_flags text[])
 LANGUAGE sql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
with mission as (
  select m.id,m.org_id,m.name,m.mission_code,m.planned_start,m.planned_end,
         r.required_skills,r.autonomy_required,r.structure_level,r.ambiguity_level,
         r.innovation_level,r.collaboration_level,r.decision_speed_required,
         r.compliance_level,r.stability_level,r.client_contact_level,r.urgency_level
  from public.office_missions m
  left join public.office_mission_people_requirements r
    on r.org_id=m.org_id and r.office_mission_id=m.id
  where m.org_id=p_org_id and m.id=p_office_mission_id
), normalized as (
  select *,
    case
      when coalesce(cardinality(required_skills),0)>0 then required_skills
      when lower(coalesce(mission_code,'')||' '||coalesce(name,'')) ~ '(due[ _-]?diligence|diligence[ _-]?financi)' then array['Audit','Conseil']::text[]
      when lower(coalesce(mission_code,'')||' '||coalesce(name,'')) ~ '(audit|commissariat|cac)' then array['Audit']::text[]
      else '{}'::text[]
    end as effective_required_skills
  from mission
), assignment_load as (
  select a.staff_profile_id,
         sum(a.allocation_pct)::numeric as load_pct
  from public.office_mission_assignments a
  cross join normalized n
  where a.org_id=p_org_id
    and lower(coalesce(a.status,'')) not in ('cancelled','canceled','rejected')
    and (
      n.planned_start is null or n.planned_end is null
      or daterange(a.planned_start,a.planned_end,'[]') && daterange(n.planned_start,n.planned_end,'[]')
    )
    and a.office_mission_id <> p_office_mission_id
  group by a.staff_profile_id
), workforce_load as (
  select a.staff_profile_id,
         sum(a.planned_load_pct)::numeric as load_pct
  from public.office_workforce_allocations a
  cross join normalized n
  where a.org_id=p_org_id
    and lower(coalesce(a.status,'')) not in ('cancelled','canceled','rejected')
    and (
      n.planned_start is null or n.planned_end is null
      or daterange(a.start_date,a.end_date,'[]') && daterange(n.planned_start,n.planned_end,'[]')
    )
    and a.office_mission_id <> p_office_mission_id
  group by a.staff_profile_id
), unavailable as (
  select distinct a.staff_profile_id
  from public.office_staff_availability a
  cross join normalized n
  where a.org_id=p_org_id and a.approved=true
    and (
      n.planned_start is null or n.planned_end is null
      or tstzrange(a.starts_at,a.ends_at,'[]') && tstzrange(n.planned_start::timestamptz,(n.planned_end+1)::timestamptz,'[)')
    )
), dq as (
  select array_remove(array[
    case when planned_start is null or planned_end is null then 'MISSION_DATES_MISSING' end,
    case when not exists(select 1 from public.office_mission_assignments x where x.org_id=p_org_id)
          and not exists(select 1 from public.office_workforce_allocations y where y.org_id=p_org_id)
         then 'WORKLOAD_DATA_MISSING' end,
    case when not exists(select 1 from public.office_staff_availability z where z.org_id=p_org_id)
         then 'AVAILABILITY_EXCEPTIONS_NOT_RECORDED' end
  ],null)::text[] flags
  from normalized
)
select
  sp.id,
  sp.full_name,
  sp.role_title,
  case
    when lower(coalesce(sp.role_title,'')) like '%partner%' then 'OVERSIGHT'
    when lower(coalesce(sp.role_title,'')) like '%manager%' or lower(coalesce(sp.role_title,'')) like '%superviseur%' then 'MANAGEMENT'
    when lower(coalesce(sp.role_title,'')) like '%senior%' then 'SENIOR'
    when lower(coalesce(sp.role_title,'')) like '%stagiaire%' then 'JUNIOR'
    when lower(coalesce(sp.role_title,'')) like '%audit%' then 'FIELD'
    else 'OTHER'
  end as role_family,
  sp.skills,
  (
    (coalesce(cardinality(n.effective_required_skills),0)=0 or sp.skills && n.effective_required_skills)
    and not (lower(coalesce(sp.role_title,'')) ~ '(assistante|secr|chauffeur|coursier)')
  ) as technical_eligible,
  (u.staff_profile_id is null) as available_for_window,
  greatest(coalesce(al.load_pct,0),coalesce(wl.load_pct,0))::numeric as current_load_pct,
  (mp.staff_profile_id is not null) as profile_available,
  case when mp.staff_profile_id is null then
    jsonb_build_object(
      'profile_available',false,
      'instruction','Aucun questionnaire de préférences de travail disponible. Ne pas pénaliser le collaborateur; utiliser les règles normales de management et recueillir des préférences directement.'
    )
  else
    jsonb_build_object(
      'profile_available',true,
      'profile_label',mp.profile_label,
      'management_style',mp.management_style,
      'communication',mp.communication_guidance,
      'feedback',mp.feedback_guidance,
      'briefing_requirements',to_jsonb(mp.briefing_requirements),
      'motivators',to_jsonb(mp.primary_motivators),
      'watchouts',to_jsonb(mp.risk_flags),
      'mission_support',jsonb_build_object(
        'extra_structure', case when coalesce(n.ambiguity_level,3)>=4 and mp.structure_need_score>=4 then true else false end,
        'more_frequent_checkpoints', case when coalesce(n.ambiguity_level,3)>=4 and mp.uncertainty_tolerance_score<=2 then true else false end,
        'explicit_recognition_helpful', case when mp.recognition_need_score>=4 then true else false end,
        'autonomy_can_be_high', case when mp.autonomy_score>=4 and mp.decision_confidence_score>=4 then true else false end
      ),
      'guardrail','Préférences de travail déclarées: aide au briefing et au management uniquement. Ne pas utiliser pour exclure, sanctionner, promouvoir, rémunérer ou affecter seul.'
    )
  end as management_support,
  dq.flags
from public.office_staff_profiles sp
cross join normalized n
cross join dq
left join assignment_load al on al.staff_profile_id=sp.id
left join workforce_load wl on wl.staff_profile_id=sp.id
left join unavailable u on u.staff_profile_id=sp.id
left join public.office_staff_management_profiles mp
  on mp.org_id=sp.org_id and mp.staff_profile_id=sp.id and mp.active=true
where sp.org_id=p_org_id and sp.active=true
order by technical_eligible desc, available_for_window desc,
         greatest(coalesce(al.load_pct,0),coalesce(wl.load_pct,0)) asc,
         case
           when lower(coalesce(sp.role_title,'')) like '%partner%' then 1
           when lower(coalesce(sp.role_title,'')) like '%manager%' then 2
           when lower(coalesce(sp.role_title,'')) like '%superviseur%' then 3
           when lower(coalesce(sp.role_title,'')) like '%senior%' then 4
           when lower(coalesce(sp.role_title,'')) like '%audit%' and lower(coalesce(sp.role_title,'')) not like '%stagiaire%' then 5
           when lower(coalesce(sp.role_title,'')) like '%stagiaire%' then 6
           else 9
         end,
         sp.full_name;
$function$;


CREATE OR REPLACE FUNCTION private.enrich_people_intelligence_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
begin
  if new.action_type='PEOPLE_INTELLIGENCE_RECOMMENDATION' then
    new.evidence := coalesce(new.evidence,'{}'::jsonb) || jsonb_build_object(
      'staffing_digest',coalesce(new.payload->'candidate_pool','[]'::jsonb),
      'data_quality_flags',coalesce(new.payload->'data_quality_flags','[]'::jsonb),
      'selection_order',coalesce(new.payload->'selection_order','[]'::jsonb),
      'management_instruction',coalesce(new.payload->>'instruction',''),
      'required_skills',coalesce(new.payload->'required_skills','[]'::jsonb),
      'preferred_team_size',coalesce(new.payload->'preferred_team_size','4'::jsonb),
      'context_visibility','Copied into evidence because Office Manager root context reads action evidence.'
    );
  end if;
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION private.enqueue_people_intelligence_for_mission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_text text := lower(coalesce(new.mission_code,'') || ' ' || coalesce(new.name,''));
  v_req jsonb;
  v_kind text;
  v_required_skills text[];
  v_team_size integer := 4;
  v_candidates jsonb;
  v_data_quality text[] := '{}'::text[];
begin
  if v_text ~ '(due[ _-]?diligence|diligence[ _-]?financi)' then
    v_kind := 'DUE_DILIGENCE';
    v_required_skills := array['Audit','Conseil']::text[];
    v_req := jsonb_build_object(
      'autonomy_required',4,'structure_level',3,'ambiguity_level',4,'innovation_level',4,
      'collaboration_level',4,'decision_speed_required',4,'compliance_level',4,'stability_level',2,
      'client_contact_level',4,'urgency_level',4
    );
  elsif v_text ~ '(audit|commissariat|cac)' then
    v_kind := 'AUDIT';
    v_required_skills := array['Audit']::text[];
    v_req := jsonb_build_object(
      'autonomy_required',3,'structure_level',4,'ambiguity_level',2,'innovation_level',2,
      'collaboration_level',4,'decision_speed_required',3,'compliance_level',5,'stability_level',4,
      'client_contact_level',3,'urgency_level',3
    );
  else
    v_kind := 'GENERAL';
    v_required_skills := '{}'::text[];
    v_req := jsonb_build_object(
      'autonomy_required',3,'structure_level',3,'ambiguity_level',3,'innovation_level',3,
      'collaboration_level',3,'decision_speed_required',3,'compliance_level',4,'stability_level',3,
      'client_contact_level',3,'urgency_level',3
    );
  end if;

  insert into public.office_mission_people_requirements(
    org_id,office_mission_id,autonomy_required,structure_level,ambiguity_level,innovation_level,
    collaboration_level,decision_speed_required,compliance_level,stability_level,client_contact_level,
    urgency_level,required_skills,preferred_team_size,mission_context,source,confidence,updated_at
  ) values (
    new.org_id,new.id,
    (v_req->>'autonomy_required')::int,(v_req->>'structure_level')::int,(v_req->>'ambiguity_level')::int,
    (v_req->>'innovation_level')::int,(v_req->>'collaboration_level')::int,(v_req->>'decision_speed_required')::int,
    (v_req->>'compliance_level')::int,(v_req->>'stability_level')::int,(v_req->>'client_contact_level')::int,
    (v_req->>'urgency_level')::int,
    v_required_skills,v_team_size,
    'Profil opérationnel initial dérivé du type de mission '||v_kind||'. À affiner par le manager selon les TDR, le programme de travail et les exigences client.',
    'mission_trigger_v2_safe_staffing',0.65,now()
  )
  on conflict (org_id,office_mission_id) do update set
    autonomy_required=excluded.autonomy_required,
    structure_level=excluded.structure_level,
    ambiguity_level=excluded.ambiguity_level,
    innovation_level=excluded.innovation_level,
    collaboration_level=excluded.collaboration_level,
    decision_speed_required=excluded.decision_speed_required,
    compliance_level=excluded.compliance_level,
    stability_level=excluded.stability_level,
    client_contact_level=excluded.client_contact_level,
    urgency_level=excluded.urgency_level,
    required_skills=excluded.required_skills,
    preferred_team_size=excluded.preferred_team_size,
    mission_context=excluded.mission_context,
    source=excluded.source,
    confidence=excluded.confidence,
    updated_at=now()
  where office_mission_people_requirements.source in ('mission_trigger_v1','mission_trigger_v2','mission_trigger_v2_safe_staffing');

  select to_jsonb(r) into v_req from public.office_mission_people_requirements r
  where r.org_id=new.org_id and r.office_mission_id=new.id;
  v_required_skills := array(select jsonb_array_elements_text(v_req->'required_skills'));
  v_team_size := coalesce((v_req->>'preferred_team_size')::integer,4);

  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_profile_id',s.staff_profile_id,
    'full_name',s.full_name,
    'role_title',s.role_title,
    'role_family',s.role_family,
    'skills',to_jsonb(s.skills),
    'technical_eligible',s.technical_eligible,
    'available_for_window',s.available_for_window,
    'current_load_pct',s.current_load_pct,
    'profile_available',s.profile_available,
    'management_support',s.management_support
  ) order by
    case s.role_family when 'OVERSIGHT' then 1 when 'MANAGEMENT' then 2 when 'SENIOR' then 3 when 'FIELD' then 4 when 'JUNIOR' then 5 else 9 end,
    s.current_load_pct,
    s.full_name),'[]'::jsonb)
  into v_candidates
  from public.office_mission_staffing_advice(new.org_id,new.id) s
  where s.technical_eligible=true and s.available_for_window=true and s.current_load_pct < 100;

  select coalesce(s.data_quality_flags,'{}'::text[])
  into v_data_quality
  from public.office_mission_staffing_advice(new.org_id,new.id) s
  limit 1;

  insert into public.office_action_queue(
    org_id,agent_key,office_mission_id,action_type,idempotency_key,summary,payload,evidence,status,requested_at,work_state
  ) values (
    new.org_id,'grand-controleur',new.id,'PEOPLE_INTELLIGENCE_RECOMMENDATION',
    'people-intelligence:'||new.id::text,
    'Préparation équipe et briefing managérial — '||new.name,
    jsonb_build_object(
      'mission_type',v_kind,
      'required_skills',to_jsonb(v_required_skills),
      'preferred_team_size',v_team_size,
      'mission_requirements',v_req,
      'candidate_pool',v_candidates,
      'data_quality_flags',to_jsonb(coalesce(v_data_quality,'{}'::text[])),
      'team_shape',jsonb_build_object(
        'oversight','1 partner/associé selon exigences de mission',
        'management','1 manager ou superviseur',
        'senior','au moins 1 senior si complexité significative',
        'field_team','auditeurs et stagiaires selon charge et cycles'
      ),
      'selection_order',jsonb_build_array(
        'compétences techniques et expérience requise',
        'disponibilité réelle et absence de chevauchement',
        'charge de travail et niveau hiérarchique adapté',
        'équilibre de l équipe',
        'préférences de travail uniquement pour adapter le management après présélection'
      ),
      'instruction','Le questionnaire de préférences de travail ne détermine jamais l éligibilité ni l affectation. Il sert à préparer le briefing, la communication, les checkpoints et le feedback.'
    ),
    jsonb_build_object(
      'algorithm_version','safe_staffing_v2',
      'profile_source','Questionnaire de préférences de travail du cabinet + données opérationnelles Supabase',
      'guardrail','Aucune décision RH sensible ou affectation automatique fondée sur un profil psychologique. Validation humaine obligatoire.',
      'generated_at',now()
    ),
    'proposed',now(),'requested'
  )
  on conflict (org_id,idempotency_key) do update set
    summary=excluded.summary,payload=excluded.payload,evidence=excluded.evidence,
    status='proposed',requested_at=now(),work_state='requested'
  where office_action_queue.status in ('proposed','awaiting_approval')
    and office_action_queue.approved_at is null
    and office_action_queue.executed_at is null
    and office_action_queue.verified_at is null;

  return new;
end;
$function$;


alter table public.office_mission_people_requirements add column if not exists required_skills text[] not null default '{}';
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='public.office_staff_management_profiles'::regclass and conname='people_staff_tenant_fk') then
  alter table public.office_staff_management_profiles add constraint people_staff_tenant_fk
   foreign key (org_id,staff_profile_id) references public.office_staff_profiles(org_id,id);
 end if;
 if not exists (select 1 from pg_constraint where conrelid='public.office_mission_people_requirements'::regclass and conname='people_mission_tenant_fk') then
  alter table public.office_mission_people_requirements add constraint people_mission_tenant_fk
   foreign key (org_id,office_mission_id) references public.office_missions(org_id,id);
 end if;
end $guard$;

-- Canonical rules only; no questionnaire or individual profile seeds.
insert into private.agent_rules(rule_code,name,description,default_severity,active) values
 ('R009','Matching humain avant affectation','Vérifier compétences et disponibilité avant le people fit complémentaire.','ELEVE',true),
 ('R010','Briefing adapté au profil','Adapter cadrage, autonomie, communication, reconnaissance et feedback.','MOYEN',true),
 ('R011','Garde-fou décision RH','Aucune décision RH sensible fondée sur le questionnaire seul; aucun diagnostic clinique.','CRITIQUE',true),
 ('R012','Boucle post-mission','Ajuster les profils à partir de faits professionnels documentés et validés après mission.','MOYEN',true)
on conflict(rule_code) do nothing;
alter table public.office_staff_management_profiles enable row level security;
alter table public.office_mission_people_requirements enable row level security;
revoke all on public.office_staff_management_profiles, public.office_mission_people_requirements from anon, authenticated;
grant select, insert, update, delete on public.office_staff_management_profiles, public.office_mission_people_requirements to service_role;
revoke all on function public.office_people_match(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.office_people_match(uuid,jsonb,integer) to service_role;
revoke all on function private.enqueue_people_intelligence_for_mission() from public,anon,authenticated;
create index if not exists office_staff_management_profiles_staff_idx on public.office_staff_management_profiles(staff_profile_id);
create index if not exists office_mission_people_requirements_mission_idx on public.office_mission_people_requirements(office_mission_id);
drop trigger if exists trg_office_missions_people_intelligence on public.office_missions;
create trigger trg_office_missions_people_intelligence after insert or update of mission_code,name,planned_start,planned_end,org_id on public.office_missions
for each row execute function private.enqueue_people_intelligence_for_mission();

revoke all on function public.office_mission_staffing_advice(uuid,uuid) from public,anon,authenticated;
grant execute on function public.office_mission_staffing_advice(uuid,uuid) to service_role;
revoke all on function private.enrich_people_intelligence_action() from public,anon,authenticated;
drop trigger if exists trg_enrich_people_intelligence_action on public.office_action_queue;
create trigger trg_enrich_people_intelligence_action before insert or update of payload,evidence on public.office_action_queue
for each row execute function private.enrich_people_intelligence_action();

commit;

-- ===== work-programme.sql =====
-- PROGRAMME DE TRAVAIL D'UNE MISSION (2026-10-12, Paul : « le manager choisit les cycles après la revue analytique, puis fait
-- un programme de travail où il détaille les cycles et les contrôles ; il le saisit ou l'importe dans le Mission Controller,
-- qui lui propose les tests des SOP avec leurs codes »). Une ligne par version : brouillon modifiable, puis validée
-- (figée) ; une nouvelle modification après validation crée une nouvelle version, l'ancienne passe « superseded ».
-- Petite mémoire : codes de procédures, personnes, décisions, références de fichiers — jamais le contenu des SOP.
-- Relançable : rien n'est remplacé.
create table if not exists public.office_work_programmes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  office_mission_id uuid not null,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'validated', 'superseded')),
  materiality jsonb not null default '{}'::jsonb,
  reviews jsonb not null default '{}'::jsonb,
  cycles jsonb not null default '[]'::jsonb check (jsonb_typeof(cycles) = 'array'),
  source text not null default 'manual' check (source in ('manual', 'import')),
  imported_file_id text,
  created_by text,
  updated_by text,
  validated_by text,
  validated_at timestamptz,
  workpapers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, office_mission_id, version)
);
create index if not exists office_work_programmes_mission on public.office_work_programmes (org_id, office_mission_id, version desc);
alter table public.office_work_programmes enable row level security;
revoke all on public.office_work_programmes from public, anon, authenticated;
grant select, insert, update on public.office_work_programmes to service_role;

-- ===== procedure-work.sql =====
-- LE TRAVAIL SUR UNE PROCÉDURE DU PROGRAMME (2026-10-12, écran « Ma procédure ») : une ligne par procédure d'un programme
-- validé. Population contrôlée (référence du fichier, nombre de lignes, total, écart avec le grand livre), échantillon
-- (méthode, graine du tirage pour le refaire, éléments), résultat de chaque élément (pièce, PASS/EXCEPTION, écart, qui,
-- quand, et ce que l'Enhanced Auditor avait proposé), conclusion, état de l'écriture dans le Working Paper.
-- Les pièces restent dans le Drive (seulement leurs ids). Relançable : rien n'est remplacé.
create table if not exists public.office_procedure_work (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  office_mission_id uuid not null,
  programme_id uuid not null,
  cycle_code text not null,
  procedure_code text not null,
  preparer text,
  status text not null default 'to_do' check (status in ('to_do', 'in_progress', 'submitted', 'returned', 'reviewed')),
  population jsonb not null default '{}'::jsonb,
  sample jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  walkthrough jsonb not null default '[]'::jsonb,
  conclusion text,
  wp_sync jsonb not null default '{}'::jsonb,
  updated_by text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, programme_id, procedure_code)
);
create index if not exists office_procedure_work_mission on public.office_procedure_work (org_id, office_mission_id);
create index if not exists office_procedure_work_preparer on public.office_procedure_work (org_id, preparer);
alter table public.office_procedure_work enable row level security;
revoke all on public.office_procedure_work from public, anon, authenticated;
grant select, insert, update on public.office_procedure_work to service_role;
-- Revues (2026-10-12) : signatures par niveau requis par la mission (liées au contenu exact de l'onglet de la procédure)
-- et points de revue (ouvert → répondu → levé).
alter table public.office_procedure_work add column if not exists reviews jsonb not null default '[]'::jsonb;
alter table public.office_procedure_work add column if not exists review_points jsonb not null default '[]'::jsonb;

-- ===== mission-quick.sql =====
-- Direct mission creation (Paul, 2026-10-19): « créer une mission et y aller directement, remplir le reste après ».
-- ADDITIVE ONLY. A mission may come from a tender (Opportunités) OR directly (client direct, client existant,
-- mission récurrente, recommandation, nomination…). The source of the mission is NOT its acceptance:
-- acceptance / KYC, independence and the engagement letter stay followed as open items (followups), never faked.
-- The application works without this file: the mission is then created without these columns.
alter table public.office_missions add column if not exists origin text check (origin is null or length(origin) <= 40);
alter table public.office_missions add column if not exists engagement_type text check (engagement_type is null or length(engagement_type) <= 80);
alter table public.office_missions add column if not exists period_label text check (period_label is null or length(period_label) <= 80);
alter table public.office_missions add column if not exists created_by text check (created_by is null or length(created_by) <= 200);
alter table public.office_missions add column if not exists followups jsonb not null default '{}'::jsonb;

-- ===== mission-functions.sql =====
-- Function of a person on ONE mission (Paul, 2026-10-19, point 2: « superviseur sur une mission, manager sur une autre »).
-- ADDITIVE ONLY. mission_role stays the free label shown on screen (written at creation, sometimes by the person
-- themselves): it never gives a right. mission_function is a closed list, written ONLY by lib/mission-function.js
-- setMissionFunction (a partner of the firm, or the mission's manager; never one's own), with who and when.
-- Reviews and the work programme read mission_function, never the label. Without this file: grades only, as before.
alter table public.office_mission_assignments add column if not exists mission_function text
  check (mission_function is null or mission_function in ('partner', 'manager', 'supervisor', 'senior', 'auditor', 'quality_reviewer', 'specialist', 'secretary', 'finance'));
alter table public.office_mission_assignments add column if not exists mission_function_set_by text
  check (mission_function_set_by is null or length(mission_function_set_by) <= 200);
alter table public.office_mission_assignments add column if not exists mission_function_set_at timestamptz;

-- ===== firm-workflow.sql =====
-- WORKFLOW DU CABINET (Paul, 2026-10-19, point 1 : « le workflow décrit le fonctionnement de tout le cabinet, de la réception
-- d'un TDR à la clôture ; il doit être consultable, modifiable et versionné »). Un workflow par type de mission (et un
-- workflow commun « default » pour les types qui n'en ont pas). Une ligne par version : brouillon modifiable, puis
-- confirmée par un associé (figée) ; une modification après confirmation crée une nouvelle version, l'ancienne passe
-- « superseded ». Sources : le document « Workflow du cabinet » lu par l'IA (proposition, avec l'extrait d'où vient chaque
-- étape) et l'écran. Sans workflow confirmé, l'application suit le parcours intégré (lib/firm-workflow.js DEFAULT_STEPS).
-- ADDITIF SEULEMENT. Relançable : rien n'est remplacé.
create table if not exists public.office_firm_workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  mission_type text not null check (length(mission_type) between 1 and 40),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'superseded')),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  source jsonb not null default '{}'::jsonb,
  created_by text,
  updated_by text,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, mission_type, version)
);
create index if not exists office_firm_workflows_type on public.office_firm_workflows (org_id, mission_type, version desc);
alter table public.office_firm_workflows enable row level security;
revoke all on public.office_firm_workflows from public, anon, authenticated;
grant select, insert, update on public.office_firm_workflows to service_role;

-- Où en est chaque mission dans son workflow : version suivie, étape en cours, historique des décisions (qui, quand,
-- quelle suite, pourquoi). Petite mémoire : des identifiants et des décisions, jamais le contenu des documents.
alter table public.office_missions add column if not exists workflow jsonb not null default '{}'::jsonb;

-- ===== pbc-requests.sql =====
-- PIÈCES DEMANDÉES D'UNE MISSION — LA BOUCLE COMPLÈTE (Paul, 2026-10-19, point 7 : « besoin identifié → recherche des pièces
-- existantes → demande des seuls manquants → mail au bon responsable → validation et envoi → réponse reçue → contenu contrôlé
-- → pièce renommée et classée → working file mis à jour → résultat vérifié »). Une ligne par pièce attendue d'une mission,
-- qui garde le lien durable : la demande (message validé, sa conversation Gmail), les réponses (avec ou sans pièce), les pièces
-- reçues (id Drive, version), le contrôle (proposé par le code et l'IA, confirmé par une personne), les compléments demandés,
-- le classement et le working file. Petite mémoire : identifiants, statuts, raisons — jamais le contenu des pièces.
-- Rien n'est créé deux fois (clé d'idempotence par mission et par pièce). ADDITIF SEULEMENT. Relançable.
create table if not exists public.office_pbc_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  office_mission_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 3 and 300),
  ref text check (ref is null or length(ref) <= 40),
  document text not null check (length(document) between 1 and 300),
  purpose text check (purpose is null or length(purpose) <= 600),
  cycle_code text check (cycle_code is null or length(cycle_code) <= 40),
  procedure_codes jsonb not null default '[]'::jsonb,
  period_start date,
  period_end date,
  period_label text check (period_label is null or length(period_label) <= 80),
  status text not null default 'needed' check (status in ('needed', 'request_pending', 'requested', 'reply_received', 'reply_without_piece',
    'to_confirm', 'complement_pending', 'complement_requested', 'accepted', 'not_applicable')),
  request jsonb not null default '{}'::jsonb,
  responses jsonb not null default '[]'::jsonb check (jsonb_typeof(responses) = 'array'),
  pieces jsonb not null default '[]'::jsonb check (jsonb_typeof(pieces) = 'array'),
  control jsonb not null default '{}'::jsonb,
  complements jsonb not null default '[]'::jsonb check (jsonb_typeof(complements) = 'array'),
  filed jsonb not null default '{}'::jsonb,
  workpaper jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);
create index if not exists office_pbc_requests_mission on public.office_pbc_requests (org_id, office_mission_id, status);
alter table public.office_pbc_requests enable row level security;
revoke all on public.office_pbc_requests from public, anon, authenticated;
grant select, insert, update on public.office_pbc_requests to service_role;

-- ===== purge.sql =====
-- ERASING A FIRM'S SPACE (Paul, 2026-10-11: « quand je ferme mon compte, je veux que toutes les données du
-- cabinet partent ; quand je recrée un compte, je remplis ce qu'il y a à remplir »).
-- The application's backend may NOT delete rows (most tables are insert / update only, the audit tables
-- append-only). This ONE function, owned by the database owner, is the only way to erase a firm's data:
--   - every table of the public schema whose name starts with office_, orpailleur_ or taty_ and that has an
--     org_id column: its rows for this firm are deleted (foreign keys: several passes, children first);
--   - office_organizations (the firm's identity, referenced by memberships and permissions) is kept;
--   - the firm's documents in its Drive are never touched here (they belong to the firm).
-- Safety: callable by the backend only (service_role), never by a browser; it refuses unless p_confirm is
-- exactly 'EFFACER ' || the firm's id; p_dry_run = true only counts what would be erased.
-- Safe to re-run (create or replace).
begin;
create or replace function public.office_purge_firm(p_org uuid, p_confirm text, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  n bigint;
  counts jsonb := '{}'::jsonb;
  pending text[] := '{}';
  next_pending text[];
  pass int := 0;
begin
  if p_org is null or p_confirm is distinct from ('EFFACER ' || p_org::text) then
    raise exception 'PURGE_CONFIRMATION_REQUIRED' using errcode = '22023';
  end if;
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'org_id'
       and (c.table_name like 'office\_%' or c.table_name like 'orpailleur\_%' or c.table_name like 'taty\_%')
       and c.table_name <> 'office_organizations'
     order by c.table_name
  loop
    execute format('select count(*) from public.%I where org_id::text = $1', t.table_name) into n using p_org::text;
    counts := counts || jsonb_build_object(t.table_name, n);
    if n > 0 then pending := pending || t.table_name::text; end if;
  end loop;
  if p_dry_run then
    return jsonb_build_object('dry_run', true, 'rows', counts, 'tables', coalesce(array_length(pending, 1), 0));
  end if;
  -- Children before parents: a table refused because others still point to it is retried in a later pass.
  while coalesce(array_length(pending, 1), 0) > 0 and pass < 12 loop
    pass := pass + 1;
    next_pending := '{}';
    for i in 1 .. array_length(pending, 1) loop
      begin
        execute format('delete from public.%I where org_id::text = $1', pending[i]) using p_org::text;
      exception when foreign_key_violation then
        next_pending := next_pending || pending[i];
      end;
    end loop;
    exit when next_pending = pending;
    pending := next_pending;
  end loop;
  return jsonb_build_object('dry_run', false, 'rows', counts, 'passes', pass, 'not_erased', to_jsonb(pending));
end;
$$;
revoke all on function public.office_purge_firm(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.office_purge_firm(uuid, text, boolean) to service_role;
commit;
