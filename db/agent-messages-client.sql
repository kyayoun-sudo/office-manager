-- Client e-mails drafted by the agent (rule of 2026-10-07, Paul): the agent PROPOSES a draft,
-- a manager / partner / owner reviews (can edit) and validates it in "À valider"; only then is
-- it sent, and only to the client contact registered on the mission. Additive only.
begin;
alter table public.office_agent_messages add column if not exists audience text not null default 'colleagues';
alter table public.office_agent_messages add column if not exists office_mission_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'office_agent_messages_audience_check') then
    alter table public.office_agent_messages add constraint office_agent_messages_audience_check
      check (audience in ('colleagues', 'client'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'office_agent_messages_client_mission_check') then
    alter table public.office_agent_messages add constraint office_agent_messages_client_mission_check
      check (audience <> 'client' or office_mission_id is not null);
  end if;
end $$;
-- The client contact(s) of a mission: the only addresses a client e-mail can go to.
do $$ begin
  if to_regclass('public.office_missions') is not null then
    alter table public.office_missions add column if not exists client_contact_emails text[];
  end if;
end $$;
commit;
