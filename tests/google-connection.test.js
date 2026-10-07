import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, readState, encryptToken, decryptToken, startConnect, finishConnect, loadGoogleConnection, googleStatus, disconnectGoogle,
  connectionAccessToken, resetGoogleConnectionCache, firmConnected, firmDriveKind, redirectUri, SCOPES } from '../lib/google-connection.js';
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

import { parseDriveLink, setFirmDrive, firmDriveId, loadFirmDrive } from '../lib/google-connection.js';
import { configuredDriveId } from '../lib/google-drive.js';

test('Drive du cabinet: pasted link checked with Google, saved for the firm, then used by the agents; the real Drive stays protected in a preview', async () => {
  assert.equal(parseDriveLink('https://drive.google.com/drive/folders/0ABcdEFghIJklMN?usp=sharing'), '0ABcdEFghIJklMN');
  assert.equal(parseDriveLink('https://drive.google.com/drive/u/0/folders/1x2y3z4w5v6u'), '1x2y3z4w5v6u');
  assert.throws(() => parseDriveLink('mon drive'), /DRIVE_LINK_INVALID/);
  resetGoogleConnectionCache();
  const w = world();
  const firm = [];
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_firm_drive')) { if (o.method === 'POST') { firm.splice(0, 1, JSON.parse(o.body)[0]); return []; } return firm; }
    return w.fetchRows(path, o);
  };
  const fetchImpl = async (url, o) => {
    if (url.includes('/drives/0ATEST')) return { ok: true, json: async () => ({ id: '0ATEST0000', name: 'TATY share drive' }) };
    if (url.includes('/drives/0AREAL')) return { ok: true, json: async () => ({ id: '0AREAL0000', name: 'TATY ET ASSOCIES PERSONNEL' }) };
    if (url.includes('/drives/')) return { ok: false, json: async () => ({}) };
    if (url.includes('/files/1folder')) return { ok: true, json: async () => ({ id: '1folder0000', driveId: '0ATEST0000' }) };
    if (url.includes('/files/1mydrive')) return { ok: true, json: async () => ({ id: '1mydrive000', name: 'Cabinet Paul', mimeType: 'application/vnd.google-apps.folder' }) };
    return w.fetchImpl(url, o);
  };
  const saved = { ...process.env }; Object.assign(process.env, ENV);
  try {
    const state = new URL(startConnect('org-1', REQ, ENV).url).searchParams.get('state');
    await finishConnect('org-1', { ...REQ, query: { code: 'c', state } }, { env: ENV, fetchRows, fetchImpl });
    await loadGoogleConnection('org-1', { env: ENV, fetchRows });
    const r = await setFirmDrive('org-1', { body: { link: 'https://drive.google.com/drive/folders/1folder0000' }, account: { display_name: 'Paul' } }, { env: ENV, fetchRows, fetchImpl });
    assert.deepEqual(r, { drive_id: '0ATEST0000', drive_name: 'TATY share drive', kind: 'drive' }, 'a folder link gives its shared drive');
    assert.equal(firmDriveId(), '0ATEST0000');
    assert.equal(configuredDriveId(), '0ATEST0000', 'the agents now work on the chosen Drive');
    const my = await setFirmDrive('org-1', { body: { link: 'https://drive.google.com/drive/u/0/folders/1mydrive000' }, account: { display_name: 'Paul' } }, { env: ENV, fetchRows, fetchImpl });
    assert.deepEqual(my, { drive_id: '1mydrive000', drive_name: 'Cabinet Paul', kind: 'folder' }, 'a « Mon Drive » folder becomes the firm’s Drive');
    assert.equal(firmDriveId(), '1mydrive000'); assert.equal(firmDriveKind(), 'folder');
    assert.equal(firm[0].drive_id, 'folder:1mydrive000');
    await assert.rejects(setFirmDrive('org-1', { body: { link: '0AREAL0000' } }, { env: { ...ENV, VERCEL_ENV: 'preview', TEST_SOURCE_DRIVE_ID: '0AREAL0000' }, fetchRows, fetchImpl }), /TEST_MODE_REAL_DRIVE_REFUSED/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    resetGoogleConnectionCache();
  }
});

test('existing connection of 2026-10-05 (Supabase taty-google-oauth) is used directly by ITS firm only; no other firm borrows it, not even in a preview', async () => {
  resetGoogleConnectionCache();
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_google_connections') || path.startsWith('office_firm_drive')) return [];
    if (path === 'rpc/office_get_google_drive_secret') return JSON.parse(o.body).p_org_id === 'real-org' ? [{ client_id: 'old-cid', client_secret: 'old-cs', refresh_token: '1//old' }] : [];
    if (path.startsWith('office_integration_connections')) return [{ account_email: 'paulkomenan@taty.info', granted_scopes: [SCOPES.drive, SCOPES.sheets], status: 'connected' }];
    return [];
  };
  let body = null;
  const fetchImpl = async (url, o) => { body = new URLSearchParams(o.body); return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }; };
  const c = await loadGoogleConnection('real-org', { env: { VERCEL_ENV: 'production' }, fetchRows });
  assert.equal(c.email, 'paulkomenan@taty.info');
  assert.equal(await connectionAccessToken({ env: {}, fetchImpl }), 'tok');
  assert.equal(body.get('client_id'), 'old-cid', 'the client of that connection is used');
  resetGoogleConnectionCache();
  assert.equal(await loadGoogleConnection('test-org', { env: { VERCEL_ENV: 'production' }, fetchRows }), null, 'production: never another firm’s access');
  resetGoogleConnectionCache();
  const t = await loadGoogleConnection('test-org', { env: { VERCEL_ENV: 'preview', TEST_RUN_FORBIDDEN_ORG_IDS: 'real-org' }, fetchRows });
  assert.equal(t, null, 'preview: each firm connects its own Google (2026-10-07)');
  resetGoogleConnectionCache();
});

test('a firm connected in the app comes first; the old relay connection does not count as the firm’s own', async () => {
  resetGoogleConnectionCache();
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_google_connections')) return [];
    if (path.startsWith('office_firm_drive')) return [];
    if (path === 'rpc/office_get_google_drive_secret') return [{ client_id: 'c', client_secret: 's', refresh_token: '1//x' }];
    if (path.startsWith('office_integration_connections')) return [{ account_email: 'a@b.c', granted_scopes: [SCOPES.drive], status: 'connected' }];
    return [];
  };
  await loadGoogleConnection('org-a', { env: { VERCEL_ENV: 'production' }, fetchRows });
  assert.equal(firmConnected(), false, 'legacy relay connection');
  resetGoogleConnectionCache();
});

test('the refresh token can be sealed with OAUTH_STATE_SECRET when no dedicated key is set', () => {
  const env = { OAUTH_STATE_SECRET: 'state-only' };
  const sealed = encryptToken('1//abc', env);
  assert.equal(decryptToken(sealed, env), '1//abc');
  assert.throws(() => encryptToken('x', {}), /TOKEN_ENCRYPTION_KEY_MISSING/);
});

test('« Mon Drive » folder as the firm’s Drive: a target is accepted only if it sits under that folder', async () => {
  const { insideFolder } = await import('../lib/google-drive.js');
  const tree = { a: 'b', b: 'root', x: 'y', y: 'other' };
  const meta = async (id) => ({ id, parents: tree[id] ? [tree[id]] : [] });
  assert.equal(await insideFolder('a', 'root', meta), true);
  assert.equal(await insideFolder('x', 'root', meta), false);
  assert.equal(await insideFolder('root', 'root', meta), true);
});

test('« Tout mon Google Drive »: memory folder 00_OFFICE_MANAGER found or created in the chosen shared drive', async () => {
  resetGoogleConnectionCache();
  const firm = [];
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_google_connections')) return [{ google_email: 'p@x.com', refresh_token_enc: encryptToken('1//r', ENV), scopes: [SCOPES.drive] }];
    if (path.startsWith('office_firm_drive')) { if (o.method === 'POST') { firm.splice(0, 1, JSON.parse(o.body)[0]); return []; } return firm; }
    return [];
  };
  let created = null;
  const fetchImpl = async (url, o = {}) => {
    if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    if (url.includes('/drives/0ASHARE')) return { ok: true, json: async () => ({ id: '0ASHARE', name: 'TATY share drive' }) };
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?') && o.method === 'POST') { created = JSON.parse(o.body); return { ok: true, json: async () => ({ id: 'mem1', name: created.name }) }; }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: false, json: async () => ({}) };
  };
  await loadGoogleConnection('org-1', { env: ENV, fetchRows });
  await assert.rejects(setFirmDrive('org-1', { body: { all: true } }, { env: ENV, fetchRows, fetchImpl }), /HOME_DRIVE_REQUIRED/);
  const r = await setFirmDrive('org-1', { body: { all: true, home: '0ASHARE' } }, { env: ENV, fetchRows, fetchImpl });
  assert.equal(r.kind, 'all'); assert.equal(r.drive_id, 'mem1');
  assert.deepEqual(created, { name: '00_OFFICE_MANAGER', mimeType: 'application/vnd.google-apps.folder', parents: ['0ASHARE'] }, 'memory in the firm shared drive');
  assert.equal(firm[0].drive_id, 'all:mem1'); assert.match(firm[0].drive_name, /TATY share drive \/ 00_OFFICE_MANAGER/);
  assert.equal(firmDriveKind(), 'all'); assert.equal(firmDriveId(), 'mem1');
  resetGoogleConnectionCache();
});
