import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
const sql = await readFile(new URL('../db/app-users.sql', import.meta.url), 'utf8');
await db.exec(sql); await db.exec(sql);
const org = '00000000-0000-0000-0000-000000000001';
const u1 = '00000000-0000-0000-0000-0000000000a1', u2 = '00000000-0000-0000-0000-0000000000a2';
await db.query("insert into public.office_app_users(org_id,auth_user_id,email,display_name,role) values ($1,$2,'paul@taty.info','Paul','owner')", [org, u1]);
assert.equal((await db.query('select role, active from public.office_app_users')).rows[0].active, true);
await assert.rejects(db.query("insert into public.office_app_users(org_id,auth_user_id,email,display_name) values ($1,$2,'paul@taty.info','Doublon')", [org, u2]));
await assert.rejects(db.query("insert into public.office_app_users(org_id,auth_user_id,email,display_name,role) values ($1,$2,'x@taty.info','X','admin')", [org, u2]));
await assert.rejects(db.query("insert into public.office_app_users(org_id,auth_user_id,email,display_name) values ($1,$2,'pas-un-mail','X')", [org, u2]));
const rights = (await db.query(`select has_table_privilege('anon','public.office_app_users','SELECT') a,
 has_table_privilege('authenticated','public.office_app_users','SELECT') b,
 has_table_privilege('service_role','public.office_app_users','UPDATE') c,
 has_table_privilege('service_role','public.office_app_users','DELETE') d`)).rows[0];
assert.deepEqual(rights, { a: false, b: false, c: true, d: false });
console.log('App users SQL passed: idempotent, unique e-mail per firm, valid roles, RLS on, no public access, no delete.');
await db.close();
