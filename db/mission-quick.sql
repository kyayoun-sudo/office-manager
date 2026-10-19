-- Direct mission creation (Paul, 2026-10-19): « créer une mission et y aller directement, remplir le reste après ».
-- ADDITIVE ONLY. A mission may come from a tender (Opportunités) OR directly (client direct, client existant,
-- mission récurrente, recommandation, nomination…). The source of the mission is NOT its acceptance:
-- acceptance / KYC, independence and the engagement letter stay followed as open items (followups), never faked.
-- The application works without this file: the mission is then created without these columns.
alter table public.office_missions add column if not exists origin text check (origin is null or length(origin) <= 40);
alter table public.office_missions add column if not exists engagement_type text check (engagement_type is null or length(engagement_type) <= 80);
alter table public.office_missions add column if not exists period_label text check (period_label is null or length(period_label) <= 80);
alter table public.office_missions add column if not exists created_by text check (created_by is null or length(created_by) <= 200);
alter table public.office_missions add column if not exists followups jsonb not null default '{}'::jsonb;
