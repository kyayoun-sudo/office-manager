-- Additive, service-only collaboration metadata. No message bodies or activity history.
create table if not exists public.office_presence (
 org_id uuid not null, email text not null, last_seen_at timestamptz not null,
 primary key(org_id,email)
);
create index if not exists office_presence_recent on public.office_presence(org_id,last_seen_at);
create table if not exists public.office_chat_reads (
 org_id uuid not null, email text not null, message_id uuid not null references public.office_chat_messages(id) on delete cascade,
 primary key(org_id,email,message_id)
);
alter table public.office_presence enable row level security;
alter table public.office_chat_reads enable row level security;
revoke all on public.office_presence,public.office_chat_reads from public,anon,authenticated,service_role;
grant select,insert,update on public.office_presence to service_role;
grant select,insert on public.office_chat_reads to service_role;
