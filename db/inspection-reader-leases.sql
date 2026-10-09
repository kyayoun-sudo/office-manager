-- Install after db/memory.sql. Small control lease only; no document content or parallel memory.
-- Server calls only. SECURITY INVOKER preserves the existing table privilege/RLS contract.
create or replace function public.office_claim_reader_lease(p_org_id uuid, p_scope text, p_token uuid, p_ttl integer default 600)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  if p_scope is null or p_token is null or p_ttl is null or p_scope !~ '^[a-f0-9]{64}$' or p_ttl not between 60 and 900 then raise exception 'INVALID_READER_LEASE'; end if;
  insert into public.office_agent_checkpoints(org_id,agent_key,status,report,updated_at)
  values(p_org_id,'orpailleur-reader:' || pg_catalog.md5(p_scope),'PROCESSING',pg_catalog.jsonb_build_object('scope',p_scope,'token',p_token,'expires_at',pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_ttl)),pg_catalog.clock_timestamp())
  on conflict(org_id,agent_key) do update set status='PROCESSING',report=excluded.report,updated_at=excluded.updated_at
  where (public.office_agent_checkpoints.report->>'expires_at') is null
     or (public.office_agent_checkpoints.report->>'expires_at')::timestamptz <= pg_catalog.clock_timestamp();
  get diagnostics affected = row_count;
  return affected = 1;
end $$;
create or replace function public.office_renew_reader_lease(p_org_id uuid, p_scope text, p_token uuid, p_ttl integer default 600)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  if p_scope is null or p_token is null or p_ttl is null or p_scope !~ '^[a-f0-9]{64}$' or p_ttl not between 60 and 900 then raise exception 'INVALID_READER_LEASE'; end if;
  update public.office_agent_checkpoints set report=pg_catalog.jsonb_set(report,'{expires_at}',pg_catalog.to_jsonb(pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_ttl))),updated_at=pg_catalog.clock_timestamp()
  where org_id=p_org_id and agent_key='orpailleur-reader:' || pg_catalog.md5(p_scope)
    and report->>'scope'=p_scope and report->>'token'=p_token::text and (report->>'expires_at')::timestamptz > pg_catalog.clock_timestamp();
  get diagnostics affected = row_count; return affected = 1;
end $$;
create or replace function public.office_release_reader_lease(p_org_id uuid, p_scope text, p_token uuid, p_ttl integer default 600)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  update public.office_agent_checkpoints set status='IDLE',report=pg_catalog.jsonb_build_object('scope',p_scope),updated_at=pg_catalog.clock_timestamp()
  where org_id=p_org_id and agent_key='orpailleur-reader:' || pg_catalog.md5(p_scope) and report->>'scope'=p_scope and report->>'token'=p_token::text;
  get diagnostics affected = row_count; return affected = 1;
end $$;
revoke all on function public.office_claim_reader_lease(uuid,text,uuid,integer),public.office_renew_reader_lease(uuid,text,uuid,integer),public.office_release_reader_lease(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.office_claim_reader_lease(uuid,text,uuid,integer),public.office_renew_reader_lease(uuid,text,uuid,integer),public.office_release_reader_lease(uuid,text,uuid,integer) to service_role;
