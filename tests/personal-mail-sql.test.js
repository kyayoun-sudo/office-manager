import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('personal mail tables are additive, private, idempotent and cascaded on disconnect', async () => {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec('create table office_app_users (org_id uuid not null, auth_user_id uuid not null, primary key(org_id, auth_user_id));');
  const sql = await readFile(new URL('../db/personal-mail.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  const org = '11111111-1111-4111-8111-111111111111';
  const user = '22222222-2222-4222-8222-222222222222';
  const other = '33333333-3333-4333-8333-333333333333';
  await db.exec("insert into office_app_users values ('" + org + "','" + user + "'),('" + org + "','" + other + "');");
  const inserted = await db.query("insert into office_email_accounts(org_id,user_id,provider,email,refresh_token_enc) values ('" +
    org + "','" + user + "','google','person@example.test','encrypted-test-only') returning id");
  const id = inserted.rows[0].id;
  await db.exec("insert into office_personal_mail_items(org_id,user_id,mailbox_id,provider_message_id,folder,subject) values ('" +
    org + "','" + user + "','" + id + "','provider-1','inbox','sample');");
  await db.exec("insert into office_personal_mail_drafts(org_id,user_id,mailbox_id,recipient,subject,body) values ('" +
    org + "','" + user + "','" + id + "','friend@example.test','subject','draft');");
  const policy = await db.query("select relrowsecurity from pg_class where relname='office_email_accounts'");
  assert.equal(policy.rows[0].relrowsecurity, true);
  const publicPrivileges = await db.query("select has_table_privilege('authenticated','office_email_accounts','SELECT') as allowed");
  assert.equal(publicPrivileges.rows[0].allowed, false);
  await db.exec("delete from office_email_accounts where id='" + id + "'");
  for (const table of ['office_personal_mail_items', 'office_personal_mail_drafts']) {
    const result = await db.query('select count(*)::int as n from ' + table);
    assert.equal(result.rows[0].n, 0, table + ' follows mailbox deletion');
  }
  await db.close();
});
