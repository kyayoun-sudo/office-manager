-- Additive: existing client/agent memories remain in place; local files are projections.
alter table public.office_missions add column if not exists local_memory_folder_id text;
alter table public.office_missions add column if not exists local_memory_file_id text;
create table if not exists public.office_mission_change_log (
  seq bigint generated always as identity primary key,
  org_id uuid not null,
  mission_id uuid not null,
  at timestamptz not null default clock_timestamp(),
  source_table text not null,
  record_id text,
  operation text not null,
  actor text not null,
  actor_kind text not null,
  initiated_by text,
  changed_keys text[] not null default '{}',
  changes jsonb not null default '{}',
  before_hash text,
  after_hash text,
  source_ref text
);
create index if not exists office_mission_change_log_scope on public.office_mission_change_log(org_id,mission_id,seq);
alter table public.office_mission_change_log enable row level security;
revoke all on public.office_mission_change_log from public,anon,authenticated,service_role;
grant select,insert on public.office_mission_change_log to service_role;
grant usage,select on sequence public.office_mission_change_log_seq_seq to service_role;

create or replace function public.office_capture_mission_change() returns trigger
language plpgsql security invoker set search_path = public,pg_temp as $$
declare b jsonb; a jsonb; v jsonb; mid uuid; oid uuid; who text; keys text[]; diff jsonb; headers jsonb; kind text; initiator text;
begin
  b := case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  a := case when TG_OP='DELETE' then '{}'::jsonb else to_jsonb(NEW) end;
  if a=b then return null; end if;
  v := case when TG_OP='DELETE' then b else a end;
  oid := nullif(v->>'org_id','')::uuid;
  if coalesce(case when TG_TABLE_NAME='office_missions' then v->>'id' else coalesce(v->>'office_mission_id',v->>'mission_id',v->>'engagement_id') end,'') !~* '^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$' then return null; end if;
  mid := (case when TG_TABLE_NAME='office_missions' then v->>'id' else coalesce(v->>'office_mission_id',v->>'mission_id',v->>'engagement_id') end)::uuid;
  if mid is null or oid is null then return null; end if;
  -- Ignore foreign/unbound references; a log must never mix two firms' missions.
  if TG_TABLE_NAME<>'office_missions' and not exists(select 1 from public.office_missions where id=mid and org_id=oid) then return null; end if;
  -- Serializes assignment of seq for this mission until commit, so incremental exports cannot skip a late commit.
  perform pg_advisory_xact_lock(hashtextextended(oid::text || ':' || mid::text,0));
  select coalesce(array_agg(k order by k),'{}') into keys from (select jsonb_object_keys(a || b) k) s where a->k is distinct from b->k;
  select coalesce(jsonb_object_agg(k,jsonb_build_object('before',b->k,'after',a->k)),'{}') into diff from unnest(keys) k
    where k=any(array['status','name','period_label','planned_start','planned_end','drive_folder_id','client_folder_id','local_memory_folder_id','local_memory_file_id','version','cycle_code','procedure_code','work_state','due_at','executed_at','verified_at','approved_by','validated_by','validated_at','allocation_pct','mission_role','staff_profile_id']);
  if current_user='service_role' then
    headers := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
    who := nullif(headers->>'x-office-manager-actor','');
    kind := headers->>'x-office-manager-actor-kind';
    initiator := nullif(headers->>'x-office-manager-initiator','');
  end if;
  if who is null then
    who := case when TG_OP='INSERT' then coalesce(nullif(v->>'agent',''),nullif(v->>'created_by',''),nullif(v->>'approved_by',''))
      when 'updated_by'=any(keys) then nullif(v->>'updated_by','') when 'approved_by'=any(keys) then nullif(v->>'approved_by','') when 'validated_by'=any(keys) then nullif(v->>'validated_by','') else null end;
    kind := case when who is null then 'technical' else 'recorded_by_application' end;
  end if;
  insert into public.office_mission_change_log(org_id,mission_id,source_table,record_id,operation,actor,actor_kind,initiated_by,changed_keys,changes,before_hash,after_hash,source_ref)
  values(oid,mid,TG_TABLE_NAME,coalesce(v->>'id',v->>'ref_id'),TG_OP,coalesce(who,current_user),coalesce(kind,'technical'),initiator,keys,diff,
    case when b='{}'::jsonb then null else encode(sha256(convert_to(b::text,'UTF8')),'hex') end,
    case when a='{}'::jsonb then null else encode(sha256(convert_to(a::text,'UTF8')),'hex') end,
    coalesce(v->>'source_ref',v->>'action_type'));
  return null;
end $$;

-- Existing genuine audit events remain visible in each local mission journal (no invented past events).
create unique index if not exists office_mission_change_legacy_event on public.office_mission_change_log(org_id,mission_id,source_table,record_id) where operation='LEGACY_AUDIT';
do $$ begin
  if to_regclass('public.office_audit_events') is not null then
    lock table public.office_audit_events in share row exclusive mode;
    insert into public.office_mission_change_log(org_id,mission_id,at,source_table,record_id,operation,actor,actor_kind,changed_keys,after_hash,source_ref)
    select e.org_id,e.mission_id,e.at,'office_audit_events',e.id::text,'LEGACY_AUDIT',coalesce(e.approved_by,e.agent),'historical_application_event',array[]::text[],encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex'),e.action_type || ':' || e.status
    from public.office_audit_events e join public.office_missions m on m.id=e.mission_id and m.org_id=e.org_id
    on conflict do nothing;
  end if;
end $$;
revoke all on function public.office_capture_mission_change() from public,anon,authenticated;
grant execute on function public.office_capture_mission_change() to service_role;
do $$ declare t text; begin
  for t in select c.table_name from information_schema.columns c join information_schema.tables b on b.table_schema=c.table_schema and b.table_name=c.table_name and b.table_type='BASE TABLE'
    where c.table_schema='public' and c.table_name<>'office_mission_change_log'
    group by c.table_name having bool_or(c.column_name='org_id') and (c.table_name='office_missions' or bool_or(c.column_name in ('office_mission_id','mission_id','engagement_id')))
  loop
      execute format('drop trigger if exists office_mission_change_capture on public.%I',t);
      execute format('create trigger office_mission_change_capture after insert or update or delete on public.%I for each row execute function public.office_capture_mission_change()',t);
  end loop;
end $$;
