// Creating a firm on the full installation (db/INSTALL_TOUT.sql): one transaction, repeatable, never from a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('creating a firm is transactional, repeatable per name, several per person, never from a browser', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
    await db.exec(await readFile(new URL('../db/INSTALL_TOUT.sql', import.meta.url), 'utf8'));
    const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
    const call = (id, name, tz = 'Africa/Abidjan') => db.query("select public.office_create_cabinet($1::uuid,'owner@example.test',$2,'Responsable',$3) as c", [id, name, tz]);
    await db.exec('set role service_role');
    const a = (await call(A, 'Cabinet Alpha')).rows[0].c;
    const retry = (await call(A, '  cabinet   alpha ')).rows[0].c;
    const second = (await call(A, 'Cabinet Beta')).rows[0].c;
    const other = (await call(B, 'Cabinet Alpha')).rows[0].c;
    assert.equal(a.created, true); assert.equal(retry.created, false); assert.equal(retry.org_id, a.org_id);
    assert.notEqual(second.org_id, a.org_id, 'one person may create several firms');
    assert.notEqual(other.org_id, a.org_id, 'another person never receives the firm of someone else');
    const owners = (await db.query('select org_id, role, active from office_app_users where auth_user_id = $1', [A])).rows;
    assert.equal(owners.length, 2); assert.ok(owners.every(r => r.role === 'owner' && r.active));
    assert.equal((await db.query('select timezone from office_organizations where id = $1', [a.org_id])).rows[0].timezone, 'Africa/Abidjan');
    await assert.rejects(call(A, ''), /INVALID_CABINET/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec('reset role; set role ' + role);
      await assert.rejects(call(A, 'X'), /permission denied/);
      await assert.rejects(db.query('select * from office_invitations'), /permission denied/);
    }
  } finally { await db.close(); }
});
