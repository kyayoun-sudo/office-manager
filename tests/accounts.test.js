import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { login, refreshSession, bootstrapOwner, manageAccount, checkPassword, cleanEmail, signUp, claimOwner } from '../lib/accounts.js';
import { handleApp, ROUTES } from '../api/app.js';

const UID = '44444444-4444-4444-4444-444444444444';
const UID2 = '55555555-5555-5555-5555-555555555555';
process.env.OFFICE_MANAGER_ACCESS_TOKEN = 'pilot';
process.env.OFFICE_MANAGER_OWNER_TOKEN = 'owner';

function db(rows) {
  const calls = [];
  const fetchRows = async (path, o = {}) => {
    calls.push({ path, method: o.method || 'GET', body: o.body });
    if ((o.method || 'GET') !== 'GET') return [];
    if (path.includes('role=eq.owner')) return rows.filter(r => r.role === 'owner' && r.active);
    const id = (path.match(/auth_user_id=eq\.([0-9a-f-]+)/) || [])[1];
    return id ? rows.filter(r => r.auth_user_id === id) : rows;
  };
  return { fetchRows, calls };
}
const auth = (status, data) => async () => ({ status, data });
const tokens = id => ({ refresh_token: 'r1', user: { id } });

test('accounts: password and e-mail rules', () => {
  assert.equal(cleanEmail(' Paul@TATY.info '), 'paul@taty.info');
  assert.throws(() => cleanEmail('nope'), /INVALID_EMAIL/);
  assert.throws(() => checkPassword('court1'), /WEAK_PASSWORD/);
  assert.throws(() => checkPassword('sanschiffres'), /WEAK_PASSWORD/);
  assert.equal(checkPassword('motdepasse2026'), 'motdepasse2026');
});

test('login: right password + active account -> session with tokens by role', async () => {
  const { fetchRows } = db([{ auth_user_id: UID, email: 'paul@taty.info', display_name: 'Paul', role: 'partner', active: true }]);
  const s = await login('org-1', { email: 'paul@taty.info', password: 'x' }, { authCall: auth(200, tokens(UID)), fetchRows });
  assert.equal(s.user.role, 'partner');
  assert.equal(s.pilot_token, 'pilot');
  assert.equal(s.owner_token, 'owner', 'managing partners get the owner token');
  const { fetchRows: f2 } = db([{ auth_user_id: UID, email: 'a@taty.info', display_name: 'A', role: 'collaborator', active: true }]);
  const c = await login('org-1', { email: 'a@taty.info', password: 'x' }, { authCall: auth(200, tokens(UID)), fetchRows: f2 });
  assert.equal(c.owner_token, null, 'collaborators never get the owner token');
});

test('login: wrong password, unknown or deactivated account are refused', async () => {
  const { fetchRows } = db([{ auth_user_id: UID, email: 'p@taty.info', display_name: 'P', role: 'owner', active: false }]);
  await assert.rejects(login('org-1', { email: 'p@taty.info', password: 'bad' }, { authCall: auth(400, {}), fetchRows }), /INVALID_CREDENTIALS/);
  // Inactive (waiting for the owner, or deactivated): still refused, with a clear reason.
  await assert.rejects(login('org-1', { email: 'p@taty.info', password: 'x' }, { authCall: auth(200, tokens(UID)), fetchRows }), /ACCOUNT_PENDING/);
  await assert.rejects(login('org-1', { email: 'p@taty.info', password: 'x' }, { authCall: auth(200, tokens(UID2)), fetchRows }), /ACCOUNT_NOT_ALLOWED/);
  await assert.rejects(login('org-1', { email: 'p@taty.info', password: 'x' }, { authCall: auth(429, {}), fetchRows }), /TOO_MANY_ATTEMPTS/);
});

test('session: refresh re-checks the account; expired token logs out', async () => {
  const { fetchRows } = db([{ auth_user_id: UID, email: 'p@taty.info', display_name: 'P', role: 'owner', active: true }]);
  const s = await refreshSession('org-1', { refresh_token: 'r0' }, { authCall: auth(200, tokens(UID)), fetchRows });
  assert.equal(s.refresh_token, 'r1');
  await assert.rejects(refreshSession('org-1', { refresh_token: 'r0' }, { authCall: auth(400, {}), fetchRows }), /SESSION_EXPIRED/);
  await assert.rejects(refreshSession('org-1', {}, { authCall: auth(200, tokens(UID)), fetchRows }), /SESSION_EXPIRED/);
});

test('first owner: needs the owner code and only while no account exists', async () => {
  const req = (code, body) => ({ headers: { 'x-office-manager-owner-token': code }, body });
  const body = { email: 'paul@taty.info', password: 'motdepasse2026', display_name: 'Paul' };
  await assert.rejects(bootstrapOwner('org-1', req('bad', body), { authCall: auth(200, {}), fetchRows: db([]).fetchRows }), /OWNER_ONLY/);
  const existing = db([{ auth_user_id: UID, role: 'owner', active: true }]);
  await assert.rejects(bootstrapOwner('org-1', req('owner', body), { authCall: auth(200, {}), fetchRows: existing.fetchRows }), /ACCOUNTS_ALREADY_EXIST/);
  const rows = []; const empty = db(rows);
  const call = async (path) => path === 'admin/users' ? { status: 200, data: { id: UID } } : { status: 200, data: tokens(UID) };
  const wrapped = async (path, o = {}) => { if (o.method === 'POST' && path === 'office_app_users') rows.push(JSON.parse(o.body)[0]); return empty.fetchRows(path, o); };
  const s = await bootstrapOwner('org-1', req('owner', body), { authCall: call, fetchRows: wrapped });
  assert.equal(rows[0].role, 'owner');
  assert.equal(s.user.role, 'owner');
});

test('accounts: the last active owner cannot be removed', async () => {
  const one = db([{ auth_user_id: UID, email: 'p@taty.info', display_name: 'P', role: 'owner', active: true }]);
  await assert.rejects(manageAccount('org-1', { action: 'deactivate', auth_user_id: UID }, { fetchRows: one.fetchRows, authCall: auth(200, {}) }), /LAST_OWNER/);
  await assert.rejects(manageAccount('org-1', { action: 'set_role', auth_user_id: UID, role: 'collaborator' }, { fetchRows: one.fetchRows, authCall: auth(200, {}) }), /LAST_OWNER/);
  const two = db([{ auth_user_id: UID, role: 'owner', active: true }, { auth_user_id: UID2, role: 'owner', active: true }]);
  const r = await manageAccount('org-1', { action: 'deactivate', auth_user_id: UID }, { fetchRows: two.fetchRows, authCall: auth(200, {}) });
  assert.equal(r.active, false);
  assert.ok(two.calls.some(c => c.method === 'PATCH' && c.path.includes('auth_user_id=eq.' + UID)));
  assert.ok(!two.calls.some(c => c.method === 'DELETE'), 'accounts are never deleted');
});

test('routes: login routes are public, account management is owner-only', async () => {
  assert.equal(ROUTES.login.POST.public, true);
  assert.equal(ROUTES.session.POST.public, true);
  assert.equal(ROUTES.users.GET.ownerOnly, true);
  assert.equal(ROUTES.users.POST.ownerOnly, true);
  process.env.DEFAULT_ORG_ID = 'org-1';
  await assert.rejects(handleApp({ method: 'GET', query: { route: 'users' }, headers: { 'x-office-manager-token': 'pilot' } }), /OWNER_ONLY/);
  await assert.rejects(handleApp({ method: 'GET', query: { route: 'search' }, headers: {} }), /UNAUTHORIZED/);
});

test('pages: every app page redirects to login without a session and offers logout', () => {
  const theme = readFileSync(new URL('../assets/brand-theme.js', import.meta.url), 'utf8');
  assert.match(theme, /login\.html/);
  assert.match(theme, /Se déconnecter/);
  assert.match(theme, /localStorage/);
  for (const f of ['accueil.html', 'mission.html', 'validations.html', 'assistant.html', 'recherche.html', 'parametres.html', 'login.html']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(src, /\/assets\/brand-theme\.js/, f + ' loads the session script');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), f + ' must not inject HTML');
  }
});

test('sign-up: anyone creates an account, it has NO access until the owner gives a role; the owner claims with the owner code', async () => {
  const rows = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'POST') { rows.push(...JSON.parse(o.body)); return []; }
    if (o.method === 'PATCH') { const id = (path.match(/auth_user_id=eq\.([0-9a-f-]+)/) || [])[1]; rows.filter(r => r.auth_user_id === id).forEach(r => Object.assign(r, JSON.parse(o.body))); return []; }
    const id = (path.match(/auth_user_id=eq\.([0-9a-f-]+)/) || [])[1];
    return id ? rows.filter(r => r.auth_user_id === id) : rows;
  };
  const users = {}; // the auth server
  const authCall = async (path, o = {}) => {
    if (path === 'admin/users') { if (users[o.body.email]) return { status: 422, data: {} }; users[o.body.email] = { id: Object.keys(users).length ? UID2 : UID, password: o.body.password }; return { status: 200, data: { id: users[o.body.email].id } }; }
    if (path.startsWith('token?grant_type=password')) { const u = users[o.body.email]; return u && u.password === o.body.password ? { status: 200, data: { refresh_token: 'r', user: { id: u.id } } } : { status: 400, data: {} }; }
    return { status: 400, data: {} };
  };
  rows.push({ auth_user_id: '99999999-9999-9999-9999-999999999999', email: 'owner@taty.info', role: 'owner', active: true }); // the firm already has its owner
  const r = await signUp('org-1', { display_name: 'Paul', email: 'kyayoun@gmail.com', password: 'motdepasse2026' }, { authCall, fetchRows });
  assert.deepEqual(r, { created: true, pending: true, email: 'kyayoun@gmail.com' });
  assert.equal(rows[1].active, false);
  await assert.rejects(login('org-1', { email: 'kyayoun@gmail.com', password: 'motdepasse2026' }, { authCall, fetchRows }), /ACCOUNT_PENDING/);
  await assert.rejects(signUp('org-1', { display_name: 'X', email: 'kyayoun@gmail.com', password: 'autrechose99' }, { authCall, fetchRows }), /EMAIL_ALREADY_USED_WRONG_PASSWORD/, 'nobody takes an address over');
  await assert.rejects(signUp('org-1', { display_name: 'Paul', email: 'kyayoun@gmail.com', password: 'motdepasse2026' }, { authCall, fetchRows }), /ACCOUNT_ALREADY_EXISTS/);

  const req = (code, body) => ({ headers: { 'x-office-manager-owner-token': code }, body });
  await assert.rejects(claimOwner('org-1', req('wrong', { email: 'kyayoun@gmail.com', password: 'motdepasse2026' }), { authCall, fetchRows }), /OWNER_ONLY/);
  await assert.rejects(claimOwner('org-1', req('owner', { email: 'kyayoun@gmail.com', password: 'mauvais' }), { authCall, fetchRows }), /INVALID_CREDENTIALS/);
  const s = await claimOwner('org-1', req('owner', { email: 'kyayoun@gmail.com', password: 'motdepasse2026' }), { authCall, fetchRows });
  assert.equal(s.user.role, 'owner');
  assert.equal(s.owner_token, 'owner');
  assert.equal(rows[1].active, true);
  assert.ok(ROUTES.signup.POST.public && ROUTES['claim-owner'].POST.public);
});

import { oauthLogin, authStartUrl } from '../lib/accounts.js';

test('Continuer avec Google: session re-checked with Supabase; first person of a new firm = owner; others wait for a role', async () => {
  const rows = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'POST') { rows.push(...JSON.parse(o.body)); return []; }
    const id = (path.match(/auth_user_id=eq\.([0-9a-f-]+)/) || [])[1];
    return id ? rows.filter(r => r.auth_user_id === id) : rows;
  };
  const people = { 'rt-paul': { id: UID, email: 'kyayoun@gmail.com', user_metadata: { full_name: 'Paul Komenan' } }, 'rt-yvan': { id: UID2, email: 'yvan@taty.info', user_metadata: {} } };
  const authCall = async (path, o) => people[o.body.refresh_token] ? { status: 200, data: { refresh_token: 'new', access_token: 'a', user: people[o.body.refresh_token] } } : { status: 400, data: {} };
  await assert.rejects(oauthLogin('org-1', { refresh_token: 'forged' }, { authCall, fetchRows, env: {} }), /SESSION_EXPIRED/);
  const s = await oauthLogin('org-1', { refresh_token: 'rt-paul' }, { authCall, fetchRows, env: {} });
  assert.equal(s.user.role, 'owner', 'first person of the firm');
  assert.equal(s.user.display_name, 'Paul Komenan');
  await assert.rejects(oauthLogin('org-1', { refresh_token: 'rt-yvan' }, { authCall, fetchRows, env: {} }), /ACCOUNT_PENDING/);
  assert.deepEqual(rows.map(r => [r.email, r.role, r.active]), [['kyayoun@gmail.com', 'owner', true], ['yvan@taty.info', 'collaborator', false]]);
  // FIRST_OWNER_EMAILS limits who may become the first owner.
  const rows2 = [];
  const f2 = async (path, o = {}) => { if (o.method === 'POST') { rows2.push(...JSON.parse(o.body)); return []; } const id = (path.match(/auth_user_id=eq\.([0-9a-f-]+)/) || [])[1]; return id ? rows2.filter(r => r.auth_user_id === id) : rows2; };
  await assert.rejects(oauthLogin('org-2', { refresh_token: 'rt-yvan' }, { authCall, fetchRows: f2, env: { FIRST_OWNER_EMAILS: 'kyayoun@gmail.com' } }), /ACCOUNT_PENDING/);
  assert.match(authStartUrl('google', 'https://app.example/login.html', { SUPABASE_URL: 'https://x.supabase.co' }), /^https:\/\/x\.supabase\.co\/auth\/v1\/authorize\?provider=google&redirect_to=https%3A%2F%2Fapp\.example%2Flogin\.html$/);
  assert.throws(() => authStartUrl('evil', 'x', { SUPABASE_URL: 'https://x' }), /PROVIDER_NOT_SUPPORTED/);
});

test('a new firm: the first person who signs up becomes the owner, no code; the next ones wait', async () => {
  const rows = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'POST') { rows.push(...JSON.parse(o.body)); return []; }
    const id = (path.match(/auth_user_id=eq\.([0-9a-f-]+)/) || [])[1];
    return id ? rows.filter(r => r.auth_user_id === id) : rows;
  };
  const users = {};
  const authCall = async (path, o = {}) => {
    if (path === 'admin/users') { users[o.body.email] = { id: Object.keys(users).length ? UID2 : UID, password: o.body.password }; return { status: 200, data: { id: users[o.body.email].id } }; }
    const u = users[o.body.email]; return u && u.password === o.body.password ? { status: 200, data: { refresh_token: 'r', user: { id: u.id } } } : { status: 400, data: {} };
  };
  const first = await signUp('org-9', { display_name: 'Awa', email: 'awa@cabinet.ci', password: 'motdepasse2026' }, { authCall, fetchRows });
  assert.equal(first.owner, true);
  assert.equal(first.session.user.role, 'owner');
  assert.equal(first.session.owner_token, 'owner', 'the owner can configure right away');
  const second = await signUp('org-9', { display_name: 'Koffi', email: 'koffi@cabinet.ci', password: 'motdepasse2026' }, { authCall, fetchRows });
  assert.equal(second.pending, true);
});
