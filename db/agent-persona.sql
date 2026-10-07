-- Agent mail identity and internal tone, set only by the owner / managing partners.
-- Additive only: one new table. No existing table, function or policy is changed.
begin;
create table if not exists public.office_agent_persona (
  org_id uuid primary key,
  agent_display_name text not null default 'Office Manager'
    check (length(btrim(agent_display_name)) between 1 and 80),
  sender_email text check (sender_email is null or (length(sender_email) <= 254 and sender_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  reply_to text check (reply_to is null or (length(reply_to) <= 254 and reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 10),
  internal_domains text[] not null default '{}' check (cardinality(internal_domains) between 0 and 10),
  -- Tone with colleagues only. Clients always receive a formal tone (enforced in code).
  internal_tone text not null default 'nouchi_fun' check (internal_tone in ('nouchi_fun', 'relaxed_fun', 'professional')),
  humor_level smallint not null default 2 check (humor_level between 0 and 3),
  internal_frequency text not null default 'few_per_week' check (internal_frequency in ('off', 'weekly', 'few_per_week', 'daily')),
  signature text check (signature is null or length(signature) <= 500),
  updated_by text check (updated_by is null or length(updated_by) <= 120),
  updated_at timestamptz not null default now()
);
alter table public.office_agent_persona enable row level security;
revoke all on public.office_agent_persona from public, anon, authenticated, service_role;
grant select, insert, update on public.office_agent_persona to service_role;
commit;
