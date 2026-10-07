import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
const sql = await readFile(new URL('../db/tidy.sql', import.meta.url), 'utf8');
await db.exec(sql); await db.exec(sql);
const org = '00000000-0000-0000-0000-000000000001';
const req = (await db.query("insert into public.office_tidy_requests(org_id,title) values ($1,'Ranger') returning id", [org])).rows[0].id;
await db.query("insert into public.office_tidy_items(org_id,request_id,file_id,file_name,mode) values ($1,$2,'f1','a.pdf','proposal')", [org, req]);
await assert.rejects(db.query("insert into public.office_tidy_items(org_id,request_id,file_id,file_name,mode) values ($1,$2,'f1','a.pdf','proposal')", [org, req]), 'one plan line per file');
await assert.rejects(db.query("insert into public.office_tidy_items(org_id,request_id,file_id,file_name,mode,status) values ($1,$2,'f2','b','auto','deleted')", [org, req]));
await assert.rejects(db.query("update public.office_tidy_requests set status='deleting' where id=$1", [req]));
await db.query("insert into public.office_tidy_preferences(org_id,key,dest_folder_id,weight) values ($1,'client:nova','F1',3)", [org]);
await assert.rejects(db.query("insert into public.office_tidy_preferences(org_id,key,dest_folder_id,weight) values ($1,'client:x','F1',99)", [org]));
for (const t of ['office_tidy_requests', 'office_tidy_items', 'office_tidy_preferences']) {
  const r = (await db.query(`select has_table_privilege('anon','public.${t}','SELECT') a, has_table_privilege('authenticated','public.${t}','SELECT') b,
    has_table_privilege('service_role','public.${t}','UPDATE') c, has_table_privilege('service_role','public.${t}','DELETE') d`)).rows[0];
  assert.deepEqual(r, { a: false, b: false, c: true, d: false }, t);
}
console.log('Tidy SQL passed: idempotent, one plan line per file, no delete status, bounded learning, RLS on, no public access, no delete.');
await db.close();
