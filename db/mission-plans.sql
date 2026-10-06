-- Internal draft versions only. No approvals, assignments or scheduler jobs.
begin;
create table if not exists public.office_mission_plan_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  office_mission_id uuid not null,
  version integer not null check(version > 0),
  content text not null check(length(content) between 1 and 50000),
  phases jsonb not null check(jsonb_typeof(phases)='array'),
  content_hash text not null,
  source text not null default 'pilot_submission',
  created_at timestamptz not null default now(),
  foreign key(org_id,office_mission_id) references public.office_missions(org_id,id),
  unique(org_id,office_mission_id,version),
  unique(org_id,office_mission_id,content_hash)
);
alter table public.office_mission_plan_versions enable row level security;
revoke all on public.office_mission_plan_versions from public,anon,authenticated,service_role;
grant select on public.office_mission_plan_versions to service_role;

create or replace function public.office_save_mission_plan(
  p_org_id uuid, p_mission_id uuid, p_content text, p_phases jsonb
) returns public.office_mission_plan_versions
language plpgsql security definer set search_path=pg_catalog
as $plan$
declare
  v_hash text;
  v_result public.office_mission_plan_versions;
  v_version integer;
begin
  if p_org_id is null or p_mission_id is null or p_content is null
     or length(btrim(p_content)) not between 1 and 50000
     or p_phases is null or jsonb_typeof(p_phases) <> 'array' then
    raise exception 'INVALID_PLAN';
  end if;
  if jsonb_array_length(p_phases)>20 or exists (
    select 1 from jsonb_array_elements(p_phases) item
    where jsonb_typeof(item)<>'string' or length(btrim(item#>>'{}')) not between 1 and 500
  ) then raise exception 'INVALID_PHASES'; end if;
  perform 1 from public.office_missions where org_id=p_org_id and id=p_mission_id;
  if not found then raise exception 'MISSION_NOT_FOUND'; end if;
  -- Serializes only versions of the same org/mission; retries return the same row.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_mission_id::text,0));
  v_hash := encode(sha256(convert_to(jsonb_build_object('content',p_content,'phases',p_phases)::text,'UTF8')),'hex');
  select * into v_result from public.office_mission_plan_versions
    where org_id=p_org_id and office_mission_id=p_mission_id and content_hash=v_hash;
  if found then return v_result; end if;
  select coalesce(max(version),0)+1 into v_version from public.office_mission_plan_versions
    where org_id=p_org_id and office_mission_id=p_mission_id;
  insert into public.office_mission_plan_versions(org_id,office_mission_id,version,content,phases,content_hash)
    values(p_org_id,p_mission_id,v_version,p_content,p_phases,v_hash)
    returning * into v_result;
  return v_result;
end;
$plan$;
revoke all on function public.office_save_mission_plan(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.office_save_mission_plan(uuid,uuid,text,jsonb) to service_role;
commit;
