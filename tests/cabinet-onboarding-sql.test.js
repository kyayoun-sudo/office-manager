import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('provisioning is transactional, repeatable and inaccessible to browser roles', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table public.office_organizations(id uuid primary key, slug text unique, name text, executive_name text, executive_email text);
      create table public.office_app_users(org_id uuid references office_organizations(id), auth_user_id uuid, email text, display_name text, role text, active boolean, primary key(org_id,auth_user_id));
      create table public.office_memberships(org_id uuid references office_organizations(id), user_id uuid references auth.users(id), role text, active boolean, primary key(org_id,user_id));
      grant usage on schema public to service_role, anon, authenticated;
      grant select,insert on office_organizations,office_app_users,office_memberships to service_role;
      insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
    `);
    const sql = await readFile(new URL('../db/cabinet-onboarding.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const call = id => db.query(`select public.office_create_cabinet($1::uuid,'owner@example.test','Cabinet','Responsable') as cabinet`, [id]);
    await db.exec('set role service_role');
    const a = (await call('11111111-1111-4111-8111-111111111111')).rows[0].cabinet;
    const retry = (await call('11111111-1111-4111-8111-111111111111')).rows[0].cabinet;
    const b = (await call('22222222-2222-4222-8222-222222222222')).rows[0].cabinet;
    assert.equal(a.created, true); assert.equal(retry.created, false);
    assert.equal(a.org_id, retry.org_id); assert.notEqual(a.org_id, b.org_id);
    assert.equal((await db.query('select count(*)::int as n from office_organizations')).rows[0].n, 2);
    // FK failure rolls back the org and application account as one unit.
    await assert.rejects(call('33333333-3333-4333-8333-333333333333'));
    assert.equal((await db.query('select count(*)::int as n from office_organizations')).rows[0].n, 2);
    for (const role of ['anon','authenticated']) {
      await db.exec('reset role; set role ' + role);
      await assert.rejects(call('11111111-1111-4111-8111-111111111111'), /permission denied/);
      await assert.rejects(db.query('select * from office_cabinet_registrations'), /permission denied/);
    }
  } finally { await db.close(); }
});
