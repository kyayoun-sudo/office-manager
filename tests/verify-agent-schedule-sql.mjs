import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for (const f of ['agent-schedule.sql', 'tidy.sql']) {
  const sql = await readFile(new URL('../db/' + f, import.meta.url), 'utf8');
  await db.exec(sql); await db.exec(sql);
}
const org = '00000000-0000-0000-0000-000000000001';
await db.query('insert into public.office_agent_schedule(org_id) values ($1)', [org]);
const s = (await db.query('select enabled, orpailleur_times, sika_weekday from public.office_agent_schedule')).rows[0];
assert.deepEqual(s, { enabled: false, orpailleur_times: ['08:00', '12:00', '20:00'], sika_weekday: 5 });
await db.query("insert into public.office_agent_passes(org_id,agent_key,slot) values ($1,'orpailleur','2026-10-07 08:00')", [org]);
await assert.rejects(db.query("insert into public.office_agent_passes(org_id,agent_key,slot) values ($1,'orpailleur','2026-10-07 08:00')", [org]), 'one pass per slot');
await assert.rejects(db.query("insert into public.office_agent_passes(org_id,agent_key,slot) values ($1,'mission-controller','2026-10-07 09:00')", [org]));
await assert.rejects(db.query("update public.office_agent_schedule set sika_time='25:00'"));
const req = (await db.query("insert into public.office_tidy_requests(org_id,title,since) values ($1,'Passage',now()) returning id", [org])).rows[0].id;
await db.query("insert into public.office_tidy_items(org_id,request_id,file_id,file_name,mode,new_name) values ($1,$2,'f','scan.pdf','proposal','Nova - Contrat.pdf')", [org, req]);
for (const t of ['office_agent_schedule', 'office_agent_passes']) {
  const r = (await db.query(`select has_table_privilege('anon','public.${t}','SELECT') a, has_table_privilege('service_role','public.${t}','DELETE') d`)).rows[0];
  assert.deepEqual(r, { a: false, d: false }, t);
}
console.log('Agent schedule SQL passed: defaults (Orpailleur 08/12/20), one pass per slot, valid agents and times, rename columns, no public access, no delete.');
await db.close();
