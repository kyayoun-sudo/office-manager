-- « Chacun sa boîte e-mail » (Paul, 2026-11-16 : « le client dit chacun doit avoir ses mails pour pouvoir répondre et tout ;
-- d'autres collaborateurs disent qu'ils ne voient pas leurs mails »). Each person may link THEIR OWN Google mailbox:
-- read (recent messages, to find those needing an action) and send (their own replies, from their own address).
--   office_user_mailboxes  : the link, refresh token ENCRYPTED by the server (AES-GCM), never sent to a browser.
--   office_user_mail_items : what the AI understood of each recent message (summary, mission, action) — never the body.
-- Only the person sees their mailbox and its items (filtered by the server on the signed-in account; RLS without policy,
-- service_role only). Unlinking deletes the token and the items. Additive only, replayable.
begin;
create table if not exists public.office_user_mailboxes (
  org_id uuid not null,
  user_email text not null,
  google_email text not null,
  refresh_token_enc text,
  scopes text[] not null default '{}',
  connected_at timestamptz,
  revoked_at timestamptz,
  last_triage_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_email)
);
alter table public.office_user_mailboxes enable row level security;
revoke all on public.office_user_mailboxes from public, anon, authenticated, service_role;
grant select, insert, update on public.office_user_mailboxes to service_role;

create table if not exists public.office_user_mail_items (
  org_id uuid not null,
  user_email text not null,
  id text not null,
  thread_id text,
  from_text text,
  from_email text,
  subject text,
  received_at timestamptz,
  snippet text,
  needs_action boolean not null default false,
  importance text check (importance is null or importance in ('haute', 'moyenne', 'basse')),
  category text,
  summary text,
  mission_id uuid,
  suggested_action text,
  deadline date,
  triaged_at timestamptz not null default now(),
  done jsonb,
  primary key (org_id, user_email, id)
);
create index if not exists office_user_mail_items_open on public.office_user_mail_items (org_id, user_email, received_at desc);
alter table public.office_user_mail_items enable row level security;
revoke all on public.office_user_mail_items from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.office_user_mail_items to service_role;
commit;
