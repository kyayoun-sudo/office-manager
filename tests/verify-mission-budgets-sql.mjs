import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
const sql=await readFile(new URL('../db/mission-budgets.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
const org='00000000-0000-0000-0000-000000000001',budget='00000000-0000-0000-0000-000000000007',hash='a'.repeat(64);
await db.query('insert into office_mission_budget_versions(id,org_id,office_mission_id,data,content_hash) values($1,$2,$1,$3,$4)',[budget,org,{synthetic:true},hash]);
await db.query('insert into office_mission_budget_decisions(org_id,budget_id,content_hash,decision) values($1,$2,$3,$4)',[org,budget,hash,'approve']);
await assert.rejects(db.query('insert into office_mission_budget_decisions(org_id,budget_id,content_hash,decision) values($1,$2,$3,$4)',[org,budget,'b'.repeat(64),'approve']));
await db.query('insert into office_mission_budget_exports(org_id,budget_id,content_hash) values($1,$2,$3)',[org,budget,hash]);
await assert.rejects(db.query('insert into office_mission_budget_exports(org_id,budget_id,content_hash) values($1,$2,$3)',[org,budget,hash]));
for(const table of ['office_mission_budget_versions','office_mission_budget_decisions','office_mission_budget_exports']){
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_table_privilege($1,$2,'SELECT') allowed`,[role,table])).rows[0].allowed,false);
 for(const privilege of ['UPDATE','DELETE'])assert.equal((await db.query(`select has_table_privilege('service_role',$1,$2) allowed`,[table,privilege])).rows[0].allowed,false);
 assert.equal((await db.query('select relrowsecurity from pg_class where relname=$1',[table])).rows[0].relrowsecurity,true);
}
await db.close();console.log('Mission budget SQL: idempotence, hash-bound approvals, unique export claims, RLS and immutable grants verified.');
