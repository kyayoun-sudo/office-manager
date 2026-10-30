-- AI calls per firm and per day (2026-10-30, several firms on one installation share the AI keys).
-- Counted for every request answered by the firm's shared AI pool (not « Mon IA », which uses the person's own key).
-- The daily limit is set by the INSTALLATION (Vercel: OFFICE_MANAGER_AI_DAILY_LIMIT), never by a firm: without it,
-- nothing is ever refused. Safe to re-run. Erased with the firm's other data (office_purge_firm: every office_* table).
create table if not exists public.office_ai_usage (
  org_id uuid not null,
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, day)
);
alter table public.office_ai_usage enable row level security;
revoke all on public.office_ai_usage from public, anon, authenticated, service_role;
grant select, insert, update on public.office_ai_usage to service_role;

-- One atomic +1 (two server instances at the same time never lose a count); returns the new count of the day.
create or replace function public.office_ai_usage_increment(p_org_id uuid, p_day date)
returns integer language sql security invoker set search_path = public, pg_temp as $$
  insert into public.office_ai_usage(org_id, day, calls) values (p_org_id, p_day, 1)
  on conflict (org_id, day) do update set calls = public.office_ai_usage.calls + 1, updated_at = now()
  returning calls;
$$;
revoke all on function public.office_ai_usage_increment(uuid, date) from public, anon, authenticated;
grant execute on function public.office_ai_usage_increment(uuid, date) to service_role;
