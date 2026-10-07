import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { buildInstallSql } from '../scripts/build-install-sql.mjs';
import { TABLES } from '../lib/readiness.js';
const sql = readFileSync(new URL('../db/INSTALL_TOUT.sql', import.meta.url), 'utf8');
assert.equal(sql, buildInstallSql(), 'db/INSTALL_TOUT.sql is out of date: run node scripts/build-install-sql.mjs');
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
await db.exec(sql); await db.exec(sql); // twice: safe to re-run
for (const [t] of TABLES) {
  const r = (await db.query(`select to_regclass('public.${t}') is not null as ok, has_table_privilege('anon','public.${t}','SELECT') as anon`)).rows[0];
  assert.deepEqual(r, { ok: true, anon: false }, t);
}
console.log('INSTALL_TOUT.sql passed: up to date, runs twice, creates the ' + TABLES.length + ' tables checked by the Mise en service, none public.');
await db.close();
