import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
const sql = await readFile(new URL('../db/action-decisions.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql); // idempotent

const org = '00000000-0000-0000-0000-000000000001';
const act = '00000000-0000-0000-0000-0000000000a1';
const hash = 'a'.repeat(64);
await db.query("insert into public.office_action_decisions(org_id,action_id,decision,content_hash,action_snapshot) values ($1,$2,'defer',$3,'{}')", [org, act, hash]);
await db.query("insert into public.office_action_decisions(org_id,action_id,decision,note,content_hash,action_snapshot) values ($1,$2,'approve','ok',$3,'{}')", [org, act, hash]);
assert.equal((await db.query('select count(*)::int n from public.office_action_decisions')).rows[0].n, 2);

await assert.rejects(db.query("insert into public.office_action_decisions(org_id,action_id,decision,content_hash,action_snapshot) values ($1,$2,'execute',$3,'{}')", [org, act, hash]));
await assert.rejects(db.query("insert into public.office_action_decisions(org_id,action_id,decision,content_hash,action_snapshot) values ($1,$2,'approve','short','{}')", [org, act]));
await assert.rejects(db.query("insert into public.office_action_decisions(org_id,action_id,decision,content_hash,action_snapshot) values ($1,$2,'approve',$3,'[]')", [org, act, hash]));

const rights = (await db.query(`select
  has_table_privilege('anon','public.office_action_decisions','SELECT') anon_read,
  has_table_privilege('authenticated','public.office_action_decisions','INSERT') user_insert,
  has_table_privilege('service_role','public.office_action_decisions','INSERT') backend_insert,
  has_table_privilege('service_role','public.office_action_decisions','UPDATE') backend_update,
  has_table_privilege('service_role','public.office_action_decisions','DELETE') backend_delete`)).rows[0];
assert.deepEqual(rights, { anon_read: false, user_insert: false, backend_insert: true, backend_update: false, backend_delete: false });
assert.equal((await db.query("select relrowsecurity from pg_class where relname='office_action_decisions'")).rows[0].relrowsecurity, true);

console.log('Action decisions SQL passed: idempotent, append-only journal, validated decisions and hashes, RLS on, no public access.');
await db.close();
