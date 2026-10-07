-- Proposed programmes only: immutable structured versions linked to a plan.
-- No executable status, assignments, controls, queue items or scheduler writes.
begin;
create table if not exists public.office_mission_programme_versions(
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  office_mission_id uuid not null,
  plan_id uuid not null references public.office_mission_plan_versions(id),
  version integer not null check(version>0),
  phases jsonb not null check(jsonb_typeof(phases)='array'),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key(org_id,office_mission_id) references public.office_missions(org_id,id),
  unique(org_id,office_mission_id,version),unique(org_id,plan_id,content_hash)
);
alter table public.office_mission_programme_versions enable row level security;
revoke all on public.office_mission_programme_versions from public,anon,authenticated,service_role;
grant select on public.office_mission_programme_versions to service_role;

create or replace function public.office_save_mission_programme(
  p_org_id uuid,p_plan_id uuid,p_plan_hash text,p_phases jsonb,p_expected_programme_id uuid
) returns public.office_mission_programme_versions
language plpgsql security definer set search_path=pg_catalog
as $programme$
declare
  v_plan public.office_mission_plan_versions;
  v_result public.office_mission_programme_versions;
  v_latest uuid;
  v_version integer;
  v_phase jsonb; v_task jsonb; v_doc jsonb;
  v_index integer:=0; v_count integer:=0;
  v_hash text; v_due date; v_start date; v_end date;
begin
  if p_org_id is null or p_plan_id is null or p_plan_hash is null
     or p_plan_hash !~ '^[0-9a-f]{64}$' or p_phases is null
     or jsonb_typeof(p_phases)<>'array' then raise exception 'INVALID_PROGRAMME'; end if;
  if jsonb_array_length(p_phases) not between 1 and 20 or length(p_phases::text)>100000 then raise exception 'PROGRAMME_TOO_LARGE'; end if;
  select * into v_plan from public.office_mission_plan_versions where id=p_plan_id and org_id=p_org_id;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||v_plan.office_mission_id::text,0));
  if v_plan.content_hash<>p_plan_hash then raise exception 'PLAN_CONTENT_CHANGED'; end if;
  if exists(select 1 from public.office_mission_plan_versions where org_id=p_org_id
    and office_mission_id=v_plan.office_mission_id and version>v_plan.version) then raise exception 'PLAN_SUPERSEDED'; end if;
  if jsonb_array_length(p_phases)<>jsonb_array_length(v_plan.phases) then raise exception 'INVALID_PROGRAMME'; end if;
  select planned_start,planned_end into v_start,v_end from public.office_missions where org_id=p_org_id and id=v_plan.office_mission_id;
  for v_phase in select value from jsonb_array_elements(p_phases) loop
    if jsonb_typeof(v_phase)<>'object' then raise exception 'INVALID_PROGRAMME'; end if;
    if (select count(*) from jsonb_object_keys(v_phase))<>2
       or (v_phase->'phase_index') is distinct from to_jsonb(v_index)
       or jsonb_typeof(v_phase->'tasks') is distinct from 'array' then raise exception 'INVALID_PROGRAMME'; end if;
    if jsonb_array_length(v_phase->'tasks') not between 1 and 20 then raise exception 'INVALID_PROGRAMME'; end if;
    for v_task in select value from jsonb_array_elements(v_phase->'tasks') loop
      v_count:=v_count+1;
      if jsonb_typeof(v_task)<>'object' then raise exception 'INVALID_PROGRAMME'; end if;
      if (select count(*) from jsonb_object_keys(v_task))<>6
         or jsonb_typeof(v_task->'title') is distinct from 'string'
         or length(btrim(v_task->>'title')) not between 1 and 300
         or jsonb_typeof(v_task->'proposed_role') is distinct from 'string'
         or length(btrim(v_task->>'proposed_role')) not between 1 and 120
         or jsonb_typeof(v_task->'procedure') is distinct from 'string'
         or length(btrim(v_task->>'procedure')) not between 1 and 3000
         or jsonb_typeof(v_task->'deliverable') is distinct from 'string'
         or length(btrim(v_task->>'deliverable')) not between 1 and 1000
         or jsonb_typeof(v_task->'due_on') is distinct from 'string'
         or jsonb_typeof(v_task->'expected_documents') is distinct from 'array' then raise exception 'INVALID_PROGRAMME'; end if;
      if length(v_task->>'title')>300 or length(v_task->>'proposed_role')>120 or length(v_task->>'procedure')>3000 or length(v_task->>'deliverable')>1000 then raise exception 'INVALID_PROGRAMME'; end if;
      if jsonb_array_length(v_task->'expected_documents')>20 then raise exception 'INVALID_PROGRAMME'; end if;
      for v_doc in select value from jsonb_array_elements(v_task->'expected_documents') loop
        if jsonb_typeof(v_doc)<>'string' or length(btrim(v_doc#>>'{}')) not between 1 and 300 or length(v_doc#>>'{}')>300 then raise exception 'INVALID_PROGRAMME'; end if;
      end loop;
      if (v_task->>'due_on')<>'' then
        if (v_task->>'due_on') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_PROGRAMME'; end if;
        begin v_due:=(v_task->>'due_on')::date;
        exception when others then raise exception 'INVALID_PROGRAMME'; end;
        if (v_start is not null and v_due<v_start) or (v_end is not null and v_due>v_end) then raise exception 'PROGRAMME_DATE_OUTSIDE_MISSION'; end if;
      end if;
    end loop;
    v_index:=v_index+1;
  end loop;
  if v_count>100 then raise exception 'PROGRAMME_TOO_LARGE'; end if;
  v_hash:=encode(sha256(convert_to(p_phases::text,'UTF8')),'hex');
  select * into v_result from public.office_mission_programme_versions where org_id=p_org_id and plan_id=p_plan_id and content_hash=v_hash;
  if found then return v_result; end if;
  select id into v_latest from public.office_mission_programme_versions where org_id=p_org_id and office_mission_id=v_plan.office_mission_id order by version desc limit 1;
  if v_latest is distinct from p_expected_programme_id then raise exception 'PROGRAMME_CHANGED'; end if;
  select coalesce(max(version),0)+1 into v_version from public.office_mission_programme_versions where org_id=p_org_id and office_mission_id=v_plan.office_mission_id;
  insert into public.office_mission_programme_versions(org_id,office_mission_id,plan_id,version,phases,content_hash)
    values(p_org_id,v_plan.office_mission_id,p_plan_id,v_version,p_phases,v_hash) returning * into v_result;
  return v_result;
end;
$programme$;
revoke all on function public.office_save_mission_programme(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.office_save_mission_programme(uuid,uuid,text,jsonb,uuid) to service_role;
commit;
