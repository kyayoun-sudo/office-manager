import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create table public.office_missions(id uuid primary key,org_id uuid not null,unique(org_id,id));
insert into public.office_missions values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001');
`);
const sql=await readFile(new URL('../db/mission-plans.sql',import.meta.url),'utf8');
await db.exec(sql);
await db.exec(sql);
const save=content=>db.query("select (public.office_save_mission_plan($1,$2,$3,$4)).*",[
  '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',content,JSON.stringify(['Cadrage','Diagnostic'])
]);
const first=(await save('Synthetic plan v1')).rows[0];
assert.equal(first.version,1);
assert.equal((await save('Synthetic plan v1')).rows[0].id,first.id);
assert.equal((await save('Synthetic plan v2')).rows[0].version,2);
assert.equal((await db.query('select count(*)::int n from public.office_mission_plan_versions')).rows[0].n,2);
assert.equal((await db.query('select content from public.office_mission_plan_versions where version=1')).rows[0].content,'Synthetic plan v1');
await assert.rejects(db.query("select public.office_save_mission_plan('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000002','Wrong tenant','[]')"),/MISSION_NOT_FOUND/);
await assert.rejects(db.query("select public.office_save_mission_plan('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Bad phases','[1]')"),/INVALID_PHASES/);
await assert.rejects(db.query("select public.office_save_mission_plan('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','','[]')"),/INVALID_PLAN/);
const rights=(await db.query(`select
has_function_privilege('anon','public.office_save_mission_plan(uuid,uuid,text,jsonb)','EXECUTE') anon_rpc,
has_table_privilege('authenticated','public.office_mission_plan_versions','SELECT') user_read,
has_table_privilege('service_role','public.office_mission_plan_versions','UPDATE') backend_update,
has_table_privilege('service_role','public.office_mission_plan_versions','INSERT') backend_insert,
has_function_privilege('service_role','public.office_save_mission_plan(uuid,uuid,text,jsonb)','EXECUTE') backend_rpc`)).rows[0];
assert.deepEqual(rights,{anon_rpc:false,user_read:false,backend_update:false,backend_insert:false,backend_rpc:true});
console.log('Plan SQL passed: idempotent versions, preserved content, tenant isolation, restricted writes and no public access.');
await db.close();
