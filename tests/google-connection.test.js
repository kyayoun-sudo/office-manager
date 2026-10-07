import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, readState, encryptToken, decryptToken, startConnect, finishConnect, loadGoogleConnection, googleStatus, disconnectGoogle,
  connectionAccessToken, resetGoogleConnectionCache, redirectUri, SCOPES } from '../lib/google-connection.js';
import { gmailToken, mailConfigured } from '../lib/agent-mail.js';
import { googleAccessToken, directGoogleAccess } from '../lib/google-drive.js';

const ENV = { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'csecret', OAUTH_STATE_SECRET: 'state-secret', OWNER_APPROVAL_SECRET: 'owner-secret' };
const REQ = { headers: { host: 'office.example.app', 'x-forwarded-proto': 'https' }, body: { by: 'Paul' } };

test('state: signed, bound to the firm, expires; token encrypted at rest', () => {
  const s = makeState('org-1', 'Paul', ENV, 1000);
  assert.equal(readState(s, 'org-1', ENV, 2000).by, 'Paul');
  assert.throws(() => readState(s, 'org-2', ENV, 2000), /OAUTH_STATE_OTHER_FIRM/);
  assert.throws(() => readState(s, 'org-1', ENV, 1000 + 16 * 60000), /OAUTH_STATE_EXPIRED/);
  assert.throws(() => readState(s.slice(0, -2) + 'xx', 'org-1', ENV, 2000), /OAUTH_STATE_INVALID/);
  assert.throws(() => readState(s, 'org-1', { ...ENV, OAUTH_STATE_SECRET: 'other' }, 2000), /OAUTH_STATE_INVALID/);
  const sealed = encryptToken('1//refresh-token', ENV);
  assert.ok(!sealed.includes('refresh'));
  assert.equal(decryptToken(sealed, ENV), '1//refresh-token');
  assert.throws(() => decryptToken(sealed, { OWNER_APPROVAL_SECRET: 'wrong' }));
});

test('connect: Google consent address asks Drive + Gmail, offline, back to the app’s own callback', () => {
  const r = startConnect('org-1', REQ, ENV);
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://office.example.app/oauth/google/callback');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  for (const sc of [SCOPES.drive, SCOPES.gmailSend, SCOPES.gmailRead]) assert.ok(u.searchParams.get('scope').includes(sc));
  assert.equal(readState(u.searchParams.get('state'), 'org-1', ENV).by, 'Paul');
  assert.throws(() => startConnect('org-1', REQ, {}), /GOOGLE_CLIENT_NOT_CONFIGURED/);
  assert.equal(redirectUri(REQ, { GOOGLE_OAUTH_REDIRECT_URI: 'https://old.example/cb' }), 'https://office.example.app/oauth/google/callback', 'an unrelated old setting is ignored');
});

function world() {
  const rows = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'POST') { const r = JSON.parse(o.body)[0]; const i = rows.findIndex(x => x.org_id === r.org_id); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push(r); return []; }
    if (o.method === 'PATCH') { rows.forEach(r => Object.assign(r, JSON.parse(o.body))); return []; }
    return rows.filter(r => path.includes('org_id=eq.' + r.org_id) && !r.revoked_at);
  };
  const calls = [];
  const fetchImpl = async (url, o = {}) => {
    calls.push(url);
    if (url.includes('oauth2.googleapis.com/token')) {
      const b = new URLSearchParams(o.body);
      if (b.get('grant_type') === 'authorization_code') return { ok: true, json: async () => ({ access_token: 'at1', refresh_token: '1//rt', scope: ['openid', 'email', SCOPES.drive, SCOPES.sheets, SCOPES.gmailSend, SCOPES.gmailRead].join(' ') }) };
      return { ok: true, json: async () => ({ access_token: 'fresh-' + b.get('refresh_token'), expires_in: 3600 }) };
    }
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ email: 'PaulKomenan@taty.info', email_verified: true }) };
    if (url.includes('/drives?')) return { ok: true, json: async () => ({ drives: [{ id: 'D1', name: 'TATY ET ASSOCIES PERSONNEL' }] }) };
    if (url.includes('/revoke')) return { ok: true, json: async () => ({}) };
    throw new Error('unexpected ' + url);
  };
  return { rows, fetchRows, fetchImpl, calls };
}

test('callback: code exchanged, refresh token stored ENCRYPTED, then used for Drive and for Gmail of that same mailbox only', async () => {
  resetGoogleConnectionCache();
  const w = world();
  const saved = { ...process.env }; Object.assign(process.env, ENV);
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  try {
    const state = new URL(startConnect('org-1', REQ, ENV).url).searchParams.get('state');
    await assert.rejects(finishConnect('org-1', { ...REQ, query: { error: 'access_denied' } }, { env: ENV, fetchRows: w.fetchRows, fetchImpl: w.fetchImpl }), /GOOGLE_REFUSED/);
    const r = await finishConnect('org-1', { ...REQ, query: { code: 'c0de', state } }, { env: ENV, fetchRows: w.fetchRows, fetchImpl: w.fetchImpl });
    assert.equal(r.email, 'paulkomenan@taty.info');
    assert.equal(w.rows[0].connected_by, 'Paul');
    assert.ok(!JSON.stringify(w.rows).includes('1//rt'), 'never stored in clear');

    assert.equal(directGoogleAccess(), false, 'nothing loaded yet');
    await loadGoogleConnection('org-1', { env: ENV, fetchRows: w.fetchRows });
    assert.equal(directGoogleAccess(), true, 'Drive access through the connection');
    assert.equal(mailConfigured({}), true);
    assert.equal(await connectionAccessToken({ env: ENV, fetchImpl: w.fetchImpl }), 'fresh-1//rt');
    assert.equal(await gmailToken('paulkomenan@taty.info', {}, w.fetchImpl), 'fresh-1//rt');
    await assert.rejects(gmailToken('autre@taty.info', {}, w.fetchImpl), /MAIL_SENDER_NOT_CONNECTED_ACCOUNT/);

    const st = await googleStatus('org-1', { env: ENV, fetchRows: w.fetchRows, fetchImpl: w.fetchImpl, req: REQ });
    assert.deepEqual([st.connected, st.email, st.drive, st.gmail_send, st.check], [true, 'paulkomenan@taty.info', true, true, 'ok']);
    assert.deepEqual(st.shared_drives.map(d => d.name), ['TATY ET ASSOCIES PERSONNEL']);

    await disconnectGoogle('org-1', { env: ENV, fetchRows: w.fetchRows, fetchImpl: w.fetchImpl });
    assert.ok(w.calls.some(u => u.includes('/revoke')), 'revoked at Google');
    assert.equal(w.rows[0].refresh_token_enc, 'revoked');
    assert.equal(await loadGoogleConnection('org-1', { env: ENV, fetchRows: w.fetchRows }), null);
    assert.equal(directGoogleAccess(), false);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    resetGoogleConnectionCache();
  }
});
