import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema private; create schema auth;
create table private.agent_rules(rule_code text primary key,name text,description text,default_severity text,active boolean);
create table auth.users(id uuid primary key);
create table public.office_organizations(id uuid primary key);
create table public.office_staff_profiles(id uuid primary key,org_id uuid not null,full_name text,role_title text,active boolean default true,unique(org_id,id));
create table public.office_missions(id uuid primary key,org_id uuid not null,mission_code text,name text,unique(org_id,id));
create table public.office_action_queue(id uuid default gen_random_uuid(),org_id uuid,agent_key text,office_mission_id uuid,action_type text,idempotency_key text,summary text,payload jsonb,evidence jsonb,status text,requested_at timestamptz,work_state text,approved_at timestamptz,executed_at timestamptz,verified_at timestamptz,unique(org_id,idempotency_key));
`);
const sql = await readFile(new URL('../db/people-intelligence.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql); // Same prepared release must be re-runnable without data loss.
await db.exec(`
insert into office_organizations values ('00000000-0000-0000-0000-000000000001');
insert into office_missions values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','AUDIT','Synthetic audit');
`);
let result = await db.query('select status,payload from office_action_queue');
assert.equal(result.rows.length,1);
assert.equal(result.rows[0].status,'proposed');
assert.equal(result.rows[0].payload.availability_verified,false);
await db.exec(`update office_mission_people_requirements set source='manager',autonomy_required=5;
update office_action_queue set status='approved',approved_at=now();
update office_missions set name='Synthetic due diligence';`);
result = await db.query('select status from office_action_queue');
assert.equal(result.rows[0].status,'approved');
result = await db.query('select autonomy_required,source from office_mission_people_requirements');
assert.equal(result.rows[0].autonomy_required,5);
assert.equal(result.rows[0].source,'manager');
await db.exec(`update office_action_queue set status='proposed',approved_at=null;
update office_missions set name='Synthetic general mission';`);
assert.equal((await db.query('select count(*)::int as n from office_action_queue')).rows[0].n,1);
assert.equal((await db.query(`select has_function_privilege('anon','public.office_people_match(uuid,jsonb,integer)','EXECUTE') as allowed`)).rows[0].allowed,false);
await db.exec(`
insert into office_staff_profiles values ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Synthetic person','Synthetic role',true);
insert into office_staff_management_profiles(org_id,staff_profile_id,profile_label,autonomy_score,structure_need_score,recognition_need_score,uncertainty_tolerance_score,innovation_score,team_orientation_score,decision_confidence_score,feedback_sensitivity_score,stability_preference_score,compliance_orientation_score,management_style,communication_guidance,feedback_guidance)
values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','Synthetic',3,3,3,3,3,3,3,3,3,4,'Synthetic briefing','Synthetic communication','Synthetic feedback');
`);
result = await db.query(`select * from office_people_match('00000000-0000-0000-0000-000000000001','{}',5)`);
assert.equal(result.rows.length,1);
assert.equal(Number(result.rows[0].fit_score),100);
assert.equal(result.rows[0].management_brief.management_style,'Synthetic briefing');
assert.equal((await db.query(`select count(*)::int as n from office_people_match('00000000-0000-0000-0000-000000000001','{"eligible_staff_profile_ids":[]}',5)`)).rows[0].n,0);
assert.equal((await db.query(`select count(*)::int as n from office_people_match('00000000-0000-0000-0000-000000000099','{}',5)`)).rows[0].n,0);
assert.equal((await db.query('select count(*)::int as n from private.agent_rules')).rows[0].n,4);
console.log('SQL verified: repeatable deployment, automatic queue, preserved approval and manager requirements, no anonymous RPC.');
await db.close();
