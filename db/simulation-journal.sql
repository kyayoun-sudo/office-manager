-- Simulation : journal des consignes, réponses des agents et corrections (2026-11-21, étape 3). Additif.
create table if not exists public.office_simulation_journal (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.office_organizations(id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text check (actor_email is null or length(actor_email) <= 254),
  agent text not null check (length(agent) between 1 and 60),
  mission_id uuid,
  kind text not null check (kind in ('consigne', 'reponse', 'correction')),
  body text not null check (length(body) between 1 and 4000),
  ref text check (ref is null or length(ref) <= 120)
);
create index if not exists office_simulation_journal_org on public.office_simulation_journal (org_id, at desc);
alter table public.office_simulation_journal enable row level security;
