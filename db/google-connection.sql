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
