-- "Connecter Google" (2026-10-07): the firm's Google account connected by the owner from
-- Paramètres. The refresh token is stored ENCRYPTED (AES-256-GCM, key held by the server only).
-- One row per firm; disconnecting revokes the token at Google and blanks it here. Additive only.
begin;
create table if not exists public.office_google_connections (
  org_id uuid primary key,
  google_email text not null check (length(google_email) between 3 and 254),
  refresh_token_enc text not null check (length(refresh_token_enc) between 5 and 4000),
  scopes text[] not null default '{}',
  connected_by text check (connected_by is null or length(connected_by) <= 120),
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500)
);
alter table public.office_google_connections enable row level security;
revoke all on public.office_google_connections from public, anon, authenticated;
commit;

-- "Drive du cabinet": the shared drive chosen by the owner in Paramètres (pasted link).
begin;
create table if not exists public.office_firm_drive (
  org_id uuid primary key,
  drive_id text not null check (length(drive_id) between 10 and 100),
  drive_name text check (drive_name is null or length(drive_name) <= 200),
  set_by text check (set_by is null or length(set_by) <= 120),
  set_at timestamptz not null default now()
);
alter table public.office_firm_drive enable row level security;
revoke all on public.office_firm_drive from public, anon, authenticated;
commit;
