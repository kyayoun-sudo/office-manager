// The firm's own accounts on its PostgreSQL (VPS, no Supabase): same answers as Supabase Auth, passwords taken over keep working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { localAuthCall, userFromAccessToken, verifyLinkRedirect, checkPasswordHash } from '../lib/local-auth.js';
import { createSqlRest } from '../lib/sql-rest.js';
import { login, refreshSession, signUp } from '../lib/accounts.js';
import { sessionForEmail } from '../lib/google-signin.js';

const ROOT = new URL('../', import.meta.url);
const ORG = '6c2fe1e2-3daf-4795-9d09-3fdb95e52942';
let shared;
async function setup() {
  if (shared) return shared;
  const pg = new PGlite();
  for (const f of ['db/vps-compat.sql', 'db/INSTALL_TOUT.sql', 'db/vps-auth.sql']) await pg.exec(readFileSync(new URL(f, ROOT), 'utf8'));
  const db = { role: 'service_role', query: async (s, p) => (await pg.query(s, p)).rows, transaction: fn => pg.transaction(tx => fn(async (s, p) => (await tx.query(s, p)).rows)) };
  await pg.query(`insert into office_organizations (id, slug, name) values ($1, 'pilote', 'Cabinet')`, [ORG]);
  const mails = [];
  const env = { DATABASE_URL: 'postgres://test', OFFICE_MANAGER_PUBLIC_URL: 'https://office.cabinet.test' };
  const call = (p, o) => localAuthCall(p, o, { db, env, sendMail: m => { mails.push(m); } });
  shared = { pg, db, call, mails, env, rest: createSqlRest(db).run };
  return shared;
}

test('a password taken over from Supabase (bcrypt) still works, and is re-hashed (scrypt) at the first login', async () => {
  const { pg, db, call } = await setup();
  const { default: bcrypt } = await import('bcryptjs');
  const id = '44444444-4444-4444-8444-444444444444';
  await pg.query(`insert into auth.users (id, email, encrypted_password, email_confirmed_at) values ($1, 'paul@cabinet.test', $2, now())`, [id, bcrypt.hashSync('Ancien-mot-2026', 10)]);
  assert.equal((await call('token?grant_type=password', { body: { email: 'paul@cabinet.test', password: 'faux' } })).status, 400);
  const r = await call('token?grant_type=password', { body: { email: 'PAUL@cabinet.test', password: 'Ancien-mot-2026' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.id, id);
  const [u] = (await pg.query(`select encrypted_password from auth.users where id = $1`, [id])).rows;
  assert.match(u.encrypted_password, /^scrypt\$/);
  assert.ok(await checkPasswordHash('Ancien-mot-2026', u.encrypted_password));
  assert.equal((await userFromAccessToken(r.data.access_token, db)).id, id);
  // Refresh: a new access token, the same refresh token (several tabs refreshing at once keep the session).
  const again = await call('token?grant_type=refresh_token', { body: { refresh_token: r.data.refresh_token } });
  assert.equal(again.status, 200);
  assert.equal(again.data.refresh_token, r.data.refresh_token);
  assert.equal(await userFromAccessToken(r.data.access_token, db), null, 'the previous access token no longer opens anything');
  assert.equal((await userFromAccessToken(again.data.access_token, db)).id, id);
  assert.equal((await call('token?grant_type=refresh_token', { body: { refresh_token: 'om_rt_inconnu' } })).status, 400);
});

test('accounts.login / refreshSession run unchanged on the local accounts and the SQL translator', async () => {
  const { call, rest } = await setup();
  const created = await call('admin/users', { admin: true, body: { email: 'marie@cabinet.test', password: 'Mot-de-passe-1', email_confirm: true } });
  assert.equal(created.status, 200);
  assert.equal((await call('admin/users', { admin: true, body: { email: 'marie@cabinet.test', password: 'x', email_confirm: true } })).status, 422);
  await rest('office_app_users', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ org_id: ORG, auth_user_id: created.data.id, email: 'marie@cabinet.test', display_name: 'Marie', role: 'manager', active: true }]) });
  const s = await login(ORG, { email: 'marie@cabinet.test', password: 'Mot-de-passe-1' }, { authCall: call, fetchRows: rest });
  assert.equal(s.user.role, 'manager');
  assert.ok(s.refresh_token && s.access_token);
  const r = await refreshSession(ORG, { refresh_token: s.refresh_token }, { authCall: call, fetchRows: rest });
  assert.equal(r.user.email, 'marie@cabinet.test');
  await assert.rejects(login(ORG, { email: 'marie@cabinet.test', password: 'faux' }, { authCall: call, fetchRows: rest }), /INVALID_CREDENTIALS/);
  // Password reset by an administrator: every open session ends.
  assert.equal((await call('admin/users/' + created.data.id, { method: 'PUT', admin: true, body: { password: 'Nouveau-mot-2' } })).status, 200);
  await assert.rejects(refreshSession(ORG, { refresh_token: s.refresh_token }, { authCall: call, fetchRows: rest }), /SESSION_EXPIRED/);
});

test('sign-up: the address is confirmed by the e-mail link, never on the person\'s behalf', async () => {
  const { call, mails, rest } = await setup();
  const out = await signUp(ORG, { email: 'nouveau@cabinet.test', password: 'Mot-de-passe-3', display_name: 'Nouveau' },
    { authCall: call, fetchRows: rest, env: { OFFICE_MANAGER_MULTI_CABINET: 'on' } });
  assert.equal(out.confirmation_required, true);
  assert.equal(mails.length, 1);
  assert.match(mails[0].link, /^https:\/\/office\.cabinet\.test\/auth\/v1\/verify\?type=signup&token=om_lk_/);
  assert.equal((await call('token?grant_type=password', { body: { email: 'nouveau@cabinet.test', password: 'Mot-de-passe-3' } })).status, 400, 'not confirmed yet');
  const { db } = await setup();
  const token = new URL(mails[0].link).searchParams.get('token');
  const back = await verifyLinkRedirect({ token }, { db });
  assert.match(back, /^\/login\.html#access_token=om_at_.+&refresh_token=om_rt_/);
  assert.match(await verifyLinkRedirect({ token }, { db }), /otp_expired/, 'a link serves once');
  assert.equal((await call('token?grant_type=password', { body: { email: 'nouveau@cabinet.test', password: 'Mot-de-passe-3' } })).status, 200);
  // Signing up again with a confirmed address says nothing about it and sends nothing.
  assert.equal((await call('signup', { body: { email: 'nouveau@cabinet.test', password: 'Autre-mot-9' } })).status, 200);
  assert.equal(mails.length, 1);
});

test('security: an address registered by someone else cannot keep their password (pre-hijacking), re-sign-up, logout', async () => {
  const { call, mails, db } = await setup();
  // Someone signs up with the address of another person and chooses a password; the address is not confirmed.
  await call('signup', { body: { email: 'victime@cabinet.test', password: 'Intrus-mot-1' } });
  // The real person later uses « Continuer avec Google »: Google proves the address.
  const s = await sessionForEmail('victime@cabinet.test', 'Victime', call);
  assert.ok(s.refresh_token);
  assert.equal((await call('token?grant_type=password', { body: { email: 'victime@cabinet.test', password: 'Intrus-mot-1' } })).status, 400, 'the intruder password does not open the account');
  // The intruder's confirmation link, still in the person's mailbox, no longer does anything.
  const intruderLink = new URL(mails.at(-1).link).searchParams.get('token');
  assert.match(await verifyLinkRedirect({ token: intruderLink }, { db }), /otp_expired/);

  // Two sign-ups on an unconfirmed address: only the newest link confirms, with ITS password.
  await call('signup', { body: { email: 'deux@cabinet.test', password: 'Premier-mot-1' } });
  const first = new URL(mails.at(-1).link).searchParams.get('token');
  await call('signup', { body: { email: 'deux@cabinet.test', password: 'Second-mot-2' } });
  const second = new URL(mails.at(-1).link).searchParams.get('token');
  assert.match(await verifyLinkRedirect({ token: first }, { db }), /otp_expired/);
  assert.match(await verifyLinkRedirect({ token: second }, { db }), /access_token=/);
  assert.equal((await call('token?grant_type=password', { body: { email: 'deux@cabinet.test', password: 'Premier-mot-1' } })).status, 400);
  const ok = await call('token?grant_type=password', { body: { email: 'deux@cabinet.test', password: 'Second-mot-2' } });
  assert.equal(ok.status, 200);

  // Logout ends the session on the server: the refresh token no longer works.
  const { logout } = await import('../lib/accounts.js');
  await logout({ refresh_token: ok.data.refresh_token }, { authCall: call, local: true });
  assert.equal((await call('token?grant_type=refresh_token', { body: { refresh_token: ok.data.refresh_token } })).status, 400);
  assert.equal(await userFromAccessToken(ok.data.access_token, db), null);
});

test('« Continuer avec Google »: lib/google-signin.js opens the session on the local accounts (user, single-use link, verify)', async () => {
  const { call } = await setup();
  const s = await sessionForEmail('google@cabinet.test', 'Personne Google', call);
  assert.ok(s.refresh_token && s.user.email_confirmed_at);
  const again = await sessionForEmail('google@cabinet.test', 'Personne Google', call);
  assert.equal(again.user.id, s.user.id, 'the same person, never a second account');
});
