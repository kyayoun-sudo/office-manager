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
