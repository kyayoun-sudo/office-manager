begin;
create table if not exists public.office_mission_team_versions (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, office_mission_id uuid not null,
 plan_id uuid not null references public.office_mission_plan_versions(id), version integer not null check(version>0),
 members jsonb not null check(jsonb_typeof(members)='array'), content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default now(), unique(org_id,office_mission_id,version),unique(org_id,office_mission_id,content_hash)
);
create table if not exists public.office_mission_review_decisions (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,office_mission_id uuid not null,
 target_kind text not null check(target_kind in ('team','programme')),target_id uuid not null,
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'), decision text not null check(decision in ('approve','defer','reject')),
 note text not null check(length(note)<=1000),capacity_reviewed boolean not null default false,request_id uuid not null,reviewed_team_id uuid,
 authority text not null default 'owner_credential_holder' check(authority='owner_credential_holder'),
 sequence bigint generated always as identity,created_at timestamptz not null default now(),unique(org_id,request_id),
 check(decision<>'reject' or length(btrim(note))>0)
);
create index if not exists office_mission_review_history on public.office_mission_review_decisions(org_id,target_kind,target_id,sequence desc);
alter table public.office_mission_team_versions enable row level security;
alter table public.office_mission_review_decisions enable row level security;
revoke all on public.office_mission_team_versions,public.office_mission_review_decisions from public,anon,authenticated,service_role;
grant select on public.office_mission_team_versions,public.office_mission_review_decisions to service_role;
revoke all on sequence public.office_mission_review_decisions_sequence_seq from public,anon,authenticated,service_role;

create or replace function public.office_save_mission_team(p_org_id uuid,p_mission_id uuid,p_plan_id uuid,p_plan_hash text,p_members jsonb,p_expected_team_id uuid)
returns public.office_mission_team_versions language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_plan public.office_mission_plan_versions;v_team public.office_mission_team_versions;v_latest public.office_mission_team_versions;
 v_mission public.office_missions;v_member jsonb;v_hash text;v_staff uuid;v_ids uuid[]='{}';v_start date;v_end date;
begin
 if p_org_id is null or p_mission_id is null or p_plan_id is null or p_plan_hash is null or p_members is null or jsonb_typeof(p_members)<>'array' then raise exception 'INVALID_TEAM';end if;
 if jsonb_array_length(p_members) not between 1 and 100 or length(p_members::text)>100000 then raise exception 'INVALID_TEAM';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_mission_id::text,0));
 select * into v_mission from public.office_missions where org_id=p_org_id and id=p_mission_id;
 if not found then raise exception 'MISSION_NOT_FOUND';end if;
 select * into v_plan from public.office_mission_plan_versions where org_id=p_org_id and id=p_plan_id and office_mission_id=p_mission_id;
 if not found or v_plan.content_hash<>p_plan_hash then raise exception 'PLAN_CONTENT_CHANGED';end if;
 if exists(select 1 from public.office_mission_plan_versions where org_id=p_org_id and office_mission_id=p_mission_id and version>v_plan.version) then raise exception 'PLAN_SUPERSEDED';end if;
 for v_member in select value from jsonb_array_elements(p_members) loop
  if jsonb_typeof(v_member)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(v_member) key) is distinct from array['allocation_pct','mission_role','planned_end','planned_start','staff_profile_id'] then raise exception 'INVALID_TEAM';end if;
  if jsonb_typeof(v_member->'staff_profile_id')<>'string' or (v_member->>'staff_profile_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_TEAM';end if;
  v_staff=(v_member->>'staff_profile_id')::uuid;
  if v_staff=any(v_ids) or not exists(select 1 from public.office_staff_profiles where org_id=p_org_id and id=v_staff and active=true) then raise exception 'STAFF_NOT_AVAILABLE';end if;
  v_ids=array_append(v_ids,v_staff);
  if jsonb_typeof(v_member->'mission_role')<>'string' or length(btrim(v_member->>'mission_role')) not between 1 and 120 or jsonb_typeof(v_member->'allocation_pct')<>'number' or (v_member->>'allocation_pct')::numeric not between 0.01 and 100 then raise exception 'INVALID_TEAM';end if;
  if jsonb_typeof(v_member->'planned_start')<>'string' or jsonb_typeof(v_member->'planned_end')<>'string' or (v_member->>'planned_start') !~ '^\d{4}-\d{2}-\d{2}$' or (v_member->>'planned_end') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_TEAM';end if;
  begin v_start=(v_member->>'planned_start')::date;v_end=(v_member->>'planned_end')::date;exception when others then raise exception 'INVALID_TEAM';end;
  if v_start>v_end or v_start<v_mission.planned_start or v_end>v_mission.planned_end or v_mission.planned_start is null or v_mission.planned_end is null then raise exception 'TEAM_DATES_OUTSIDE_MISSION';end if;
 end loop;
 v_hash=encode(sha256(convert_to(jsonb_build_object('plan_id',p_plan_id,'members',p_members)::text,'UTF8')),'hex');
 select * into v_latest from public.office_mission_team_versions where org_id=p_org_id and office_mission_id=p_mission_id order by version desc limit 1;
 select * into v_team from public.office_mission_team_versions where org_id=p_org_id and office_mission_id=p_mission_id and content_hash=v_hash;
 if found then return v_team;end if;
 if v_latest.id is distinct from p_expected_team_id then raise exception 'TEAM_CHANGED';end if;
 insert into public.office_mission_team_versions(org_id,office_mission_id,plan_id,version,members,content_hash)
 values(p_org_id,p_mission_id,p_plan_id,coalesce(v_latest.version,0)+1,p_members,v_hash) returning * into v_team;
 return v_team;
end;$fn$;

create or replace function public.office_decide_mission_review(p_org_id uuid,p_mission_id uuid,p_target_kind text,p_target_id uuid,p_content_hash text,p_decision text,p_note text,p_request_id uuid,p_expected_decision_id uuid,p_reviewed_team_id uuid,p_capacity_reviewed boolean)
returns public.office_mission_review_decisions language plpgsql security definer set search_path=pg_catalog as $fn$
declare v_plan_id uuid;v_hash text;v_result public.office_mission_review_decisions;v_latest_id uuid;v_team public.office_mission_team_versions;v_member jsonb;v_mission public.office_missions;v_task jsonb;
begin
 if p_org_id is null or p_mission_id is null or p_target_id is null or p_request_id is null or p_target_kind is null or p_target_kind not in ('team','programme') or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' or p_decision is null or p_decision not in ('approve','defer','reject') or p_note is null or length(p_note)>1000 or (p_decision='reject' and length(btrim(p_note))=0) then raise exception 'INVALID_REVIEW_DECISION';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_mission_id::text,0));
 select * into v_result from public.office_mission_review_decisions where org_id=p_org_id and request_id=p_request_id;
 if found then
  if v_result.office_mission_id<>p_mission_id or v_result.target_kind<>p_target_kind or v_result.target_id<>p_target_id or v_result.content_hash<>p_content_hash or v_result.decision<>p_decision or v_result.note<>p_note or v_result.reviewed_team_id is distinct from p_reviewed_team_id or v_result.capacity_reviewed is distinct from coalesce(p_capacity_reviewed,false) then raise exception 'REVIEW_REQUEST_CONFLICT';end if;
  return v_result;
 end if;
 if p_target_kind='team' then
  select id,plan_id,content_hash into v_latest_id,v_plan_id,v_hash from public.office_mission_team_versions where org_id=p_org_id and office_mission_id=p_mission_id order by version desc limit 1;
  if p_reviewed_team_id is not null then raise exception 'INVALID_REVIEW_DECISION';end if;
 else
  select id,plan_id,content_hash into v_latest_id,v_plan_id,v_hash from public.office_mission_programme_versions where org_id=p_org_id and office_mission_id=p_mission_id order by version desc limit 1;
 end if;
 if v_latest_id is distinct from p_target_id then raise exception 'REVIEW_TARGET_SUPERSEDED';end if;
 if v_hash is distinct from p_content_hash then raise exception 'REVIEW_CONTENT_CHANGED';end if;
 if v_plan_id is distinct from (select id from public.office_mission_plan_versions where org_id=p_org_id and office_mission_id=p_mission_id order by version desc limit 1) then raise exception 'PLAN_SUPERSEDED';end if;
 if p_decision='approve' then
  if (select decision from public.office_mission_plan_decisions where org_id=p_org_id and plan_id=v_plan_id order by sequence desc limit 1) is distinct from 'approve' then raise exception 'PLAN_APPROVAL_REQUIRED';end if;
  if p_target_kind='team' and p_capacity_reviewed is distinct from true then raise exception 'CAPACITY_REVIEW_REQUIRED';end if;
  select * into v_mission from public.office_missions where org_id=p_org_id and id=p_mission_id;
  select * into v_team from public.office_mission_team_versions where org_id=p_org_id and office_mission_id=p_mission_id order by version desc limit 1;
  if p_target_kind='programme' and (v_team.id is distinct from p_reviewed_team_id or v_team.plan_id is distinct from v_plan_id or (select decision from public.office_mission_review_decisions where org_id=p_org_id and target_kind='team' and target_id=v_team.id order by sequence desc limit 1) is distinct from 'approve') then raise exception 'TEAM_APPROVAL_REQUIRED';end if;
  if p_target_kind='programme' then
   for v_task in select task from public.office_mission_programme_versions v cross join lateral jsonb_array_elements(v.phases) phase cross join lateral jsonb_array_elements(phase->'tasks') task where v.id=p_target_id and v.org_id=p_org_id loop
    if coalesce(v_task->>'due_on','')='' or not exists(select 1 from jsonb_array_elements(v_team.members) member where lower(btrim(member->>'mission_role'))=lower(btrim(v_task->>'proposed_role')) and (v_task->>'due_on')::date between (member->>'planned_start')::date and (member->>'planned_end')::date) then raise exception 'PROGRAMME_RESPONSIBILITY_OR_DATE_MISSING';end if;
   end loop;
  end if;
  for v_member in select value from jsonb_array_elements(v_team.members) loop
   if v_mission.planned_start is null or v_mission.planned_end is null or (v_member->>'planned_start')::date<v_mission.planned_start or (v_member->>'planned_end')::date>v_mission.planned_end then raise exception 'TEAM_DATES_OUTSIDE_MISSION';end if;
   if not exists(select 1 from public.office_staff_profiles where org_id=p_org_id and id=(v_member->>'staff_profile_id')::uuid and active=true) then raise exception 'STAFF_NOT_AVAILABLE';end if;
  end loop;
 end if;
 select id into v_latest_id from public.office_mission_review_decisions where org_id=p_org_id and target_kind=p_target_kind and target_id=p_target_id order by sequence desc limit 1;
 if v_latest_id is distinct from p_expected_decision_id then raise exception 'REVIEW_DECISION_CHANGED';end if;
 insert into public.office_mission_review_decisions(org_id,office_mission_id,target_kind,target_id,content_hash,decision,note,request_id,reviewed_team_id,capacity_reviewed)
 values(p_org_id,p_mission_id,p_target_kind,p_target_id,p_content_hash,p_decision,p_note,p_request_id,p_reviewed_team_id,coalesce(p_capacity_reviewed,false)) returning * into v_result;
 return v_result;
end;$fn$;
revoke all on function public.office_save_mission_team(uuid,uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.office_decide_mission_review(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.office_save_mission_team(uuid,uuid,uuid,text,jsonb,uuid),public.office_decide_mission_review(uuid,uuid,text,uuid,text,text,text,uuid,uuid,uuid,boolean) to service_role;
commit;
