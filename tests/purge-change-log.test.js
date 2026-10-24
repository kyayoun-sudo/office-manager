// « Fermer = effacer » (Paul, 2026-10-11) still holds with the mission change log (db/mission-shared-memory.sql):
// its triggers write a line when a mission is deleted, so the purge must leave no line of the firm behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('erasing a firm leaves nothing in the mission change log', async () => {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
  await db.exec(readFileSync(new URL('../db/INSTALL_TOUT.sql', import.meta.url), 'utf8'));
  const org = '11111111-1111-4111-8111-111111111111';
  await db.exec(`insert into public.office_organizations(id, slug, name) values ('${org}', 'essai', 'Cabinet essai');
    insert into public.office_missions(org_id, name) values ('${org}', 'Audit 2025');
    update public.office_missions set status = 'fieldwork' where org_id = '${org}';`);
  const before = await db.query('select count(*)::int n from public.office_mission_change_log where org_id = $1', [org]);
  assert.ok(before.rows[0].n > 0, 'the triggers record mission changes');
  await db.query('select public.office_purge_firm($1, $2)', [org, 'EFFACER ' + org]);
  const after = await db.query('select count(*)::int n from public.office_mission_change_log where org_id = $1', [org]);
  assert.equal(after.rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from public.office_missions where org_id = $1', [org])).rows[0].n, 0);
});
