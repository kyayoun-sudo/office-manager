-- Personal mailbox connections: never reuse the firm's Google Drive credentials.
-- Migration additive; run on the firm's PostgreSQL before enabling personal mail.
begin;
create table if not exists public.office_email_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  provider text not null check (provider in ('google','microsoft')),
  email text not null check (length(email) between 3 and 254),
  refresh_token_enc text not null,
  scopes text[] not null default '{}',
  ai_enabled boolean not null default false,
  status text not null default 'connected' check (status in ('connected','reconnect_required','revoked')),
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  unique (org_id,user_id,provider,email),
  unique (org_id,user_id,id),
  foreign key (org_id,user_id) references public.office_app_users(org_id,auth_user_id) on delete cascade
);
create index if not exists office_email_accounts_owner_idx on public.office_email_accounts(org_id,user_id);
create table if not exists public.office_personal_mail_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  mailbox_id uuid not null,
  foreign key (org_id,user_id,mailbox_id) references public.office_email_accounts(org_id,user_id,id) on delete cascade,
  provider_message_id text not null,
  thread_id text,
  folder text not null check (folder in ('inbox','sent')),
  sender text,
  sender_email text,
  recipient text,
  subject text,
  snippet text,
  received_at timestamptz,
  unread boolean not null default false,
  has_attachments boolean not null default false,
  needs_action boolean,
  importance text,
  category text,
  summary text,
  suggested_action text,
  deadline date,
  ai_error text,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id,user_id,mailbox_id,provider_message_id)
);
create index if not exists office_personal_mail_inbox_idx on public.office_personal_mail_items(org_id,user_id,mailbox_id,folder,received_at desc);
create table if not exists public.office_personal_mail_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  mailbox_id uuid not null,
  foreign key (org_id,user_id,mailbox_id) references public.office_email_accounts(org_id,user_id,id) on delete cascade,
  reply_to_provider_id text,
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  provider_result_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (id,org_id,user_id,mailbox_id)
);
create index if not exists office_personal_mail_drafts_owner_idx on public.office_personal_mail_drafts(org_id,user_id,mailbox_id,status);
-- Server-side only, never expose these tables via client-side REST.
alter table public.office_email_accounts enable row level security;
alter table public.office_personal_mail_items enable row level security;
alter table public.office_personal_mail_drafts enable row level security;
revoke all on public.office_email_accounts from public,anon,authenticated;
revoke all on public.office_personal_mail_items from public,anon,authenticated;
revoke all on public.office_personal_mail_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.office_email_accounts to service_role;
grant select,insert,update,delete on public.office_personal_mail_items to service_role;
grant select,insert,update,delete on public.office_personal_mail_drafts to service_role;
commit;
