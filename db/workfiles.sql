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
