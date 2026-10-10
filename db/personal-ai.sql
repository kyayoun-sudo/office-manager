-- « Mon IA » (2026-10-10): each person may connect their own AI key (Claude, ChatGPT, Gemini), kept
-- ENCRYPTED (AES-GCM, sealed by the server; never readable by the browser), after accepting a
-- versioned warning (who, when, which version). Plus the firm's settings (personal AI allowed or not).
-- Additive only.
begin;
create table if not exists public.office_user_ai_keys (
  org_id uuid not null,
  auth_user_id uuid not null,
  email text,
  provider text not null check (provider in ('anthropic', 'openai', 'gemini')),
  key_enc text,
  key_hint text check (key_hint is null or length(key_hint) <= 10),
  model text check (model is null or length(model) <= 80),
  active boolean not null default true,
  notice_version text not null,
  notice_accepted_at timestamptz not null,
  notice_accepted_by text,
  last_used_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, auth_user_id, provider)
);
alter table public.office_user_ai_keys enable row level security;
revoke all on public.office_user_ai_keys from public, anon, authenticated, service_role;
grant select, insert, update on public.office_user_ai_keys to service_role;

create table if not exists public.office_firm_settings (
  org_id uuid primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.office_firm_settings enable row level security;
revoke all on public.office_firm_settings from public, anon, authenticated, service_role;
grant select, insert, update on public.office_firm_settings to service_role;
commit;
