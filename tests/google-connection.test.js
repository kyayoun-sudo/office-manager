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
    assert.deepEqual({ drive_id: r.drive_id, drive_name: r.drive_name, kind: r.kind }, { drive_id: '0ATEST0000', drive_name: 'TATY share drive', kind: 'drive' }, 'a folder link gives its shared drive');
    assert.equal(firmDriveId(), '0ATEST0000');
    assert.equal(configuredDriveId(), '0ATEST0000', 'the agents now work on the chosen Drive');
    const my = await setFirmDrive('org-1', { body: { link: 'https://drive.google.com/drive/u/0/folders/1mydrive000' }, account: { display_name: 'Paul' } }, { env: ENV, fetchRows, fetchImpl });
    assert.deepEqual({ drive_id: my.drive_id, drive_name: my.drive_name, kind: my.kind }, { drive_id: '1mydrive000', drive_name: 'Cabinet Paul', kind: 'folder' }, 'a « Mon Drive » folder becomes the firm’s Drive');
    assert.equal(firmDriveId(), '1mydrive000'); assert.equal(firmDriveKind(), 'folder');
    assert.match(firm[0].drive_id, /^folder:1mydrive000/);
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

test('a reset firm never resurrects a retained legacy secret without an active integration record', async () => {
  for (const record of [null, { status: 'disconnected' }, { status: null }]) {
    resetGoogleConnectionCache(); let secretReads = 0;
    const fetchRows = async path => {
      if (path.startsWith('office_integration_connections')) return record ? [record] : [];
      if (path === 'rpc/office_get_google_drive_secret') { secretReads++; return [{ client_id: 'old', client_secret: 'old', refresh_token: 'retained' }]; }
      return [];
    };
    assert.equal(await loadGoogleConnection('reset-org', { env: ENV, fetchRows }), null);
    assert.equal(secretReads, 0, 'the old secret is not even requested');
    const status = await googleStatus('reset-org', { env: ENV, fetchRows });
    assert.equal(status.connected, false); assert.equal(status.firm_drive, null);
  }
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

test('clean Drive: one copy of each agent file, moved into 00_OFFICE_MANAGER; older copies KEPT renamed, never binned (2026-10-19); nothing searched outside the firm\'s own places', async () => {
  const { consolidateMemory } = await import('../lib/google-connection.js');
  const calls = [];
  const files = { MEM: [], ROOT: [{ id: 'mapOld', name: 'OFFICE_MANAGER_MAP.xlsx', modifiedTime: '2026-10-01' }], OLDMY: [{ id: 'mapNew', name: 'OFFICE_MANAGER_MAP.xlsx', modifiedTime: '2026-10-07' }] };
  const fetchImpl = async (url, o = {}) => {
    calls.push([o.method || 'GET', url, o.body]);
    const u = new URL(url); const qq = u.searchParams.get('q') || '';
    if (qq.includes("Office Manager - mémoire des agents")) return { ok: true, json: async () => ({ files: [{ id: 'OLDMY' }] }) };
    const m = qq.match(/name = '([^']+)' and '([^']+)' in parents/);
    if (m) return { ok: true, json: async () => ({ files: (files[m[2]] || []).filter(f => f.name === m[1]) }) };
    if (qq.includes("'OLDMY' in parents")) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: true, json: async () => ({}) };
  };
  const r = await consolidateMemory('MEM', ['ROOT'], { headers: {} }, fetchImpl);
  assert.deepEqual(r, { moved: ['OFFICE_MANAGER_MAP.xlsx'], binned: [], kept: ['OFFICE_MANAGER_MAP.xlsx'] });
  assert.ok(calls.some(c => c[0] === 'PATCH' && c[1].includes('/files/mapNew') && c[1].includes('addParents=MEM')), 'the newest copy is moved into the memory folder');
  assert.ok(calls.some(c => c[0] === 'PATCH' && c[1].includes('/files/mapOld')), 'the older copy is renamed');
  assert.ok(!calls.some(c => c[0] === 'PATCH' && /mapOld|mapNew/.test(c[1]) && /trashed/.test(String(c[2] || ''))), 'no memory file goes to the bin (an emptied old folder may)');
  assert.ok(!calls.some(c => (new URL(c[1]).searchParams.get('q') || '').match(/^name = '[^']+' and trashed/)), 'never a Drive-wide search');
});

test('primary memory: an existing « TATY_AI_office manager » folder of the drive is used, not a new folder', async () => {
  const { findPrimaryMemory } = await import('../lib/google-connection.js');
  const fetchImpl = async () => ({ ok: true, json: async () => ({ files: [
    { id: 'x1', name: 'Archives office manager 2019', parents: ['DEEP'] },
    { id: 'm1', name: 'TATY_AI_office manager', parents: ['0ASHARE'] }] }) });
  const f = await findPrimaryMemory('0ASHARE', { headers: {} }, fetchImpl);
  assert.equal(f.id, 'm1');
});

test('Google always gets ONE registered return address, whatever address the app was opened from', () => {
  const fromAlias = { headers: { host: 'office-manager-personal-pilot-paul-bc10.vercel.app' } };
  const fromDeploy = { headers: { host: 'office-manager-personal-pilot-5tg9pz8nc-paul-bc10.vercel.app' } };
  const prod = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'office-manager-personal-pilot.vercel.app' };
  assert.equal(redirectUri(fromAlias, prod), 'https://office-manager-personal-pilot.vercel.app/oauth/google/callback');
  assert.equal(redirectUri(fromDeploy, prod), 'https://office-manager-personal-pilot.vercel.app/oauth/google/callback');
  const preview = { VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'office-manager-personal-pilot-git-feature-whit-9611c0-paul-bc10.vercel.app' };
  assert.equal(redirectUri(fromDeploy, preview), 'https://office-manager-personal-pilot-git-feature-whit-9611c0-paul-bc10.vercel.app/oauth/google/callback');
  assert.equal(redirectUri(fromDeploy, { ...prod, OFFICE_MANAGER_PUBLIC_URL: 'https://office.taty.ci/' }), 'https://office.taty.ci/oauth/google/callback');
});

test('never another Drive: without the firm’s choice, no silent fallback on a server or old Drive', async () => {
  const { configuredDriveId } = await import('../lib/google-drive.js');
  const { memoryFolderId } = await import('../lib/memory-runtime.js');
  const keys = ['TATY_SHARED_DRIVE_ID', 'OFFICE_MANAGER_MEMORY_FOLDER_ID', 'OFFICE_MANAGER_ALLOW_ENV_DRIVE', 'VERCEL_ENV', 'OFFICE_MANAGER_TEST_RUN', 'AGENT_MAIL_SANDBOX'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    resetGoogleConnectionCache();
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, { TATY_SHARED_DRIVE_ID: 'OLD_DRIVE', OFFICE_MANAGER_MEMORY_FOLDER_ID: 'OLD_MEMORY' });
    assert.throws(() => configuredDriveId(), /FIRM_DRIVE_NOT_CHOSEN/);
    assert.equal(memoryFolderId(), null);
    process.env.OFFICE_MANAGER_ALLOW_ENV_DRIVE = 'true';
    assert.equal(configuredDriveId(), 'OLD_DRIVE');
    assert.equal(memoryFolderId(), 'OLD_MEMORY');
  } finally { keys.forEach(k => saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]); }
});

test('a preview gives Google the SAME registered address as production, and production sends the browser back to the preview', async () => {
  const { relayTarget, selfOrigin } = await import('../lib/google-connection.js');
  const PROD = 'office-manager-personal-pilot.vercel.app';
  const BRANCH = 'office-manager-personal-pilot-git-feature-entr-1a2b3c-paul-bc10.vercel.app';
  const secret = 'state-secret-shared-by-preview-and-production';
  const preview = { VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: PROD, VERCEL_BRANCH_URL: BRANCH, OAUTH_STATE_SECRET: secret };
  const production = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: PROD, OAUTH_STATE_SECRET: secret };
  const onPreview = { headers: { host: 'office-manager-personal-pilot-x9y8z7-paul-bc10.vercel.app' } };
  // 1. every deployment, any branch: the one address registered in Google
  assert.equal(redirectUri(onPreview, preview), `https://${PROD}/oauth/google/callback`);
  assert.equal(selfOrigin(onPreview, preview), `https://${BRANCH}`);
  // 2. the signed state remembers where the person started
  const state = makeState('org-1', 'Paul', preview, Date.now(), '/parametres.html', null, selfOrigin(onPreview, preview));
  assert.equal(JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString()).o, `https://${BRANCH}`);
  // 3. Google returns to production, which relays code + state untouched to the preview
  const back = { headers: { host: PROD }, query: { route: 'google-callback', code: 'abc', state, scope: 'drive' } };
  const to = relayTarget(back, production);
  assert.ok(to.startsWith(`https://${BRANCH}/oauth/google/callback?`));
  const u = new URL(to);
  assert.equal(u.searchParams.get('code'), 'abc'); assert.equal(u.searchParams.get('state'), state); assert.equal(u.searchParams.get('route'), null);
  // 4. on the preview itself: no relay, it exchanges the code
  assert.equal(relayTarget({ headers: { host: BRANCH }, query: back.query }, preview), null);
  // a production start (no origin in the state): no relay
  assert.equal(relayTarget({ headers: { host: PROD }, query: { code: 'abc', state: makeState('org-1', 'Paul', production) } }, production), null);
});

test('the relay never sends Google’s answer to an address the server did not sign, or outside Vercel / the firm’s address', async () => {
  const { relayTarget } = await import('../lib/google-connection.js');
  const env = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'om.vercel.app', OAUTH_STATE_SECRET: 's1' };
  const here = { host: 'om.vercel.app' };
  const forged = makeState('org-1', 'x', { OAUTH_STATE_SECRET: 'other' }, Date.now(), '/parametres.html', null, 'https://evil-preview.vercel.app');
  assert.throws(() => relayTarget({ headers: here, query: { code: 'c', state: forged } }, env), /OAUTH_STATE_INVALID/);
  const foreign = makeState('org-1', 'x', env, Date.now(), '/parametres.html', null, 'https://evil.example.com');
  assert.equal(relayTarget({ headers: here, query: { code: 'c', state: foreign } }, env), null);
  const http = makeState('org-1', 'x', env, Date.now(), '/parametres.html', null, 'http://p.vercel.app');
  assert.equal(relayTarget({ headers: here, query: { code: 'c', state: http } }, env), null);
  const expired = makeState('org-1', 'x', env, Date.now() - 24 * 3600e3, '/parametres.html', null, 'https://p.vercel.app');
  assert.throws(() => relayTarget({ headers: here, query: { code: 'c', state: expired } }, env), /OAUTH_STATE_EXPIRED/);
  const own = makeState('org-1', 'x', { ...env, OFFICE_MANAGER_PUBLIC_URL: 'https://office.cabinet.ci' }, Date.now(), '/parametres.html', null, 'https://office.cabinet.ci');
  assert.equal(relayTarget({ headers: here, query: { code: 'c', state: own } }, { ...env, OFFICE_MANAGER_PUBLIC_URL: 'https://office.cabinet.ci' }).startsWith('https://office.cabinet.ci/oauth/google/callback?'), true);
});
