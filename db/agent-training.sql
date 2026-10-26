-- ENTRAÎNER LES AGENTS AVEC DE VRAIES PERSONNES (Paul, 2026-10-26 : « je veux donner à un auditeur, qui n'a pas accès à toute
-- l'application ; il crée sa mission, met son Drive, travaille et corrige ; il fait et refait »).
-- Chaque correction faite par un auditeur, dans N'IMPORTE QUEL cabinet de l'installation (son cabinet d'entraînement compris), arrive ici :
-- ce que l'agent avait proposé, ce que la personne a dit, à quelle étape. Le propriétaire de la plateforme (cabinet pilote) la VALIDE ou la
-- REFUSE ; une correction validée est donnée à l'IA dans TOUS les cabinets. Aucun document du client : des familles de pièces, des en-têtes
-- de colonnes, la phrase de la personne.
-- Relançable sans danger. Serveur seulement (service_role) : RLS activée, aucune politique.
begin;

create table if not exists public.office_agent_feedback (
  id uuid primary key default gen_random_uuid(),
  source_org_id uuid not null,
  mission_id uuid,
  agent text not null,
  step text not null,
  kind text not null,
  model_key text,
  sheet text,
  proposed text,
  correction text,
  subject jsonb not null default '{}'::jsonb,
  by_email text,
  created_at timestamptz not null default now(),
  status text not null default 'proposed' check (status in ('proposed', 'validated', 'rejected')),
  decided_by text,
  decided_at timestamptz,
  decision_note text
);
create index if not exists office_agent_feedback_status_idx on public.office_agent_feedback (status, kind, created_at desc);
create index if not exists office_agent_feedback_model_idx on public.office_agent_feedback (model_key, sheet) where status = 'validated';
alter table public.office_agent_feedback enable row level security;
revoke all on public.office_agent_feedback from public, anon, authenticated;
grant select, insert, update on public.office_agent_feedback to service_role;

commit;
