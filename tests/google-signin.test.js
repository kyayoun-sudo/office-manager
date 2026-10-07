import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, SCOPES, resetGoogleConnectionCache } from '../lib/google-connection.js';
import { completeGoogleReturn, sessionForEmail, signinUrl } from '../lib/google-signin.js';

const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs', OAUTH_STATE_SECRET: 'st', VERCEL_ENV: 'production' };
const req = (state) => ({ headers: { host: 'app.example' }, query: { code: 'c', state } });
const googleFetch = (scope) => async (url) => url.includes('/token')
  ? { ok: true, json: async () => ({ access_token: 'a', refresh_token: '1//r', scope }) }
  : { ok: true, json: async () => ({ email: 'Boss@Firm.com', email_verified: true, name: 'Boss' }) };
const auth = async (path) => {
  if (path === 'admin/users') return { status: 200, data: { id: 'u1' } };
  if (path === 'admin/generate_link') return { status: 200, data: { properties: { hashed_token: 'h' } } };
  if (path === 'verify') return { status: 200, data: { refresh_token: 'sess-r', access_token: 'sess-a', user: { id: 'u1' } } };
  return { status: 404 };
};

test('Continuer avec Google, first person of the firm: owner, firm Google access kept, sent to the setup', async () => {
  resetGoogleConnectionCache();
  const writes = [];
  const fetchRows = async (path, o = {}) => { if (o.method === 'POST') writes.push([path, JSON.parse(o.body)]); return []; };
  process.env.OAUTH_STATE_SECRET = 'st'; process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'k';
  const st = makeState('org1', '', env, Date.now(), '/parametres.html', 'signin');
  const out = await completeGoogleReturn('org1', req(st), { env, fetchImpl: googleFetch('openid email ' + SCOPES.drive), fetchRows, authCall: auth });
  assert.match(out.__redirect, /^\/login\.html#refresh_token=sess-r&setup=1$/);
  const user = writes.find(w => w[0] === 'office_app_users')[1][0];
  assert.equal(user.role, 'owner'); assert.equal(user.active, true); assert.equal(user.email, 'boss@firm.com');
  const conn = writes.find(w => w[0].startsWith('office_google_connections'))[1][0];
  assert.equal(conn.google_email, 'boss@firm.com'); assert.notEqual(conn.refresh_token_enc, '1//r', 'stored encrypted');
});

test('Continuer avec Google, firm already set up: no account created here (waits for a role), no Google access stored', async () => {
  const writes = [];
  const fetchRows = async (path, o = {}) => { if (o.method === 'POST') writes.push(path); return path.includes('auth_user_id=eq.') ? [] : [{ auth_user_id: 'owner' }]; };
  const st = makeState('org1', '', env, Date.now(), '/parametres.html', 'signin');
  const out = await completeGoogleReturn('org1', req(st), { env, fetchImpl: googleFetch('openid email'), fetchRows, authCall: auth });
  assert.equal(out.__redirect, '/login.html#refresh_token=sess-r');
  assert.deepEqual(writes, []);
});

test('sign-in page asks Drive + Gmail only while the firm has no account', async () => {
  const empty = await signinUrl('org1', req(''), { env, fetchRows: async () => [] });
  assert.match(empty.url, /drive/); assert.match(empty.url, /access_type=offline/);
  const later = await signinUrl('org1', req(''), { env, fetchRows: async () => [{ auth_user_id: 'x' }] });
  assert.doesNotMatch(later.url, /drive/);
});

test('session for a Google-verified e-mail: an existing user is reused', async () => {
  const s = await sessionForEmail('a@b.c', 'A', async (p) => p === 'admin/users' ? { status: 422 } : auth(p));
  assert.equal(s.refresh_token, 'sess-r');
});
