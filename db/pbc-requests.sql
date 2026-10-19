-- PIÈCES DEMANDÉES D'UNE MISSION — LA BOUCLE COMPLÈTE (Paul, 2026-10-19, point 7 : « besoin identifié → recherche des pièces
-- existantes → demande des seuls manquants → mail au bon responsable → validation et envoi → réponse reçue → contenu contrôlé
-- → pièce renommée et classée → working file mis à jour → résultat vérifié »). Une ligne par pièce attendue d'une mission,
-- qui garde le lien durable : la demande (message validé, sa conversation Gmail), les réponses (avec ou sans pièce), les pièces
-- reçues (id Drive, version), le contrôle (proposé par le code et l'IA, confirmé par une personne), les compléments demandés,
-- le classement et le working file. Petite mémoire : identifiants, statuts, raisons — jamais le contenu des pièces.
-- Rien n'est créé deux fois (clé d'idempotence par mission et par pièce). ADDITIF SEULEMENT. Relançable.
create table if not exists public.office_pbc_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  office_mission_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 3 and 300),
  ref text check (ref is null or length(ref) <= 40),
  document text not null check (length(document) between 1 and 300),
  purpose text check (purpose is null or length(purpose) <= 600),
  cycle_code text check (cycle_code is null or length(cycle_code) <= 40),
  procedure_codes jsonb not null default '[]'::jsonb,
  period_start date,
  period_end date,
  period_label text check (period_label is null or length(period_label) <= 80),
  status text not null default 'needed' check (status in ('needed', 'request_pending', 'requested', 'reply_received', 'reply_without_piece',
    'to_confirm', 'complement_pending', 'complement_requested', 'accepted', 'not_applicable')),
  request jsonb not null default '{}'::jsonb,
  responses jsonb not null default '[]'::jsonb check (jsonb_typeof(responses) = 'array'),
  pieces jsonb not null default '[]'::jsonb check (jsonb_typeof(pieces) = 'array'),
  control jsonb not null default '{}'::jsonb,
  complements jsonb not null default '[]'::jsonb check (jsonb_typeof(complements) = 'array'),
  filed jsonb not null default '{}'::jsonb,
  workpaper jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);
create index if not exists office_pbc_requests_mission on public.office_pbc_requests (org_id, office_mission_id, status);
alter table public.office_pbc_requests enable row level security;
revoke all on public.office_pbc_requests from public, anon, authenticated;
grant select, insert, update on public.office_pbc_requests to service_role;
