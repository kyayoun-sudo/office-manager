import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
const sql = await readFile(new URL('../db/org-branding.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(sql); // idempotent

const org = '00000000-0000-0000-0000-000000000001';
const png = 'data:image/png;base64,iVBORw0KGgo=';
await db.query('insert into public.office_org_branding(org_id,firm_name,primary_color,logo_data_url) values ($1,$2,$3,$4)', [org, 'TATY', '#0E5A52', png]);
await db.query(`insert into public.office_org_branding(org_id,firm_name,primary_color) values ($1,'TATY & Associés','#1F3A68')
  on conflict (org_id) do update set firm_name=excluded.firm_name, primary_color=excluded.primary_color`, [org]);
const row = (await db.query('select firm_name, primary_color, logo_data_url from public.office_org_branding')).rows[0];
assert.deepEqual(row, { firm_name: 'TATY & Associés', primary_color: '#1F3A68', logo_data_url: png });

const other = '00000000-0000-0000-0000-000000000002';
await assert.rejects(db.query("insert into public.office_org_branding(org_id,firm_name) values ($1,'  ')", [other]));
await assert.rejects(db.query("insert into public.office_org_branding(org_id,firm_name,primary_color) values ($1,'X','red')", [other]));
await assert.rejects(db.query("insert into public.office_org_branding(org_id,firm_name,logo_data_url) values ($1,'X','data:image/svg+xml;base64,PHN2Zz4=')", [other]));

const rights = (await db.query(`select
  has_table_privilege('anon','public.office_org_branding','SELECT') anon_read,
  has_table_privilege('authenticated','public.office_org_branding','SELECT') user_read,
  has_table_privilege('service_role','public.office_org_branding','SELECT') backend_read,
  has_table_privilege('service_role','public.office_org_branding','UPDATE') backend_update,
  has_table_privilege('service_role','public.office_org_branding','DELETE') backend_delete`)).rows[0];
assert.deepEqual(rights, { anon_read: false, user_read: false, backend_read: true, backend_update: true, backend_delete: false });
const rls = (await db.query("select relrowsecurity from pg_class where relname='office_org_branding'")).rows[0].relrowsecurity;
assert.equal(rls, true);

console.log('Branding SQL passed: idempotent, one row per organisation, validated colours and logos, RLS on, no public access, no delete.');
await db.close();
