-- Messages of the agent to COLLEAGUES (never to clients), validated before sending.
-- Additive only: one new table. Journal: no DELETE.
begin;
create table if not exists public.office_agent_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  recipients text[] not null check (cardinality(recipients) between 1 and 30),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 10000),
  tone text check (tone is null or length(tone) <= 40),
  source text not null default 'person' check (source in ('person', 'agent')),
  topic text check (topic is null or length(topic) <= 2000),
  status text not null default 'pending_approval' check (status in ('pending_approval', 'sending', 'sent', 'failed', 'rejected')),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  requested_by text check (requested_by is null or length(requested_by) <= 120),
  decided_by text check (decided_by is null or length(decided_by) <= 120),
  decided_at timestamptz,
  decision_comment text check (decision_comment is null or length(decision_comment) <= 1000),
  sent_at timestamptz,
  provider_message_id text check (provider_message_id is null or length(provider_message_id) <= 200),
  error text check (error is null or length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A message can only be marked sent once a person has decided it.
  check (status not in ('sending', 'sent') or (decided_by is not null and decided_at is not null))
);
create index if not exists office_agent_messages_org_idx on public.office_agent_messages (org_id, status, created_at desc);
alter table public.office_agent_messages enable row level security;
revoke all on public.office_agent_messages from public, anon, authenticated, service_role;
grant select, insert, update on public.office_agent_messages to service_role;
commit;
