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
