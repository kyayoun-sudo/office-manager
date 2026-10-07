-- Append-only decisions on immutable plan versions. No execution permission.
begin;
create table if not exists public.office_mission_plan_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  plan_id uuid not null references public.office_mission_plan_versions(id),
  request_id uuid not null,
  decision text not null check(decision in ('approve','defer','reject')),
  note text not null default '' check(length(note)<=1000),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  authority text not null default 'owner_credential_holder' check(authority='owner_credential_holder'),
  sequence bigint generated always as identity,
  created_at timestamptz not null default now(),
  unique(org_id,request_id),
  check(decision<>'reject' or length(btrim(note))>0)
);
create index if not exists office_plan_decisions_history on public.office_mission_plan_decisions(org_id,plan_id,sequence desc);
alter table public.office_mission_plan_decisions enable row level security;
revoke all on public.office_mission_plan_decisions from public,anon,authenticated,service_role;
grant select on public.office_mission_plan_decisions to service_role;
revoke all on sequence public.office_mission_plan_decisions_sequence_seq from public,anon,authenticated,service_role;

-- The backend checks the owner credential. Only this restricted RPC can append.
-- Serialize with the existing save-plan RPC, to reject approval of a stale version.
create or replace function public.office_decide_mission_plan(
  p_org_id uuid,p_plan_id uuid,p_content_hash text,p_decision text,p_note text,
  p_request_id uuid,p_expected_decision_id uuid
) returns public.office_mission_plan_decisions
language plpgsql security definer set search_path=pg_catalog
as $decision$
declare
  v_plan public.office_mission_plan_versions;
  v_result public.office_mission_plan_decisions;
  v_latest_decision uuid;
begin
  if p_org_id is null or p_plan_id is null or p_request_id is null
     or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
     or p_decision is null or p_decision not in ('approve','defer','reject')
     or p_note is null or length(p_note)>1000
     or (p_decision='reject' and length(btrim(p_note))=0) then
    raise exception 'INVALID_PLAN_DECISION';
  end if;
  select * into v_plan from public.office_mission_plan_versions where org_id=p_org_id and id=p_plan_id;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||v_plan.office_mission_id::text,0));
  if v_plan.content_hash<>p_content_hash then raise exception 'PLAN_CONTENT_CHANGED'; end if;
  select * into v_result from public.office_mission_plan_decisions where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_result.plan_id<>p_plan_id or v_result.decision<>p_decision or v_result.note<>p_note or v_result.content_hash<>p_content_hash then
      raise exception 'DECISION_REQUEST_CONFLICT';
    end if;
    return v_result;
  end if;
  if exists(select 1 from public.office_mission_plan_versions where org_id=p_org_id
     and office_mission_id=v_plan.office_mission_id and version>v_plan.version) then
    raise exception 'PLAN_SUPERSEDED';
  end if;
  select id into v_latest_decision from public.office_mission_plan_decisions
    where org_id=p_org_id and plan_id=p_plan_id order by sequence desc limit 1;
  if v_latest_decision is distinct from p_expected_decision_id then raise exception 'DECISION_CHANGED'; end if;
  insert into public.office_mission_plan_decisions(org_id,plan_id,request_id,decision,note,content_hash)
    values(p_org_id,p_plan_id,p_request_id,p_decision,p_note,p_content_hash) returning * into v_result;
  return v_result;
end;
$decision$;
revoke all on function public.office_decide_mission_plan(uuid,uuid,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.office_decide_mission_plan(uuid,uuid,text,text,text,uuid,uuid) to service_role;
commit;
