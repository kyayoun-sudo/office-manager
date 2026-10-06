-- Schema-only snapshot. No RH records, questionnaire responses or tenant identifiers.
-- Existing Office Manager foundation and private.office_role are prerequisites.
begin;
create table if not exists public.office_mission_people_requirements (
id uuid not null default gen_random_uuid(),
org_id uuid not null,
office_mission_id uuid,
autonomy_required smallint not null default 3,
structure_level smallint not null default 3,
ambiguity_level smallint not null default 3,
innovation_level smallint not null default 3,
collaboration_level smallint not null default 3,
decision_speed_required smallint not null default 3,
compliance_level smallint not null default 4,
stability_level smallint not null default 3,
client_contact_level smallint not null default 3,
urgency_level smallint not null default 3,
mission_context text,
source text not null default 'agent_analysis'::text,
confidence numeric(3,2) not null default 0.70,
created_at timestamp with time zone not null default now(),
updated_at timestamp with time zone not null default now()
);

create table if not exists public.office_staff_management_profiles (
id uuid not null default gen_random_uuid(),
org_id uuid not null,
staff_profile_id uuid not null,
profile_label text not null,
autonomy_score smallint not null,
structure_need_score smallint not null,
recognition_need_score smallint not null,
uncertainty_tolerance_score smallint not null,
innovation_score smallint not null,
team_orientation_score smallint not null,
decision_confidence_score smallint not null,
feedback_sensitivity_score smallint not null,
stability_preference_score smallint not null,
compliance_orientation_score smallint not null,
primary_motivators text[] not null default '{}'::text[],
demotivators text[] not null default '{}'::text[],
preferred_mission_types text[] not null default '{}'::text[],
best_mission_conditions text[] not null default '{}'::text[],
briefing_requirements text[] not null default '{}'::text[],
management_style text not null,
communication_guidance text not null,
feedback_guidance text not null,
risk_flags text[] not null default '{}'::text[],
development_focus text[] not null default '{}'::text[],
source_type text not null default 'work_preferences_questionnaire'::text,
source_ref text,
evidence_note text not null default 'Indicateur managérial issu de préférences de travail déclarées; ne constitue pas un diagnostic psychologique.'::text,
profile_confidence numeric(3,2) not null default 0.65,
profile_version integer not null default 1,
active boolean not null default true,
created_at timestamp with time zone not null default now(),
updated_at timestamp with time zone not null default now()
);
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_prof_compliance_orientation_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_prof_compliance_orientation_score_check CHECK (((compliance_orientation_score >= 1) AND (compliance_orientation_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profi_uncertainty_tolerance_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profi_uncertainty_tolerance_score_check CHECK (((uncertainty_tolerance_score >= 1) AND (uncertainty_tolerance_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profil_feedback_sensitivity_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profil_feedback_sensitivity_score_check CHECK (((feedback_sensitivity_score >= 1) AND (feedback_sensitivity_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profil_stability_preference_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profil_stability_preference_score_check CHECK (((stability_preference_score >= 1) AND (stability_preference_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profile_decision_confidence_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profile_decision_confidence_score_check CHECK (((decision_confidence_score >= 1) AND (decision_confidence_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_autonomy_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_autonomy_score_check CHECK (((autonomy_score >= 1) AND (autonomy_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_innovation_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_innovation_score_check CHECK (((innovation_score >= 1) AND (innovation_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_org_id_fkey') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_org_id_fkey FOREIGN KEY (org_id) REFERENCES office_organizations(id) ON DELETE CASCADE;
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_org_id_staff_profile_id_key') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_org_id_staff_profile_id_key UNIQUE (org_id, staff_profile_id);
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_pkey') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_pkey PRIMARY KEY (id);
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_profile_confidence_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_profile_confidence_check CHECK (((profile_confidence >= (0)::numeric) AND (profile_confidence <= (1)::numeric)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_recognition_need_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_recognition_need_score_check CHECK (((recognition_need_score >= 1) AND (recognition_need_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_staff_profile_id_fkey') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_staff_profile_id_fkey FOREIGN KEY (staff_profile_id) REFERENCES office_staff_profiles(id) ON DELETE CASCADE;
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_structure_need_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_structure_need_score_check CHECK (((structure_need_score >= 1) AND (structure_need_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_staff_management_profiles'::regclass and conname='office_staff_management_profiles_team_orientation_score_check') then
 alter table office_staff_management_profiles add constraint office_staff_management_profiles_team_orientation_score_check CHECK (((team_orientation_score >= 1) AND (team_orientation_score <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirement_decision_speed_required_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirement_decision_speed_required_check CHECK (((decision_speed_required >= 1) AND (decision_speed_required <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_ambiguity_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_ambiguity_level_check CHECK (((ambiguity_level >= 1) AND (ambiguity_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_autonomy_required_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_autonomy_required_check CHECK (((autonomy_required >= 1) AND (autonomy_required <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_client_contact_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_client_contact_level_check CHECK (((client_contact_level >= 1) AND (client_contact_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_collaboration_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_collaboration_level_check CHECK (((collaboration_level >= 1) AND (collaboration_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_compliance_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_compliance_level_check CHECK (((compliance_level >= 1) AND (compliance_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_confidence_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_innovation_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_innovation_level_check CHECK (((innovation_level >= 1) AND (innovation_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_office_mission_id_fkey') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_office_mission_id_fkey FOREIGN KEY (office_mission_id) REFERENCES office_missions(id) ON DELETE CASCADE;
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_org_id_fkey') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_org_id_fkey FOREIGN KEY (org_id) REFERENCES office_organizations(id) ON DELETE CASCADE;
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_org_id_office_mission_id_key') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_org_id_office_mission_id_key UNIQUE (org_id, office_mission_id);
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_pkey') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_pkey PRIMARY KEY (id);
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_stability_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_stability_level_check CHECK (((stability_level >= 1) AND (stability_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_structure_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_structure_level_check CHECK (((structure_level >= 1) AND (structure_level <= 5)));
 end if;
end $guard$;
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='office_mission_people_requirements'::regclass and conname='office_mission_people_requirements_urgency_level_check') then
 alter table office_mission_people_requirements add constraint office_mission_people_requirements_urgency_level_check CHECK (((urgency_level >= 1) AND (urgency_level <= 5)));
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.office_people_match(p_org_id uuid, p_requirements jsonb, p_limit integer DEFAULT 10)
 RETURNS TABLE(staff_profile_id uuid, full_name text, role_title text, profile_label text, fit_score numeric, fit_band text, recognition_need integer, management_brief jsonb)
 LANGUAGE sql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
with req as (
  select
    greatest(1,least(5,coalesce((p_requirements->>'autonomy_required')::int,3))) as autonomy_required,
    greatest(1,least(5,coalesce((p_requirements->>'structure_level')::int,3))) as structure_level,
    greatest(1,least(5,coalesce((p_requirements->>'ambiguity_level')::int,3))) as ambiguity_level,
    greatest(1,least(5,coalesce((p_requirements->>'innovation_level')::int,3))) as innovation_level,
    greatest(1,least(5,coalesce((p_requirements->>'collaboration_level')::int,3))) as collaboration_level,
    greatest(1,least(5,coalesce((p_requirements->>'decision_speed_required')::int,3))) as decision_speed_required,
    greatest(1,least(5,coalesce((p_requirements->>'compliance_level')::int,4))) as compliance_level,
    greatest(1,least(5,coalesce((p_requirements->>'stability_level')::int,3))) as stability_level
), scored as (
  select
    mp.staff_profile_id,
    sp.full_name,
    sp.role_title,
    mp.profile_label,
    mp.recognition_need_score,
    mp.management_style,
    mp.communication_guidance,
    mp.feedback_guidance,
    mp.briefing_requirements,
    mp.primary_motivators,
    mp.risk_flags,
    round((
      100
      - (abs(mp.autonomy_score-r.autonomy_required) * 5.0)
      - (abs(mp.structure_need_score-r.structure_level) * 4.0)
      - (abs(mp.uncertainty_tolerance_score-r.ambiguity_level) * 5.0)
      - (abs(mp.innovation_score-r.innovation_level) * 4.0)
      - (abs(mp.team_orientation_score-r.collaboration_level) * 3.0)
      - (abs(mp.decision_confidence_score-r.decision_speed_required) * 4.0)
      - (abs(mp.compliance_orientation_score-r.compliance_level) * 3.0)
      - (abs(mp.stability_preference_score-r.stability_level) * 2.0)
    )::numeric,1) as fit_score
  from public.office_staff_management_profiles mp
  join public.office_staff_profiles sp on sp.id=mp.staff_profile_id and sp.org_id=mp.org_id
  cross join req r
  where mp.org_id=p_org_id and mp.active=true and sp.active=true
    and (not (p_requirements ? 'eligible_staff_profile_ids')
      or mp.staff_profile_id::text in (
        select jsonb_array_elements_text(p_requirements->'eligible_staff_profile_ids')
      ))
)
select
  s.staff_profile_id,
  s.full_name,
  s.role_title,
  s.profile_label,
  greatest(0,least(100,s.fit_score)) as fit_score,
  case when s.fit_score >= 85 then 'TRES_BON'
       when s.fit_score >= 70 then 'BON'
       when s.fit_score >= 55 then 'MOYEN'
       else 'FAIBLE' end as fit_band,
  s.recognition_need_score::int as recognition_need,
  jsonb_build_object(
    'management_style',s.management_style,
    'communication',s.communication_guidance,
    'feedback',s.feedback_guidance,
    'briefing_requirements',to_jsonb(s.briefing_requirements),
    'motivators',to_jsonb(s.primary_motivators),
    'watchouts',to_jsonb(s.risk_flags),
    'guardrail','Utiliser ce profil comme aide au management et à la composition d équipe, jamais comme diagnostic clinique ni comme base unique de décision RH.'
  ) as management_brief
from scored s
order by greatest(0,least(100,s.fit_score)) desc, s.full_name
limit greatest(1,least(coalesce(p_limit,10),50));
$function$;

CREATE OR REPLACE FUNCTION private.enqueue_people_intelligence_for_mission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_text text := lower(coalesce(new.mission_code,'') || ' ' || coalesce(new.name,''));
  v_req jsonb;
  v_kind text;
  v_candidates jsonb;
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'Mission tenant cannot change';
  end if;
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.mission_code is not distinct from old.mission_code then
    return new;
  end if;
  if v_text ~ '(due[ _-]?diligence|diligence[ _-]?financi)' then
    v_kind := 'DUE_DILIGENCE';
    v_req := jsonb_build_object(
      'autonomy_required',4,'structure_level',3,'ambiguity_level',4,'innovation_level',4,
      'collaboration_level',4,'decision_speed_required',4,'compliance_level',4,'stability_level',2,
      'client_contact_level',4,'urgency_level',4
    );
  elsif v_text ~ '(audit|commissariat|cac)' then
    v_kind := 'AUDIT';
    v_req := jsonb_build_object(
      'autonomy_required',3,'structure_level',4,'ambiguity_level',2,'innovation_level',2,
      'collaboration_level',4,'decision_speed_required',3,'compliance_level',5,'stability_level',4,
      'client_contact_level',3,'urgency_level',3
    );
  else
    v_kind := 'GENERAL';
    v_req := jsonb_build_object(
      'autonomy_required',3,'structure_level',3,'ambiguity_level',3,'innovation_level',3,
      'collaboration_level',3,'decision_speed_required',3,'compliance_level',4,'stability_level',3,
      'client_contact_level',3,'urgency_level',3
    );
  end if;

  insert into public.office_mission_people_requirements(
    org_id,office_mission_id,autonomy_required,structure_level,ambiguity_level,innovation_level,
    collaboration_level,decision_speed_required,compliance_level,stability_level,client_contact_level,
    urgency_level,mission_context,source,confidence,updated_at
  ) values (
    new.org_id,new.id,
    (v_req->>'autonomy_required')::int,(v_req->>'structure_level')::int,(v_req->>'ambiguity_level')::int,
    (v_req->>'innovation_level')::int,(v_req->>'collaboration_level')::int,(v_req->>'decision_speed_required')::int,
    (v_req->>'compliance_level')::int,(v_req->>'stability_level')::int,(v_req->>'client_contact_level')::int,
    (v_req->>'urgency_level')::int,
    'Profil initial dérivé du type de mission '||v_kind||'. À affiner par le manager si le contexte réel diffère.',
    'mission_trigger_v2',0.65,now()
  )
  on conflict (org_id,office_mission_id) do update set
    autonomy_required=excluded.autonomy_required,
    structure_level=excluded.structure_level,
    ambiguity_level=excluded.ambiguity_level,
    innovation_level=excluded.innovation_level,
    collaboration_level=excluded.collaboration_level,
    decision_speed_required=excluded.decision_speed_required,
    compliance_level=excluded.compliance_level,
    stability_level=excluded.stability_level,
    client_contact_level=excluded.client_contact_level,
    urgency_level=excluded.urgency_level,
    mission_context=excluded.mission_context,
    source=excluded.source,
    confidence=excluded.confidence,
    updated_at=now()
  where office_mission_people_requirements.source in ('mission_trigger_v1','mission_trigger_v2');

  select to_jsonb(r) - 'mission_context' - 'org_id' - 'id' - 'office_mission_id' - 'created_at' - 'updated_at'
  into v_req from public.office_mission_people_requirements r
  where r.org_id=new.org_id and r.office_mission_id=new.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_profile_id',m.staff_profile_id,

    'role_title',m.role_title,

    'people_fit_score',m.fit_score,
    'fit_band',m.fit_band,
    'recognition_need',m.recognition_need,
    'management_brief',m.management_brief
  ) order by m.fit_score desc),'[]'::jsonb)
  into v_candidates
  from public.office_people_match(new.org_id,v_req,5) m;

  insert into public.office_action_queue(
    org_id,agent_key,office_mission_id,action_type,idempotency_key,summary,payload,evidence,status,requested_at,work_state
  ) values (
    new.org_id,
    'grand-controleur',
    new.id,
    'PEOPLE_INTELLIGENCE_RECOMMENDATION',
    'people-intelligence:'||new.id::text,
    'Recommandation de composition d équipe et de briefing managérial — '||new.name,
    jsonb_build_object(
      'mission_type',v_kind,
      'mission_requirements',v_req,
      'people_fit_review_pool',v_candidates,
      'eligibility_status','manager_review_required',
      'technical_skills_verified',false,
      'availability_verified',false,
      'selection_order',jsonb_build_array('compétence technique','disponibilité et absence de chevauchement','people fit','niveau hiérarchique adapté'),
      'instruction','Le people fit est un critère complémentaire. Ne jamais affecter quelqu un uniquement sur la base du questionnaire.'
    ),
    jsonb_build_object(
      'algorithm_version','taty_people_intelligence_v2',
      'profile_source','private_management_profiles',
      'guardrail','Aucun diagnostic clinique. Aucune décision RH sensible fondée uniquement sur ces profils.'
    ),
    'proposed',now(),'requested'
  )
  on conflict (org_id,idempotency_key) do update set
    summary=excluded.summary,
    payload=excluded.payload,
    evidence=excluded.evidence,
    status='proposed',
    requested_at=now(),
    work_state='requested'
  where office_action_queue.status in ('proposed','awaiting_approval')
    and office_action_queue.approved_at is null
    and office_action_queue.executed_at is null
    and office_action_queue.verified_at is null;

  return new;
end;
$function$;


alter table public.office_mission_people_requirements add column if not exists required_skills text[] not null default '{}';
do $guard$ begin
 if not exists (select 1 from pg_constraint where conrelid='public.office_staff_management_profiles'::regclass and conname='people_staff_tenant_fk') then
  alter table public.office_staff_management_profiles add constraint people_staff_tenant_fk
   foreign key (org_id,staff_profile_id) references public.office_staff_profiles(org_id,id);
 end if;
 if not exists (select 1 from pg_constraint where conrelid='public.office_mission_people_requirements'::regclass and conname='people_mission_tenant_fk') then
  alter table public.office_mission_people_requirements add constraint people_mission_tenant_fk
   foreign key (org_id,office_mission_id) references public.office_missions(org_id,id);
 end if;
end $guard$;

-- Canonical rules only; no questionnaire or individual profile seeds.
insert into private.agent_rules(rule_code,name,description,default_severity,active) values
 ('R009','Matching humain avant affectation','Vérifier compétences et disponibilité avant le people fit complémentaire.','ELEVE',true),
 ('R010','Briefing adapté au profil','Adapter cadrage, autonomie, communication, reconnaissance et feedback.','MOYEN',true),
 ('R011','Garde-fou décision RH','Aucune décision RH sensible fondée sur le questionnaire seul; aucun diagnostic clinique.','CRITIQUE',true),
 ('R012','Boucle post-mission','Ajuster les profils à partir de faits professionnels documentés et validés après mission.','MOYEN',true)
on conflict(rule_code) do nothing;
alter table public.office_staff_management_profiles enable row level security;
alter table public.office_mission_people_requirements enable row level security;
revoke all on public.office_staff_management_profiles, public.office_mission_people_requirements from anon, authenticated;
grant select, insert, update, delete on public.office_staff_management_profiles, public.office_mission_people_requirements to service_role;
revoke all on function public.office_people_match(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.office_people_match(uuid,jsonb,integer) to service_role;
revoke all on function private.enqueue_people_intelligence_for_mission() from public,anon,authenticated;
create index if not exists office_staff_management_profiles_staff_idx on public.office_staff_management_profiles(staff_profile_id);
create index if not exists office_mission_people_requirements_mission_idx on public.office_mission_people_requirements(office_mission_id);
drop trigger if exists trg_office_missions_people_intelligence on public.office_missions;
create trigger trg_office_missions_people_intelligence after insert or update of mission_code,name,org_id on public.office_missions
for each row execute function private.enqueue_people_intelligence_for_mission();

commit;
