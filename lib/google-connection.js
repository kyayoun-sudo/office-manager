import crypto from 'node:crypto';
import { rest } from './supabase.js';

// Same definition as lib/test-mode.js (kept local to avoid an import cycle).
const isTestModeEnv = env => env.VERCEL_ENV !== 'production' && (env.VERCEL_ENV === 'preview' || String(env.OFFICE_MANAGER_TEST_RUN || '').toLowerCase() === 'on' || String(env.AGENT_MAIL_SANDBOX || '').toLowerCase() === 'on');

// "Connecter Google" (2026-10-07, asked by Paul: "pourquoi en me connectant l'application ne me
// demande pas l'accès au Drive ?"). The firm's owner connects the firm's Google account from
// Paramètres: Google asks them to allow Drive (+ Sheets) and Gmail (send / read) for the app,
// and the app keeps a refresh token, ENCRYPTED, for that firm only. No service account, no JSON
// key, no domain-wide delegation needed. Revocable at any time ("Déconnecter").
//
// Used by lib/google-drive.js (Drive / Sheets access) and lib/agent-mail.js (Gmail, only when the
// connected account IS the agent's sending mailbox). Env access (service account / env refresh
// token) keeps priority when set: nothing changes for a deployment configured that way.

const q = v => encodeURIComponent(v);
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });

export const SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive',
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  gmailRead: 'https://www.googleapis.com/auth/gmail.readonly'
};
const REQUESTED = ['openid', 'email', SCOPES.drive, SCOPES.sheets, SCOPES.gmailSend, SCOPES.gmailRead];
const STATE_TTL_MS = 15 * 60 * 1000;
export const CALLBACK_PATH = '/oauth/google/callback';

function clientCredentials(env = process.env) {
  const id = env.GOOGLE_CLIENT_ID || env.GOOGLE_OAUTH_CLIENT_ID || '';
  const secret = env.GOOGLE_CLIENT_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET || '';
  return id && secret ? { id, secret } : null;
}
function stateSecret(env = process.env) {
  const s = env.OAUTH_STATE_SECRET || env.OWNER_APPROVAL_SECRET || '';
  if (!s) throw fail('OAUTH_STATE_SECRET_MISSING', 503);
  return s;
}
function tokenKey(env = process.env) {
  const s = env.GOOGLE_TOKEN_ENCRYPTION_KEY || env.OWNER_APPROVAL_SECRET || '';
  if (!s) throw fail('TOKEN_ENCRYPTION_KEY_MISSING', 503);
  return crypto.createHash('sha256').update('office-manager/google-refresh-token/v1:' + s).digest();
}

export function encryptToken(plain, env = process.env) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', tokenKey(env), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1.' + [iv, c.getAuthTag(), data].map(b => b.toString('base64url')).join('.');
}
export function decryptToken(sealed, env = process.env) {
  const [v, iv, tag, data] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw fail('TOKEN_UNREADABLE', 500);
  const d = crypto.createDecipheriv('aes-256-gcm', tokenKey(env), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

// Redirect address registered once in the Google console (Authorized redirect URIs).
export function redirectUri(req, env = process.env) {
  if (env.GOOGLE_OAUTH_REDIRECT_URI && env.GOOGLE_OAUTH_REDIRECT_URI.endsWith(CALLBACK_PATH)) return env.GOOGLE_OAUTH_REDIRECT_URI;
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (!host) throw fail('HOST_UNKNOWN', 400);
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return proto + '://' + host + CALLBACK_PATH;
}

const sign = (payload, env) => crypto.createHmac('sha256', stateSecret(env)).update(payload).digest('base64url');
// Pages of the app Google may send the owner back to (never an outside address).
export const RETURN_PAGES = ['/parametres.html', '/demarrer.html'];
export function makeState(orgId, by, env = process.env, now = Date.now(), back = '/parametres.html') {
  const ret = RETURN_PAGES.includes(back) ? back : '/parametres.html';
  const payload = Buffer.from(JSON.stringify({ org: orgId, by: String(by || '').slice(0, 120), exp: now + STATE_TTL_MS, ret, n: crypto.randomBytes(9).toString('base64url') })).toString('base64url');
  return payload + '.' + sign(payload, env);
}
export function readState(state, orgId, env = process.env, now = Date.now()) {
  const [payload, mac] = String(state || '').split('.');
  if (!payload || !mac) throw fail('OAUTH_STATE_INVALID', 400);
  const expected = sign(payload, env);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw fail('OAUTH_STATE_INVALID', 400);
  const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (s.exp < now) throw fail('OAUTH_STATE_EXPIRED', 400);
  if (s.org !== orgId) throw fail('OAUTH_STATE_OTHER_FIRM', 400);
  return s;
}

// 1. Owner clicks "Connecter Google": the address of Google's consent page.
export function startConnect(orgId, req, env = process.env) {
  const client = clientCredentials(env);
  if (!client) throw fail('GOOGLE_CLIENT_NOT_CONFIGURED', 503);
  const p = new URLSearchParams({
    client_id: client.id, redirect_uri: redirectUri(req, env), response_type: 'code', scope: REQUESTED.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    state: makeState(orgId, req?.account?.display_name || req?.account?.email || req?.body?.by, env, Date.now(), req?.body?.return_to)
  });
  if (req?.body?.login_hint) p.set('login_hint', String(req.body.login_hint).slice(0, 254));
  return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + p, redirect_uri: redirectUri(req, env) };
}

// 2. Google sends the owner back here: code exchanged, refresh token encrypted and stored.
export async function finishConnect(orgId, req, d = {}) {
  const env = d.env || process.env, fetchImpl = d.fetchImpl || fetch, fetchRows = d.fetchRows || rest;
  const qy = req.query || {};
  if (qy.error) throw fail('GOOGLE_REFUSED: ' + String(qy.error).slice(0, 60), 400);
  const st = readState(qy.state, orgId, env, d.now);
  const client = clientCredentials(env);
  if (!client) throw fail('GOOGLE_CLIENT_NOT_CONFIGURED', 503);
  const r = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: String(qy.code || ''), client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri(req, env) })
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok) throw fail('GOOGLE_TOKEN_EXCHANGE_FAILED: ' + String(tok.error || r.status), 400);
  if (!tok.refresh_token) throw fail('GOOGLE_NO_REFRESH_TOKEN', 400);
  const u = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token } });
  const info = await u.json().catch(() => ({}));
  const email = String(info.email || '').toLowerCase();
  if (!email || info.email_verified === false) throw fail('GOOGLE_EMAIL_UNKNOWN', 400);
  const scopes = String(tok.scope || '').split(/\s+/).filter(Boolean);
  await fetchRows('office_google_connections?on_conflict=org_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: orgId, google_email: email, refresh_token_enc: encryptToken(tok.refresh_token, env), scopes,
      connected_by: st.by || null, connected_at: new Date().toISOString(), revoked_at: null, last_error: null }])
  });
  cache = null; tokenCache = null;
  return { email, scopes, return_to: RETURN_PAGES.includes(st.ret) ? st.ret : '/parametres.html' };
}

// ---- runtime: the firm's connection, loaded once per invocation ----
let cache = null;        // { orgId, email, refresh, scopes } | { orgId, none: true }
let tokenCache = null;   // { token, exp }

export async function loadGoogleConnection(orgId, d = {}) {
  await loadFirmDrive(orgId, d).catch(() => null);
  if (cache && cache.orgId === orgId && Date.now() - cache.at < 60000) return cache.none ? null : cache;
  const fetchRows = d.fetchRows || rest;
  let row = null;
  try {
    row = (await fetchRows('office_google_connections?org_id=eq.' + q(orgId) + '&revoked_at=is.null&select=google_email,refresh_token_enc,scopes&limit=1'))?.[0] || null;
  } catch { row = null; } // table not installed yet: no connection
  if (row) {
    cache = { orgId, email: row.google_email, refresh: decryptToken(row.refresh_token_enc, d.env), scopes: row.scopes || [], at: Date.now() };
    return cache;
  }
  // Existing connection made on 2026-10-05 through the Supabase function "taty-google-oauth"
  // (paulkomenan@taty.info, Drive + Sheets): reused directly, so the agents no longer go
  // through the limited relay. In test mode (preview) the firm being tested has none: the
  // Google identity of the real firm is used, while every WRITE stays locked to the test
  // Drive by lib/google-drive.js (assertWritableTarget).
  // 2026-10-07 (Paul: « tout le monde n'est pas TATY »): each firm uses ONLY its own Google
  // connection. The connection of another firm is never borrowed, not even in a preview.
  const owners = [orgId];
  for (const owner of owners) {
    const legacy = await legacyConnection(owner, d).catch(() => null);
    if (legacy) { cache = { orgId, ...legacy, legacy: true, at: Date.now() }; return cache; }
  }
  cache = { orgId, none: true, at: Date.now() };
  return null;
}

async function legacyConnection(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const rows = await fetchRows('rpc/office_get_google_drive_secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_org_id: orgId }) });
  const s = Array.isArray(rows) ? rows[0] : null;
  if (!s?.client_id || !s?.client_secret || !s?.refresh_token) return null;
  let info = null;
  try { info = (await fetchRows('office_integration_connections?org_id=eq.' + q(orgId) + '&provider=eq.google_drive&select=account_email,granted_scopes,status&limit=1'))?.[0] || null; } catch { info = null; }
  if (info && info.status && info.status !== 'connected') return null;
  return { email: String(info?.account_email || '').toLowerCase() || null, refresh: s.refresh_token,
    scopes: info?.granted_scopes || [SCOPES.drive, SCOPES.sheets], client: { id: s.client_id, secret: s.client_secret } };
}
export function connectedGoogle() { return cache && !cache.none ? cache : null; }
// A connection made by this firm's owner in the app (Paramètres / Démarrer), not the old relay.
export function firmConnected() { const c = connectedGoogle(); return Boolean(c && !c.legacy && c.scopes.includes(SCOPES.drive)); }
export function connectedHas(scope) { const c = connectedGoogle(); return Boolean(c && c.scopes.includes(scope)); }

export async function connectionAccessToken(d = {}) {
  const c = connectedGoogle();
  if (!c) throw fail('GOOGLE_NOT_CONNECTED', 409);
  if (tokenCache && tokenCache.exp > Date.now() + 30000) return tokenCache.token;
  const client = c.client || clientCredentials(d.env);
  if (!client) throw fail('GOOGLE_CLIENT_NOT_CONFIGURED', 503);
  const r = await (d.fetchImpl || fetch)('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh, client_id: client.id, client_secret: client.secret })
  });
  const data = await r.json().catch(() => ({}));
  // invalid_grant = access revoked in Google, or password changed: the owner must reconnect.
  if (!r.ok || !data.access_token) throw fail(data.error === 'invalid_grant' ? 'GOOGLE_RECONNECT_REQUIRED' : 'GOOGLE_AUTH_FAILURE_' + r.status, 409);
  tokenCache = { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3000) * 1000 };
  return tokenCache.token;
}

// ---- Paramètres: state, test, disconnect ----
export async function googleStatus(orgId, d = {}) {
  const env = d.env || process.env;
  cache = null;
  const c = await loadGoogleConnection(orgId, d).catch(() => null);
  const out = { client_configured: Boolean(clientCredentials(env)), connected: Boolean(c), email: c?.email || null, via: c?.legacy ? 'connexion Supabase du 5 octobre' : (c ? 'Paramètres' : null),
    drive: Boolean(c && c.scopes.includes(SCOPES.drive)), gmail_send: Boolean(c && c.scopes.includes(SCOPES.gmailSend)),
    gmail_read: Boolean(c && c.scopes.includes(SCOPES.gmailRead)), env_access: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON),
    redirect_uri: d.req ? redirectUri(d.req, env) : null };
  const fd = await loadFirmDrive(orgId, d).catch(() => null);
  out.firm_drive = fd ? { id: fd.drive_id, name: fd.drive_name } : null;
  if (c && d.check !== false) {
    try {
      const token = await connectionAccessToken(d);
      const r = await (d.fetchImpl || fetch)('https://www.googleapis.com/drive/v3/drives?pageSize=50&fields=drives(id,name)', { headers: { Authorization: 'Bearer ' + token } });
      const data = await r.json().catch(() => ({}));
      out.shared_drives = r.ok ? (data.drives || []).map(x => ({ id: x.id, name: x.name })) : [];
      out.check = r.ok ? 'ok' : 'GOOGLE_API_' + r.status;
    } catch (e) { out.check = String(e.message || e); }
  }
  return out;
}

export async function disconnectGoogle(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const c = await loadGoogleConnection(orgId, d).catch(() => null);
  if (c) await (d.fetchImpl || fetch)('https://oauth2.googleapis.com/revoke?token=' + q(c.refresh), { method: 'POST' }).catch(() => null);
  await fetchRows('office_google_connections?org_id=eq.' + q(orgId), {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString(), refresh_token_enc: 'revoked' })
  });
  cache = null; tokenCache = null;
  return { disconnected: true };
}

export function resetGoogleConnectionCache() { cache = null; tokenCache = null; driveCache = null; }

// ---- "Drive du cabinet": the shared drive the agents work on, pasted as a link in Paramètres ----
// Takes precedence over the TATY_SHARED_DRIVE_ID setting: each firm chooses its own Drive in the app.

let driveCache = null; // { orgId, drive_id, drive_name, at } | { orgId, none: true, at }

export function parseDriveLink(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/\/drive\/(?:u\/\d+\/)?(?:shared-drives|team-drives)\/([\w-]{10,})/) || s.match(/^([\w-]{10,})$/);
  if (!m) throw fail('DRIVE_LINK_INVALID');
  return m[1];
}

export async function loadFirmDrive(orgId, d = {}) {
  if (driveCache && driveCache.orgId === orgId && Date.now() - driveCache.at < 60000) return driveCache.none ? null : driveCache;
  let row = null;
  try { row = (await (d.fetchRows || rest)('office_firm_drive?org_id=eq.' + q(orgId) + '&select=drive_id,drive_name&limit=1'))?.[0] || null; } catch { row = null; }
  driveCache = row?.drive_id ? { orgId, drive_id: row.drive_id, drive_name: row.drive_name, at: Date.now() } : { orgId, none: true, at: Date.now() };
  return driveCache.none ? null : driveCache;
}
export function firmDriveId() { return driveCache && !driveCache.none ? driveCache.drive_id : null; }

// Owner pastes the link: the Drive must be a shared drive the connected Google account can see.
export async function setFirmDrive(orgId, req, d = {}) {
  const env = d.env || process.env, fetchRows = d.fetchRows || rest, fetchImpl = d.fetchImpl || fetch;
  const id = parseDriveLink(req.body?.link);
  if (!connectedGoogle()) await loadGoogleConnection(orgId, d);
  if (!connectedGoogle()) throw fail('GOOGLE_NOT_CONNECTED', 409);
  const token = await connectionAccessToken({ env, fetchImpl });
  const H = { headers: { Authorization: 'Bearer ' + token } };
  // A shared drive id, or any folder of a shared drive (its drive is used).
  let drive = null;
  const rd = await fetchImpl('https://www.googleapis.com/drive/v3/drives/' + q(id) + '?fields=id,name', H);
  if (rd.ok) drive = await rd.json();
  else {
    const rf = await fetchImpl('https://www.googleapis.com/drive/v3/files/' + q(id) + '?supportsAllDrives=true&fields=id,name,driveId', H);
    const f = rf.ok ? await rf.json() : null;
    if (!f) throw fail('DRIVE_NOT_VISIBLE_TO_CONNECTED_ACCOUNT', 404);
    if (!f.driveId) throw fail('DRIVE_MUST_BE_SHARED_DRIVE', 400);
    const r2 = await fetchImpl('https://www.googleapis.com/drive/v3/drives/' + q(f.driveId) + '?fields=id,name', H);
    drive = r2.ok ? await r2.json() : { id: f.driveId, name: null };
  }
  // Test mode (preview): the real firm's Drive stays protected (TEST_SOURCE_DRIVE_ID).
  if (isTestModeEnv(env) && env.TEST_SOURCE_DRIVE_ID && drive.id === env.TEST_SOURCE_DRIVE_ID) throw fail('TEST_MODE_REAL_DRIVE_REFUSED', 409);
  await fetchRows('office_firm_drive?on_conflict=org_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: orgId, drive_id: drive.id, drive_name: drive.name || null, set_by: String(req.account?.display_name || req.body?.by || '').slice(0, 120) || null, set_at: new Date().toISOString() }])
  });
  driveCache = null;
  await loadFirmDrive(orgId, { fetchRows });
  return { drive_id: drive.id, drive_name: drive.name || null };
}
