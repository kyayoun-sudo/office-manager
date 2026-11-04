// The firm's own accounts on its PostgreSQL (VPS, no Supabase): same answers as Supabase Auth, passwords taken over keep working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { localAuthCall, userFromAccessToken, verifyLinkRedirect, checkPasswordHash } from '../lib/local-auth.js';
import { createSqlRest } from '../lib/sql-rest.js';
import { login, refreshSession, signUp, confirmSignupLink } from '../lib/accounts.js';
import { sessionForEmail } from '../lib/google-signin.js';

const ROOT = new URL('../', import.meta.url);
const ORG = '6c2fe1e2-3daf-4795-9d09-3fdb95e52942';
let shared;
// Confirmation succeeded: either a session, or « waiting for a role from the owner » (a firm that already has accounts).
const confirmed = p => p.then(x => x, e => { if (e.message === 'ACCOUNT_PENDING') return { pending: true }; throw e; });
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

test('sign-up: the e-mail link + the password chosen at sign-up confirm the address, never the link alone', async () => {
  const { call, mails, rest, db } = await setup();
  const out = await signUp(ORG, { email: 'nouveau@cabinet.test', password: 'Mot-de-passe-3', display_name: 'Nouveau' },
    { authCall: call, fetchRows: rest, env: { OFFICE_MANAGER_MULTI_CABINET: 'on' } });
  assert.equal(out.confirmation_required, true);
  assert.equal(mails.length, 1);
  assert.ok(mails[0].link.startsWith('https://office.cabinet.test/auth/v1/verify?type=signup&token=om_lk_'));
  assert.equal((await call('token?grant_type=password', { body: { email: 'nouveau@cabinet.test', password: 'Mot-de-passe-3' } })).status, 400, 'not confirmed yet');
  const token = new URL(mails[0].link).searchParams.get('token');
  // Opening the link only leads to the login page, nothing is confirmed.
  assert.equal(await verifyLinkRedirect({ token }, { db }), '/login.html#confirm_token=' + token);
  assert.equal((await call('token?grant_type=password', { body: { email: 'nouveau@cabinet.test', password: 'Mot-de-passe-3' } })).status, 400, 'still not confirmed');
  await assert.rejects(confirmSignupLink(ORG, { token, email: 'nouveau@cabinet.test', password: 'faux' }, { authCall: call, fetchRows: rest }), /INVALID_CREDENTIALS/);
  const session = await confirmed(confirmSignupLink(ORG, { token, email: 'nouveau@cabinet.test', password: 'Mot-de-passe-3' }, { authCall: call, fetchRows: rest }));
  assert.ok(session.refresh_token || session.pending);
  await assert.rejects(confirmSignupLink(ORG, { token, email: 'nouveau@cabinet.test', password: 'Mot-de-passe-3' }, { authCall: call, fetchRows: rest }), /LINK_EXPIRED/, 'a link serves once');
  assert.equal((await call('token?grant_type=password', { body: { email: 'nouveau@cabinet.test', password: 'Mot-de-passe-3' } })).status, 200);
  // Signing up again with a confirmed address says nothing about it and sends nothing.
  assert.equal((await call('signup', { body: { email: 'nouveau@cabinet.test', password: 'Autre-mot-9' } })).status, 200);
  assert.equal(mails.length, 1);
});

test('security: an intruder who registers someone else’s address never gets in (before or after the owner), logout, too many tries', async () => {
  const { call, mails, db, rest } = await setup();
  const link = () => new URL(mails.at(-1).link).searchParams.get('token');
  // 1. The intruder registers the address first, then the real person confirms it with Google: the intruder's password is gone.
  await call('signup', { body: { email: 'victime@cabinet.test', password: 'Intrus-mot-1' } });
  const intruderLink = link();
  const s = await sessionForEmail('victime@cabinet.test', 'Victime', call);
  assert.ok(s.refresh_token);
  assert.equal((await call('token?grant_type=password', { body: { email: 'victime@cabinet.test', password: 'Intrus-mot-1' } })).status, 400);
  assert.match(await verifyLinkRedirect({ token: intruderLink }, { db }), /otp_expired/, 'the intruder’s link is void');

  // 2. The real person signs up, THEN the intruder signs up the same address: both links reach the real person's mailbox.
  await call('signup', { body: { email: 'deux@cabinet.test', password: 'Vrai-mot-1' } });
  const ownerLink = link();
  await call('signup', { body: { email: 'deux@cabinet.test', password: 'Intrus-mot-2' } });
  const lateIntruderLink = link();
  // The person opens the intruder's (newest) e-mail by mistake: with THEIR password it confirms nothing.
  await assert.rejects(confirmSignupLink(ORG, { token: lateIntruderLink, email: 'deux@cabinet.test', password: 'Vrai-mot-1' }, { authCall: call, fetchRows: rest }), /INVALID_CREDENTIALS/);
  // Their own link still works, and voids the intruder's.
  await confirmed(confirmSignupLink(ORG, { token: ownerLink, email: 'deux@cabinet.test', password: 'Vrai-mot-1' }, { authCall: call, fetchRows: rest }));
  await assert.rejects(confirmSignupLink(ORG, { token: lateIntruderLink, email: 'deux@cabinet.test', password: 'Intrus-mot-2' }, { authCall: call, fetchRows: rest }), /LINK_EXPIRED/);
  assert.equal((await call('token?grant_type=password', { body: { email: 'deux@cabinet.test', password: 'Intrus-mot-2' } })).status, 400);
  const ok = await call('token?grant_type=password', { body: { email: 'deux@cabinet.test', password: 'Vrai-mot-1' } });
  assert.equal(ok.status, 200);

  // 3. Logout ends the session on the server.
  const { logout } = await import('../lib/accounts.js');
  await logout({ refresh_token: ok.data.refresh_token }, { authCall: call, local: true });
  assert.equal((await call('token?grant_type=refresh_token', { body: { refresh_token: ok.data.refresh_token } })).status, 400);
  assert.equal(await userFromAccessToken(ok.data.access_token, db), null);

  // 4. Wrong passwords (security review 2026-11-04): counted per caller address + account, reserved BEFORE the check.
  const attacker = '198.51.100.7', owner = '203.0.113.20';
  // Ten tries sent at the same time from the attacker's address: never more than 10 reach the password check.
  const burst = await Promise.all(Array.from({ length: 15 }, (_, i) => call('token?grant_type=password', { body: { email: 'deux@cabinet.test', password: 'faux-' + i }, ip: attacker })));
  assert.equal(burst.filter(r => r.status === 429).length, 5);
  assert.equal((await call('token?grant_type=password', { body: { email: 'deux@cabinet.test', password: 'Vrai-mot-1' }, ip: attacker })).status, 429, 'blocked from the attacker address');
  await assert.rejects(login(ORG, { email: 'deux@cabinet.test', password: 'Vrai-mot-1' }, { authCall: call, fetchRows: rest, ip: attacker }), /TOO_MANY_ATTEMPTS/);
  // The real person, from their own address, is not locked out by the stranger.
  for (let i = 0; i < 12; i++) assert.equal((await call('token?grant_type=password', { body: { email: 'deux@cabinet.test', password: 'Vrai-mot-1' }, ip: owner })).status, 200, 'a right password gives its try back');
});

test('« Continuer avec Google »: lib/google-signin.js opens the session on the local accounts (user, single-use link, verify)', async () => {
  const { call } = await setup();
  const s = await sessionForEmail('google@cabinet.test', 'Personne Google', call);
  assert.ok(s.refresh_token && s.user.email_confirmed_at);
  const again = await sessionForEmail('google@cabinet.test', 'Personne Google', call);
  assert.equal(again.user.id, s.user.id, 'the same person, never a second account');
});

test('wrong-password limits: a right password never refills the address counter; a cap per account over all addresses; IPv6 per /64', async () => {
  const { call } = await setup();
  const { _addressKey, _resetFailures } = await import('../lib/local-auth.js');
  _resetFailures();
  assert.equal(_addressKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(_addressKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'), '2001:db8:1:2::/64');
  assert.equal(_addressKey('::ffff:192.0.2.9'), '192.0.2.9');
  await call('admin/users', { admin: true, body: { email: 'stuff@cabinet.test', password: 'Mon-compte-1', email_confirm: true } });
  // One address tries many accounts, logging in to its own account in between: its address counter keeps growing (50 max).
  const ip = '192.0.2.50';
  let refused = 0;
  for (let i = 0; i < 60; i++) {
    const r = await call('token?grant_type=password', { body: { email: 'cible' + i + '@cabinet.test', password: 'x' }, ip });
    if (r.status === 429) refused++;
    if (i % 5 === 0) await call('token?grant_type=password', { body: { email: 'stuff@cabinet.test', password: 'Mon-compte-1' }, ip });
  }
  assert.ok(refused >= 10, 'the address is stopped although it logs in to its own account between tries (' + refused + ')');
  // One account tried from many addresses: over the account cap (100) it is paced (doubling waits), except from an address
  // that has already signed in to it — the real person keeps getting in from her usual place.
  _resetFailures();
  assert.equal((await call('token?grant_type=password', { body: { email: 'stuff@cabinet.test', password: 'Mon-compte-1' }, ip: '203.0.113.99' })).status, 200);
  let stopped = 0;
  for (let i = 0; i < 110; i++) if ((await call('token?grant_type=password', { body: { email: 'stuff@cabinet.test', password: 'faux' }, ip: '198.51.100.' + (i % 250) })).status === 429) stopped++;
  assert.equal(stopped, 9, 'after 100 wrong tries from strangers, the account is paced');
  assert.equal((await call('token?grant_type=password', { body: { email: 'stuff@cabinet.test', password: 'Mon-compte-1' }, ip: '192.0.2.200' })).status, 429, 'a new address waits');
  assert.equal((await call('token?grant_type=password', { body: { email: 'stuff@cabinet.test', password: 'Mon-compte-1' }, ip: '203.0.113.99' })).status, 200, 'the usual address is not paced');
  _resetFailures();
});
