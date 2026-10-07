import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
const sql = await readFile(new URL('../db/training.sql', import.meta.url), 'utf8');
await db.exec(sql); await db.exec(sql); // idempotent
const org = '00000000-0000-0000-0000-000000000001';
const c = (await db.query("insert into public.office_training_campaigns(org_id,start_date) values ($1,'2026-10-07') returning id, status, days, run_time, mode", [org])).rows[0];
assert.deepEqual({ ...c, id: undefined }, { id: undefined, status: 'active', days: 5, run_time: '07:00', mode: 'drive' });
await assert.rejects(db.query("insert into public.office_training_campaigns(org_id,start_date) values ($1,'2026-10-08')", [org]), 'one active campaign per firm');
await assert.rejects(db.query("update public.office_training_campaigns set run_time='7h'"));
const k = (await db.query("insert into public.office_training_cases(org_id,campaign_id,day,ref,kind,agent_key,title,status) values ($1,$2,1,'F0','fake','sika','Jour 1','to_create') returning id", [org, c.id])).rows[0];
await assert.rejects(db.query("insert into public.office_training_cases(org_id,campaign_id,day,ref,kind,agent_key,title) values ($1,$2,1,'F0','fake','sika','x')", [org, c.id]), 'one case per day and ref');
await assert.rejects(db.query("insert into public.office_training_cases(org_id,campaign_id,day,ref,kind,agent_key,title) values ($1,$2,1,'F9','fake','inconnu','x')", [org, c.id]));
await assert.rejects(db.query("update public.office_training_cases set score=120"));
await db.query("insert into public.office_training_items(org_id,campaign_id,case_id,drive_file_id,kind) values ($1,$2,$3,'folder-abc','mission_folder')", [org, c.id, k.id]);
await assert.rejects(db.query("insert into public.office_training_items(org_id,campaign_id,drive_file_id,kind) values ($1,$2,'folder-abc','file')", [org, c.id]), 'a Drive object is registered once');
await db.query("update public.office_training_campaigns set status='done'");
await db.query("insert into public.office_training_campaigns(org_id,start_date) values ($1,'2026-10-20')", [org]);
for (const t of ['office_training_campaigns', 'office_training_cases', 'office_training_items']) {
  const r = (await db.query(`select has_table_privilege('anon','public.${t}','SELECT') a, has_table_privilege('authenticated','public.${t}','SELECT') u, has_table_privilege('service_role','public.${t}','DELETE') d, has_table_privilege('service_role','public.${t}','UPDATE') w`)).rows[0];
  assert.deepEqual(r, { a: false, u: false, d: false, w: true }, t);
}
console.log('Training SQL passed: idempotent, one active campaign, one case per day/ref, valid agents and scores, Drive registry unique, no public access, no delete.');
await db.close();
