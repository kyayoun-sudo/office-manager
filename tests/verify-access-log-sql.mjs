import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for (const f of ['app-users.sql', 'access-log.sql']) { const sql = await readFile(new URL('../db/' + f, import.meta.url), 'utf8'); await db.exec(sql); await db.exec(sql); }
const org = '00000000-0000-0000-0000-000000000001', u = '00000000-0000-0000-0000-0000000000a1';
await db.query("insert into public.office_app_users(org_id,auth_user_id,email,display_name,role) values ($1,$2,'m@taty.info','M','manager')", [org, u]);
await assert.rejects(db.query("update public.office_app_users set role='boss'"));
await db.query("insert into public.office_access_log(org_id,auth_user_id,email,role,action) values ($1,$2,'m@taty.info','manager','view_team_kpi')", [org, u]);
const r = (await db.query(`select has_table_privilege('anon','public.office_access_log','SELECT') a,
  has_table_privilege('service_role','public.office_access_log','UPDATE') u, has_table_privilege('service_role','public.office_access_log','DELETE') d`)).rows[0];
assert.deepEqual(r, { a: false, u: false, d: false }, 'access log is append-only');
console.log('Access log SQL passed: manager role, append-only journal, no public access.');
await db.close();
