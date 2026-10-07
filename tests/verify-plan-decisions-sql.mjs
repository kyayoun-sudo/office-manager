import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),org='00000000-0000-0000-0000-000000000001',mission='00000000-0000-0000-0000-000000000002';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table public.office_missions(id uuid primary key,org_id uuid not null,unique(org_id,id));
insert into public.office_missions values('${mission}','${org}');
create table public.office_action_queue(id uuid primary key,status text);insert into public.office_action_queue values('${mission}','proposed');`);
await db.exec(await readFile(new URL('../db/mission-plans.sql',import.meta.url),'utf8'));
const sql=await readFile(new URL('../db/mission-plan-decisions.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
const save=async(content)=> (await db.query('select (public.office_save_mission_plan($1,$2,$3,$4)).*',[org,mission,content,'["Cadrage"]'])).rows[0];
const first=await save('Synthetic v1');
const request=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const decide=async(plan,choice,req,previous=null,note='',hash=plan.content_hash,tenant=org)=>(await db.query('select (public.office_decide_mission_plan($1,$2,$3,$4,$5,$6,$7)).*',[tenant,plan.id,hash,choice,note,req,previous])).rows[0];
const approved=await decide(first,'approve',request(10));
assert.equal((await decide(first,'approve',request(10))).id,approved.id);
await assert.rejects(decide(first,'reject',request(10),null,'changed'),/DECISION_REQUEST_CONFLICT/);
await assert.rejects(decide(first,'defer',request(11)),/DECISION_CHANGED/);
await assert.rejects(decide(first,'reject',request(11),approved.id,' '),/INVALID_PLAN_DECISION/);
await assert.rejects(decide(first,'approve',request(11),approved.id,'','b'.repeat(64)),/PLAN_CONTENT_CHANGED/);
await assert.rejects(decide(first,'approve',request(11),approved.id,'',first.content_hash,request(99)),/PLAN_NOT_FOUND/);
const deferred=await decide(first,'defer',request(11),approved.id,'Relecture');assert.equal(deferred.decision,'defer');
const second=await save('Synthetic v2');
await assert.rejects(decide(first,'approve',request(12),deferred.id),/PLAN_SUPERSEDED/);
// A retry can retrieve the earlier result, but cannot create a new approval.
assert.equal((await decide(first,'approve',request(10))).id,approved.id);
assert.equal((await db.query('select count(*)::int n from office_mission_plan_decisions where plan_id=$1',[second.id])).rows[0].n,0);
const rejected=await decide(second,'reject',request(13),null,'Réviser');assert.equal(rejected.decision,'reject');
assert.equal((await db.query('select status from office_action_queue')).rows[0].status,'proposed');
const rights=(await db.query(`select
has_table_privilege('anon','office_mission_plan_decisions','SELECT') anon_read,
has_table_privilege('authenticated','office_mission_plan_decisions','INSERT') user_insert,
has_table_privilege('service_role','office_mission_plan_decisions','INSERT') backend_insert,
has_table_privilege('service_role','office_mission_plan_decisions','UPDATE') backend_update,
has_table_privilege('service_role','office_mission_plan_decisions','DELETE') backend_delete,
has_function_privilege('anon','office_decide_mission_plan(uuid,uuid,text,text,text,uuid,uuid)','EXECUTE') anon_rpc,
has_function_privilege('service_role','office_decide_mission_plan(uuid,uuid,text,text,text,uuid,uuid)','EXECUTE') backend_rpc,
(select relrowsecurity from pg_class where oid='office_mission_plan_decisions'::regclass) rls`)).rows[0];
assert.deepEqual(rights,{anon_read:false,user_insert:false,backend_insert:false,backend_update:false,backend_delete:false,anon_rpc:false,backend_rpc:true,rls:true});
console.log('Plan decisions SQL passed: exact version/hash, owner RPC, immutable history, stale decision/version rejection, idempotent retries, no queue mutation.');await db.close();
