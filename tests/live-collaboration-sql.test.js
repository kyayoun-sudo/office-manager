import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
test('collaboration migration is repeatable and inaccessible to browser roles', async () => {
 const db = new PGlite();
 try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table office_chat_messages(id uuid primary key);');
  const sql = await readFile(new URL('../db/live-collaboration.sql', import.meta.url), 'utf8');
  await db.exec(sql); await db.exec(sql);
  for (const table of ['office_presence', 'office_chat_reads']) {
   for (const role of ['anon', 'authenticated']) {
    const r = await db.query(`select has_table_privilege('${role}','${table}','SELECT') as allowed`);
    assert.equal(r.rows[0].allowed, false);
   }
   assert.equal((await db.query(`select relrowsecurity from pg_class where relname='${table}'`)).rows[0].relrowsecurity, true);
  }
 } finally { await db.close(); }
});
