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
