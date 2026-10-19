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
