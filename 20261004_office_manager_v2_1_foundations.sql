-- Office Manager AI V2.1 foundations
-- Additive migration. No destructive table/data changes.

alter table public.office_staff_profiles
  add column if not exists phone text,
  add column if not exists grade_title text,
  add column if not exists permission_tags text[] not null default '{}'::text[],
  add column if not exists email_signature text,
  add column if not exists can_receive_internal_reminders boolean not null default true;

create table if not exists public.office_archives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  office_mission_id uuid,
  archive_code text,
  title text not null,
  archive_provider text not null default 'drive',
  source_drive_id text,
  source_folder_id text,
  archive_location text,
  status text not null default 'proposed'
    check (status in ('proposed','archiving','archived','restoring','active','review','failed')),
  retention_until date,
  archived_at timestamptz,
  restored_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (org_id, office_mission_id)
    references public.office_missions(org_id, id)
);

create index if not exists office_archives_org_status_idx
  on public.office_archives(org_id, status);
create index if not exists office_archives_mission_idx
  on public.office_archives(org_id, office_mission_id);

alter table public.office_archives enable row level security;

drop policy if exists office_confidential_read on public.office_archives;
create policy office_confidential_read on public.office_archives
  for select to authenticated
  using (private.office_role(org_id) = any (
    array['owner'::text,'admin'::text,'partner'::text,'manager'::text]
  ));

drop policy if exists office_write on public.office_archives;
create policy office_write on public.office_archives
  for insert to authenticated
  with check (private.office_role(org_id) = any (
    array['owner'::text,'admin'::text,'manager'::text]
  ));

drop policy if exists office_edit on public.office_archives;
create policy office_edit on public.office_archives
  for update to authenticated
  using (private.office_role(org_id) = any (
    array['owner'::text,'admin'::text,'manager'::text]
  ))
  with check (private.office_role(org_id) = any (
    array['owner'::text,'admin'::text,'manager'::text]
  ));

create table if not exists public.office_mission_controls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  office_mission_id uuid not null,
  control_code text not null,
  control_area text not null,
  title text not null,
  standard_reference text,
  sop_id uuid,
  sop_step_id uuid,
  work_program_reference text,
  expected_evidence text,
  accountable_staff_profile_id uuid,
  due_at timestamptz,
  status text not null default 'pending'
    check (status in ('expected','pending','partial','complete','review','blocked','not_applicable','verified')),
  evidence jsonb not null default '[]'::jsonb,
  rationale text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, office_mission_id, control_code),
  foreign key (org_id, office_mission_id)
    references public.office_missions(org_id, id) on delete cascade,
  foreign key (sop_id, org_id)
    references public.office_sops(id, org_id),
  foreign key (sop_step_id, org_id)
    references public.office_sop_steps(id, org_id),
  foreign key (org_id, accountable_staff_profile_id)
    references public.office_staff_profiles(org_id, id)
);

create index if not exists office_mission_controls_status_idx
  on public.office_mission_controls(org_id, office_mission_id, status);
create index if not exists office_mission_controls_due_idx
  on public.office_mission_controls(org_id, due_at)
  where due_at is not null;

alter table public.office_mission_controls enable row level security;

drop policy if exists office_confidential_read on public.office_mission_controls;
create policy office_confidential_read on public.office_mission_controls
  for select to authenticated
  using (private.office_role(org_id) = any (
    array['owner'::text,'admin'::text,'partner'::text,'manager'::text]
  ));

drop policy if exists office_write on public.office_mission_controls;
create policy office_write on public.office_mission_controls
  for insert to authenticated
  with check (private.office_role(org_id) = any (
    array['owner'::text,'admin'::text,'manager'::text]
  ));

drop policy if exists office_edit on public.office_mission_controls;
create policy office_edit on public.office_mission_controls
  for update to authenticated
  using (private.office_role(org_id) = any (
    array['owner'::text,'admin'::text,'manager'::text]
  ))
  with check (private.office_role(org_id) = any (
    array['owner'::text,'admin'::text,'manager'::text]
  ));

create table if not exists public.office_agent_tool_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  run_id uuid not null references public.office_agent_runs(id) on delete cascade,
  parent_agent_key text not null,
  specialist_key text,
  tool_name text not null,
  phase text not null default 'completed'
    check (phase in ('started','completed','failed')),
  input_summary text,
  output_summary text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists office_agent_tool_events_run_idx
  on public.office_agent_tool_events(org_id, run_id, started_at);

alter table public.office_agent_tool_events enable row level security;

drop policy if exists office_confidential_read on public.office_agent_tool_events;
create policy office_confidential_read on public.office_agent_tool_events
  for select to authenticated
  using (private.office_role(org_id) = any (
    array['owner'::text,'admin'::text,'partner'::text,'manager'::text]
  ));

alter table public.orpailleur_inventory
  add column if not exists client_name text,
  add column if not exists office_mission_id uuid,
  add column if not exists document_type text,
  add column if not exists document_period text,
  add column if not exists document_version text,
  add column if not exists source_channel text not null default 'drive',
  add column if not exists source_message_id text,
  add column if not exists source_thread_id text,
  add column if not exists previous_folder_path text,
  add column if not exists filing_reason text,
  add column if not exists confidence numeric,
  add column if not exists archive_id uuid,
  add column if not exists archived_at timestamptz;

alter table public.orpailleur_inventory
  drop constraint if exists orpailleur_inventory_confidence_check;
alter table public.orpailleur_inventory
  add constraint orpailleur_inventory_confidence_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));

alter table public.orpailleur_inventory
  drop constraint if exists orpailleur_inventory_mission_fkey;
alter table public.orpailleur_inventory
  add constraint orpailleur_inventory_mission_fkey
  foreign key (org_id, office_mission_id)
  references public.office_missions(org_id, id);

alter table public.orpailleur_inventory
  drop constraint if exists orpailleur_inventory_archive_fkey;
alter table public.orpailleur_inventory
  add constraint orpailleur_inventory_archive_fkey
  foreign key (archive_id, org_id)
  references public.office_archives(id, org_id);

create index if not exists orpailleur_inventory_mission_idx
  on public.orpailleur_inventory(org_id, office_mission_id);
create index if not exists orpailleur_inventory_document_lookup_idx
  on public.orpailleur_inventory(org_id, document_type, document_period);
create index if not exists orpailleur_inventory_archive_idx
  on public.orpailleur_inventory(org_id, archive_id)
  where archive_id is not null;

alter table public.office_action_queue
  add column if not exists assigned_staff_profile_id uuid,
  add column if not exists due_at timestamptz,
  add column if not exists requested_at timestamptz,
  add column if not exists executed_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists work_state text,
  add column if not exists reminder_channel text,
  add column if not exists provider_message_id text,
  add column if not exists provider_thread_id text,
  add column if not exists verification_evidence jsonb not null default '{}'::jsonb;

alter table public.office_action_queue
  drop constraint if exists office_action_queue_work_state_check;
alter table public.office_action_queue
  add constraint office_action_queue_work_state_check
  check (
    work_state is null or
    work_state in ('requested','executed','verified','blocked','cancelled')
  );

alter table public.office_action_queue
  drop constraint if exists office_action_queue_assigned_staff_fkey;
alter table public.office_action_queue
  add constraint office_action_queue_assigned_staff_fkey
  foreign key (org_id, assigned_staff_profile_id)
  references public.office_staff_profiles(org_id, id);

create index if not exists office_action_queue_assignee_due_idx
  on public.office_action_queue(org_id, assigned_staff_profile_id, due_at)
  where assigned_staff_profile_id is not null;
create index if not exists office_action_queue_work_state_idx
  on public.office_action_queue(org_id, work_state, due_at);
