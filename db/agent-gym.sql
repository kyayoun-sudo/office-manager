-- ENTRAÎNEMENT DES AGENTS (Paul, 2026-10-26 : « je veux juste permettre d'entraîner les agents afin qu'on puisse comprendre » ; « la
-- personne y mettra de vraies missions, fera et expliquera à l'agent » ; « elle n'a pas besoin de l'application »).
-- Un outil à part, ouvert par un lien personnel (jeton) : l'entraîneur dépose une vraie mission, l'agent fait chaque étape du métier,
-- l'entraîneur dit « juste » ou explique ce qui ne va pas ; l'explication devient une LEÇON de cette étape, redonnée à l'agent (« refaire »).
-- Les leçons validées par le propriétaire / un associé du cabinet passent dans les vrais agents de l'application.
-- Relançable sans danger. Serveur seulement (service_role) : RLS activée, aucune politique.
begin;

create table if not exists public.office_gym_trainers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  email text,
  token_hash text not null unique,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.office_gym_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trainer_id uuid not null references public.office_gym_trainers(id) on delete cascade,
  title text not null,
  folder_id text,
  period_label text,
  files jsonb not null default '[]'::jsonb,
  steps jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_gym_sessions_trainer_idx on public.office_gym_sessions (trainer_id, created_at desc);

create table if not exists public.office_gym_lessons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  step text not null,
  sheet text,
  model_key text,
  lesson text not null,
  proposed text,
  correct text,
  context jsonb not null default '{}'::jsonb,
  session_id uuid,
  trainer_id uuid,
  trainer_name text,
  status text not null default 'proposed' check (status in ('proposed', 'validated', 'rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists office_gym_lessons_step_idx on public.office_gym_lessons (step, status, created_at desc);

alter table public.office_gym_trainers enable row level security;
alter table public.office_gym_sessions enable row level security;
alter table public.office_gym_lessons enable row level security;
revoke all on public.office_gym_trainers, public.office_gym_sessions, public.office_gym_lessons from public, anon, authenticated;
grant select, insert, update on public.office_gym_trainers, public.office_gym_sessions, public.office_gym_lessons to service_role;

commit;
