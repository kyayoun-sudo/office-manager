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
  // Audit 2026-10-30: the owner code is never handed out; the partner's own session opens the owner routes.
  assert.equal(s.owner_token, null, 'nobody gets the owner code at login');
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

test('routes: login routes are public, account management needs a personal session (owner, partners, IT administrator)', async () => {
  assert.equal(ROUTES.login.POST.public, true);
  assert.equal(ROUTES.session.POST.public, true);
  assert.deepEqual(ROUTES.users.GET.userRoles, ['owner', 'partner', 'it_admin']);
  assert.deepEqual(ROUTES.users.POST.userRoles, ['owner', 'partner', 'it_admin']);
  process.env.DEFAULT_ORG_ID = 'org-1';
  await assert.rejects(handleApp({ method: 'GET', query: { route: 'users' }, headers: { 'x-office-manager-token': 'pilot' } }), /SESSION|UNAUTHORIZED|TOKEN/);
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
  assert.equal(s.owner_token, null);
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
  assert.equal(first.session.owner_token, null, 'the owner configures with their own session');
  const second = await signUp('org-9', { display_name: 'Koffi', email: 'koffi@cabinet.ci', password: 'motdepasse2026' }, { authCall, fetchRows });
  assert.equal(second.pending, true);
});

test('a new firm with FIRST_OWNER_EMAILS: a stranger signing up first is NOT the owner (audit 2026-10-29)', async () => {
  const rows = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'POST') { rows.push(...JSON.parse(o.body)); return []; }
    const id = (path.match(/auth_user_id=eq\.([0-9a-f-]+)/) || [])[1];
    return id ? rows.filter(r => r.auth_user_id === id) : rows;
  };
  const users = {};
  const authCall = async (path, o = {}) => {
    if (path === 'admin/users') { users[o.body.email] = { id: UID, password: o.body.password }; return { status: 200, data: { id: UID } }; }
    return { status: 400, data: {} };
  };
  const env = { FIRST_OWNER_EMAILS: 'boss@cabinet.ci' };
  const r = await signUp('org-7', { display_name: 'Intrus', email: 'intrus@x.ci', password: 'motdepasse2026' }, { authCall, fetchRows, env });
  assert.equal(r.pending, true);
  assert.deepEqual(rows.map(x => [x.email, x.role, x.active]), [['intrus@x.ci', 'collaborator', false]]);
});

test('two sign-ups at the same instant on an empty firm: only one owner (audit 2026-10-29)', async () => {
  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
  const rows = [];
  let clock = 0, seen = 0, release;
  const gate = new Promise(r => { release = r; });
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'POST') { for (const r of JSON.parse(o.body)) rows.push({ ...r, created_at: '2026-10-29T10:00:0' + (clock++) + 'Z' }); return []; }
    if (o.method === 'PATCH') { const id = (path.match(/auth_user_id=eq\.([0-9a-f-]+)/) || [])[1]; rows.filter(r => r.auth_user_id === id).forEach(r => Object.assign(r, JSON.parse(o.body))); return []; }
    // both sign-ups checked « empty firm » before either wrote
    if (/select=auth_user_id&limit=1/.test(path)) { if (++seen === 2) release(); await gate; return []; }
    if (/role=eq\.owner/.test(path)) return rows.filter(r => r.role === 'owner' && r.active).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const id = (path.match(/auth_user_id=eq\.([0-9a-f-]+)/) || [])[1];
    return id ? rows.filter(r => r.auth_user_id === id) : [];
  };
  const users = {};
  const authCall = async (path, o = {}) => {
    if (path === 'admin/users') { const id = o.body.email === 'a@c.ci' ? A : B; users[o.body.email] = { id, password: o.body.password }; return { status: 200, data: { id } }; }
    const u = users[o.body.email]; return u && u.password === o.body.password ? { status: 200, data: { refresh_token: 'r', user: { id: u.id } } } : { status: 400, data: {} };
  };
  const [a, b] = await Promise.all([
    signUp('org-8', { display_name: 'A', email: 'a@c.ci', password: 'motdepasse2026' }, { authCall, fetchRows, env: {} }),
    signUp('org-8', { display_name: 'B', email: 'b@c.ci', password: 'motdepasse2026' }, { authCall, fetchRows, env: {} })
  ]);
  assert.equal([a, b].filter(x => x.owner).length, 1, 'exactly one owner');
  assert.equal(rows.filter(r => r.role === 'owner' && r.active).length, 1);
});

test('production, empty firm, no FIRST_OWNER_EMAILS: nobody becomes owner by being first (audit 2026-10-29)', async () => {
  const rows = [];
  const fetchRows = async (path, o = {}) => { if (o.method === 'POST') { rows.push(...JSON.parse(o.body)); return []; } return []; };
  const authCall = async (path) => path === 'admin/users' ? { status: 200, data: { id: UID } } : { status: 400, data: {} };
  const env = { VERCEL_ENV: 'production' };
  await assert.rejects(signUp('org-p', { display_name: 'X', email: 'x@c.ci', password: 'motdepasse2026' }, { authCall, fetchRows, env }), /FIRST_OWNER_EMAILS_REQUIRED/);
  assert.equal(rows.length, 0, 'no account row written');
  const people = { 'rt-x': { id: UID, email: 'x@c.ci', user_metadata: {} } };
  const oauthCall = async (p, o) => ({ status: 200, data: { refresh_token: 'n', access_token: 'a', user: people[o.body.refresh_token] } });
  await assert.rejects(oauthLogin('org-p', { refresh_token: 'rt-x' }, { authCall: oauthCall, fetchRows, env }), /FIRST_OWNER_EMAILS_REQUIRED/);
  assert.equal(rows.length, 0);
  // once the list is set, the listed address can open the firm
  const ok = await signUp('org-p', { display_name: 'X', email: 'x@c.ci', password: 'motdepasse2026' }, { authCall: async (p) => p === 'admin/users' ? { status: 200, data: { id: UID } } : { status: 200, data: { refresh_token: 'r', user: { id: UID } } }, fetchRows: async (p, o = {}) => { if (o.method === 'POST') { rows.push(...JSON.parse(o.body)); return []; } const id = (p.match(/auth_user_id=eq.([0-9a-f-]+)/) || [])[1]; return id ? rows.filter(r => r.auth_user_id === id) : rows; }, env: { ...env, FIRST_OWNER_EMAILS: 'x@c.ci' } });
  assert.equal(ok.owner, true);
});

test('OFFICE_MANAGER_CONFIRM_SIGNUP=on: the address is confirmed by e-mail, nothing is created or confirmed for the person (audit 2026-10-29)', async () => {
  const rows = [], calls = [];
  const fetchRows = async (path, o = {}) => { if (o.method === 'POST') { rows.push(...JSON.parse(o.body)); return []; } const id = (path.match(/auth_user_id=eq.([0-9a-f-]+)/) || [])[1]; return id ? rows.filter(r => r.auth_user_id === id) : rows; };
  const authCall = async (path, o = {}) => { calls.push(path); return path === 'signup' ? { status: 200, data: { id: UID } } : { status: 400, data: {} }; };
  const env = { OFFICE_MANAGER_CONFIRM_SIGNUP: 'on', FIRST_OWNER_EMAILS: 'boss@c.ci' };
  const r = await signUp('org-q', { display_name: 'Boss', email: 'boss@c.ci', password: 'motdepasse2026' }, { authCall, fetchRows, env });
  assert.equal(r.confirmation_required, true);
  assert.deepEqual(calls, ['signup'], 'no admin/users call: the address is not confirmed for the person');
  assert.equal(rows.length, 0, 'no account row before the confirmation');
  // after clicking the mail, the first login enrols the person (owner: listed address on an empty firm)
  const prev = process.env.OFFICE_MANAGER_CONFIRM_SIGNUP, prevL = process.env.FIRST_OWNER_EMAILS;
  process.env.OFFICE_MANAGER_CONFIRM_SIGNUP = 'on'; process.env.FIRST_OWNER_EMAILS = 'boss@c.ci';
  try {
    const confirmedCall = async (path) => ({ status: 200, data: { refresh_token: 'r', access_token: 'a', user: { id: UID, email: 'boss@c.ci', email_confirmed_at: '2026-10-29T10:00:00Z', user_metadata: { display_name: 'Boss' } } } });
    const s = await login('org-q', { email: 'boss@c.ci', password: 'motdepasse2026' }, { authCall: confirmedCall, fetchRows });
    assert.equal(s.user.role, 'owner');
    assert.deepEqual(rows.map(x => [x.email, x.role, x.active, x.display_name]), [['boss@c.ci', 'owner', true, 'Boss']]);
  } finally { process.env.OFFICE_MANAGER_CONFIRM_SIGNUP = prev; process.env.FIRST_OWNER_EMAILS = prevL; if (prev === undefined) delete process.env.OFFICE_MANAGER_CONFIRM_SIGNUP; if (prevL === undefined) delete process.env.FIRST_OWNER_EMAILS; }
});

import { currentAccount, forgetAccount, _clearAuthCache } from '../lib/user-auth.js';

test('a deactivated account loses its access at once on this instance (audit 2026-10-29)', async () => {
  _clearAuthCache();
  let active = true;
  const deps = { orgId: 'org-c', supabaseUser: async () => ({ id: UID }), fetchRows: async () => [{ auth_user_id: UID, email: 'a@c.ci', role: 'collaborator', active }] };
  const req = { headers: { authorization: 'Bearer ' + 'x'.repeat(40) } };
  assert.equal((await currentAccount(req, deps)).role, 'collaborator');
  active = false;
  assert.equal((await currentAccount(req, deps)).role, 'collaborator', 'still cached');
  forgetAccount(UID);
  await assert.rejects(currentAccount(req, deps), /ACCOUNT_NOT_ALLOWED/);
  _clearAuthCache();
});
