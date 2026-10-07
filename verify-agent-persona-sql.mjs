import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
const sql = await readFile(new URL('../db/agent-persona.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql);
const org = '00000000-0000-0000-0000-000000000001';
await db.query("insert into public.office_agent_persona(org_id,sender_email,aliases,internal_domains) values ($1,'assistant@taty.info','{pbc@taty.info}','{taty.info}')", [org]);
const row = (await db.query('select internal_tone, humor_level, internal_frequency from public.office_agent_persona')).rows[0];
assert.deepEqual(row, { internal_tone: 'nouchi_fun', humor_level: 2, internal_frequency: 'few_per_week' });
const other = '00000000-0000-0000-0000-000000000002';
await assert.rejects(db.query("insert into public.office_agent_persona(org_id,sender_email) values ($1,'pas-un-mail')", [other]));
await assert.rejects(db.query("insert into public.office_agent_persona(org_id,internal_tone) values ($1,'vulgaire')", [other]));
await assert.rejects(db.query("insert into public.office_agent_persona(org_id,humor_level) values ($1,9)", [other]));
const rights = (await db.query(`select
  has_table_privilege('anon','public.office_agent_persona','SELECT') anon_read,
  has_table_privilege('authenticated','public.office_agent_persona','SELECT') user_read,
  has_table_privilege('service_role','public.office_agent_persona','UPDATE') backend_update,
  has_table_privilege('service_role','public.office_agent_persona','DELETE') backend_delete`)).rows[0];
assert.deepEqual(rights, { anon_read: false, user_read: false, backend_update: true, backend_delete: false });
console.log('Agent persona SQL passed: idempotent, defaults, validated mail and tone, RLS on, no public access, no delete.');
await db.close();
