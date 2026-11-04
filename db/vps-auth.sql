-- COMPTES DES PERSONNES SUR LE SERVEUR DU CABINET (VPS), SANS SUPABASE — après db/vps-compat.sql. Sans danger si on le relance.
-- auth.users garde les MÊMES noms de colonnes que Supabase : les comptes existants y sont repris tels quels
-- (identifiant, e-mail, mot de passe chiffré bcrypt, confirmation), et chacun garde son mot de passe (2026-11-04, choix de Paul).
-- Aucun mot de passe en clair, aucun jeton en clair : seulement leur empreinte (sha-256) pour les sessions.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  banned_until timestamptz
);
create unique index if not exists auth_users_email_key on auth.users (lower(email));

-- One row per open session: the access token (1 h) and the refresh token (30 days, kept until it expires or the session ends).
create table if not exists auth.om_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_hash text not null unique,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists auth_om_sessions_user on auth.om_sessions (user_id);

-- Single-use links: confirmation of an address (e-mail) and the server-side sign-in after Google (magic link).
create table if not exists auth.om_links (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('signup', 'magiclink')),
  -- Sign-up: the password chosen is kept WITH its link, and becomes the account's password only when the owner of the address
  -- opens that link (nobody can register an address and keep a password on it before its owner confirms).
  password_hash text,
  user_meta jsonb,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table auth.om_links add column if not exists password_hash text;
alter table auth.om_links add column if not exists user_meta jsonb;

revoke all on all tables in schema auth from public, anon, authenticated;
grant usage on schema auth to service_role;
grant select, insert, update, delete on auth.users, auth.om_sessions, auth.om_links to service_role;
