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
