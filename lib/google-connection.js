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
  // Last resort OAUTH_STATE_SECRET (server-only, already required to connect): an installation
  // with no dedicated key can still keep the firm's access (2026-10-07, TOKEN_ENCRYPTION_KEY_MISSING).
  const s = env.GOOGLE_TOKEN_ENCRYPTION_KEY || env.OWNER_APPROVAL_SECRET || env.OAUTH_STATE_SECRET || '';
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
// The address the owner is actually using comes first (preview and production each come back
// to themselves); GOOGLE_OAUTH_REDIRECT_URI is only the fallback when the host is unknown.
export function redirectUri(req, env = process.env) {
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (!host && env.GOOGLE_OAUTH_REDIRECT_URI && env.GOOGLE_OAUTH_REDIRECT_URI.endsWith(CALLBACK_PATH)) return env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!host) throw fail('HOST_UNKNOWN', 400);
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return proto + '://' + host + CALLBACK_PATH;
}

const sign = (payload, env) => crypto.createHmac('sha256', stateSecret(env)).update(payload).digest('base64url');
// Pages of the app Google may send the owner back to (never an outside address).
export const RETURN_PAGES = ['/parametres.html', '/demarrer.html'];
export function makeState(orgId, by, env = process.env, now = Date.now(), back = '/parametres.html', mode = null) {
  const ret = RETURN_PAGES.includes(back) ? back : '/parametres.html';
  const body = { org: orgId, by: String(by || '').slice(0, 120), exp: now + STATE_TTL_MS, ret, n: crypto.randomBytes(9).toString('base64url') };
  if (mode === 'signin') body.m = 'signin';
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
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
export function googleClientConfigured(env = process.env) { return Boolean(clientCredentials(env)); }

// "Continuer avec Google" (sign-in like Claude / ChatGPT, 2026-10-07): one Google page identifies
// the person and, for a firm with no account yet, also grants Drive + Gmail in the same click.
export function startSignin(orgId, req, { full = false } = {}, env = process.env) {
  const client = clientCredentials(env);
  if (!client) throw fail('GOOGLE_CLIENT_NOT_CONFIGURED', 503);
  const p = new URLSearchParams({
    client_id: client.id, redirect_uri: redirectUri(req, env), response_type: 'code',
    scope: (full ? [...REQUESTED, 'profile'] : ['openid', 'email', 'profile']).join(' '),
    state: makeState(orgId, '', env, Date.now(), '/parametres.html', 'signin')
  });
  if (full) { p.set('access_type', 'offline'); p.set('prompt', 'consent'); p.set('include_granted_scopes', 'true'); }
  else p.set('prompt', 'select_account');
  return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + p };
}

// Google's return: code exchanged; who it is (e-mail, name), the rights granted, the signed state.
export async function exchangeCode(orgId, req, d = {}) {
  const env = d.env || process.env, fetchImpl = d.fetchImpl || fetch;
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
  const u = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token } });
  const info = await u.json().catch(() => ({}));
  const email = String(info.email || '').toLowerCase();
  if (!email || info.email_verified === false) throw fail('GOOGLE_EMAIL_UNKNOWN', 400);
  return { st, email, name: String(info.name || '').slice(0, 120) || null, refresh: tok.refresh_token || null,
    scopes: String(tok.scope || '').split(/\s+/).filter(Boolean) };
}

// Keeps the firm's Google access (refresh token encrypted).
export async function saveConnection(orgId, { email, refresh, scopes, by }, d = {}) {
  const env = d.env || process.env, fetchRows = d.fetchRows || rest;
  await fetchRows('office_google_connections?on_conflict=org_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: orgId, google_email: email, refresh_token_enc: encryptToken(refresh, env), scopes,
      connected_by: by || null, connected_at: new Date().toISOString(), revoked_at: null, last_error: null }])
  });
  cache = null; tokenCache = null;
}

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
  out.firm_drive = fd ? { id: stripFolder(fd.drive_id), name: fd.drive_name, kind: kindOf(fd.drive_id), memory_folder: memOf(fd.drive_id) } : null;
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
export function resetFirmDriveCache() { driveCache = null; }

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
// A « Mon Drive » folder is stored as "folder:<id>" (no schema change); everything else is a shared drive.
// « Tout le Google Drive » is stored as "all:<id of the agents' memory folder>".
const FOLDER_PREFIX = 'folder:';
export const MEMORY_FOLDER = '00_OFFICE_MANAGER';
const ALL_PREFIX = 'all:';
// A shared drive or a folder carries the id of its agents' memory folder: "<root>|m:<memory>".
const MEM_SEP = '|m:';
const rootPart = v => String(v || '').split(MEM_SEP)[0];
const stripFolder = v => { const t = rootPart(v); return t.startsWith(FOLDER_PREFIX) ? t.slice(FOLDER_PREFIX.length) : t.startsWith(ALL_PREFIX) ? t.slice(ALL_PREFIX.length) : t; };
const kindOf = v => String(v || '').startsWith(ALL_PREFIX) ? 'all' : String(v || '').startsWith(FOLDER_PREFIX) ? 'folder' : 'drive';
const memOf = v => { const t = String(v || ''); if (t.startsWith(ALL_PREFIX)) return stripFolder(t); const i = t.indexOf(MEM_SEP); return i >= 0 ? t.slice(i + MEM_SEP.length) : null; };
export function firmDriveId() { return driveCache && !driveCache.none ? stripFolder(driveCache.drive_id) : null; }
export function firmDriveKind() { return driveCache && !driveCache.none ? kindOf(driveCache.drive_id) : null; }
// The single folder where everything the agents use lives (00_OFFICE_MANAGER), when known.
export function firmMemoryId() { return driveCache && !driveCache.none ? memOf(driveCache.drive_id) : null; }

// Agents' files, wherever an older version of the app left them.
export const MEMORY_FILES = ['OFFICE_MANAGER_MAP.xlsx', 'OFFICE_MANAGER_REGISTER.xlsx', 'OFFICE_MANAGER_SCAN_STATE.json',
  'OFFICE_MANAGER_FIRM_KNOWLEDGE.json', 'OFFICE_MANAGER_TIDY_STATE.json'];
const OLD_MYDRIVE_MEMORY = 'Office Manager - mémoire des agents';

async function gjson(fetchImpl, url, H, init = {}) {
  const r = await fetchImpl(url, { ...init, headers: { ...H.headers, ...(init.headers || {}) } });
  return r.ok ? r.json().catch(() => ({})) : null;
}

// Finds (or creates) 00_OFFICE_MANAGER directly under parentId (a shared drive root or a folder).
export async function ensureMemoryFolder(parentId, sharedDriveId, H, fetchImpl = fetch) {
  const p = new URLSearchParams({ q: "name = '" + MEMORY_FOLDER + "' and '" + parentId + "' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id,name)', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' });
  if (sharedDriveId) { p.set('corpora', 'drive'); p.set('driveId', sharedDriveId); }
  const found = await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files?' + p, H);
  if (found?.files?.[0]) return found.files[0];
  const created = await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name', H,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: MEMORY_FOLDER, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }) });
  if (!created?.id) throw fail('DRIVE_MEMORY_FOLDER_FAILED', 502);
  return created;
}

// The agents' PRIMARY memory folder may already exist (Paul, 2026-10-07: « il y a TATY_AI_office
// manager, c'est sa mémoire principale »). Order: the folder the owner pasted, else an existing
// folder of that drive whose name says « AI … office manager » (e.g. TATY_AI_office manager),
// else 00_OFFICE_MANAGER at its root (found or created).
export async function findPrimaryMemory(sharedDriveId, H, fetchImpl = fetch) {
  const p = new URLSearchParams({ q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false and name contains 'office manager'",
    fields: 'files(id,name,parents)', corpora: 'drive', driveId: sharedDriveId, includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', pageSize: '50' });
  const r = await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files?' + p, H);
  const cands = (r?.files || []).filter(f => /(^|[\s_\-])(ai|ia)([\s_\-]|$)/i.test(f.name) && f.name !== MEMORY_FOLDER);
  cands.sort((a, b) => ((b.parents || []).includes(sharedDriveId) ? 1 : 0) - ((a.parents || []).includes(sharedDriveId) ? 1 : 0));
  return cands[0] || null;
}

// One copy of each agent file, in the memory folder (Paul, 2026-10-07: « le Drive doit rester
// propre ; tout ce que l'IA utilise va dans son dossier, mis à jour, sans doublon »). Looks ONLY in
// this firm's previous places (previous memory folder, root of the chosen drive/folder, the old
// « Mon Drive » folder): the primary memory's copy wins, else the most recent copy is moved into
// it; the others go to the bin (recoverable 30 days); emptied old memory folders too.
export async function consolidateMemory(memId, fromParents, H, fetchImpl = fetch) {
  const report = { moved: [], binned: [] };
  const oldMy = await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q: "name = '" + OLD_MYDRIVE_MEMORY + "' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false", fields: 'files(id)' }), H);
  const places = [...new Set([...(fromParents || []), ...((oldMy?.files || []).map(f => f.id))].filter(x => x && x !== memId))];
  for (const name of MEMORY_FILES) {
    const copies = [];
    for (const parent of [memId, ...places]) {
      const p = new URLSearchParams({ q: "name = '" + name + "' and '" + parent + "' in parents and trashed = false", fields: 'files(id,name,parents,modifiedTime)', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', corpora: 'allDrives' });
      const r = await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files?' + p, H);
      for (const f of r?.files || []) copies.push({ ...f, parent });
    }
    if (!copies.length) continue;
    // The primary memory's own copy always wins; otherwise the most recent copy is brought in.
    copies.sort((a, b) => (b.parent === memId) - (a.parent === memId) || String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
    const [keep, ...extra] = copies;
    if (keep.parent !== memId) {
      await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files/' + q(keep.id) + '?supportsAllDrives=true&addParents=' + q(memId) + '&removeParents=' + q(keep.parent) + '&fields=id', H,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      report.moved.push(name);
    }
    for (const x of extra) {
      await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files/' + q(x.id) + '?supportsAllDrives=true', H, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      report.binned.push(name);
    }
  }
  for (const f of [...(oldMy?.files || []), ...places.filter(pl => pl !== memId).map(id => ({ id, onlyIfMemory: true }))]) {
    if (f.onlyIfMemory) {
      const meta = await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files/' + q(f.id) + '?supportsAllDrives=true&fields=id,name,mimeType', H);
      if (!meta || meta.name !== MEMORY_FOLDER) continue;
    }
    const left = await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q: "'" + f.id + "' in parents and trashed = false", fields: 'files(id)', pageSize: '1', corpora: 'allDrives', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' }), H);
    if (left && !(left.files || []).length) await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files/' + q(f.id) + '?supportsAllDrives=true', H, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  }
  return report;
}

// Owner pastes the link: the Drive must be a shared drive the connected Google account can see.
export async function setFirmDrive(orgId, req, d = {}) {
  const env = d.env || process.env, fetchRows = d.fetchRows || rest, fetchImpl = d.fetchImpl || fetch;
  const wantAll = req.body?.all === true || String(req.body?.link || '').trim().toLowerCase() === 'tout';
  const id = wantAll ? null : parseDriveLink(req.body?.link);
  if (!connectedGoogle()) await loadGoogleConnection(orgId, d);
  if (!connectedGoogle()) throw fail('GOOGLE_NOT_CONNECTED', 409);
  const token = await connectionAccessToken({ env, fetchImpl });
  const H = { headers: { Authorization: 'Bearer ' + token } };
  if (wantAll) {
    // « Tout le Google Drive »: the agents read Mon Drive, every shared drive and « Partagés avec
    // moi ». Their memory (map, register, what they understood of the firm) lives IN the firm's
    // shared drive chosen as home (Paul, 2026-10-07: « la mémoire, c'est d'abord le Drive partagé »),
    // in one folder « 00_OFFICE_MANAGER » at its root, found or created here.
    const home = String(req.body?.home || '').trim();
    if (!home) throw fail('HOME_DRIVE_REQUIRED', 400);
    const rh = await fetchImpl('https://www.googleapis.com/drive/v3/drives/' + q(home) + '?fields=id,name', H);
    if (!rh.ok) throw fail('HOME_DRIVE_NOT_VISIBLE', 404);
    const homeDrive = await rh.json();
    const before = await loadFirmDrive(orgId, { fetchRows }).catch(() => null);
    let folder = null;
    if (req.body?.memory) {
      const mid = parseDriveLink(req.body.memory);
      const mf = await gjson(fetchImpl, 'https://www.googleapis.com/drive/v3/files/' + q(mid) + '?supportsAllDrives=true&fields=id,name,mimeType', H);
      if (!mf || mf.mimeType !== 'application/vnd.google-apps.folder') throw fail('MEMORY_FOLDER_NOT_VISIBLE', 404);
      folder = mf;
    }
    // The agents' home first: « … AI MANAGER / Atelier mémoire » (2026-10-08).
    if (!folder) { const { findAtelier } = await import('./memory-home.js'); folder = await findAtelier(H, { kind: 'drive', driveId: home, fetchImpl }).catch(() => null); }
    folder = folder || await findPrimaryMemory(home, H, fetchImpl).catch(() => null) || await ensureMemoryFolder(home, home, H, fetchImpl);
    const cleaned = await consolidateMemory(folder.id, [before && memOf(before.drive_id), before && stripFolder(before.drive_id)].filter(Boolean), H, fetchImpl).catch(() => null);
    const label = 'Tout le Google Drive — mémoire : ' + (homeDrive.name || 'Drive partagé') + ' / ' + (folder.name || MEMORY_FOLDER);
    await fetchRows('office_firm_drive?on_conflict=org_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, drive_id: ALL_PREFIX + folder.id, drive_name: label.slice(0, 200), set_by: String(req.account?.display_name || req.body?.by || '').slice(0, 120) || null, set_at: new Date().toISOString() }])
    });
    driveCache = null;
    await loadFirmDrive(orgId, { fetchRows });
    return { drive_id: folder.id, drive_name: label, kind: 'all', home: { id: homeDrive.id, name: homeDrive.name }, memory: { id: folder.id, name: folder.name || MEMORY_FOLDER }, cleaned };
  }
  // A shared drive id, any folder of a shared drive (its drive is used), or a folder of
  // « Mon Drive » (that folder becomes the firm's Drive).
  let drive = null;
  const rd = await fetchImpl('https://www.googleapis.com/drive/v3/drives/' + q(id) + '?fields=id,name', H);
  if (rd.ok) drive = await rd.json();
  else {
    const rf = await fetchImpl('https://www.googleapis.com/drive/v3/files/' + q(id) + '?supportsAllDrives=true&fields=id,name,driveId,mimeType', H);
    const f = rf.ok ? await rf.json() : null;
    if (!f) throw fail('DRIVE_NOT_VISIBLE_TO_CONNECTED_ACCOUNT', 404);
    if (f.driveId) {
      const r2 = await fetchImpl('https://www.googleapis.com/drive/v3/drives/' + q(f.driveId) + '?fields=id,name', H);
      drive = r2.ok ? await r2.json() : { id: f.driveId, name: null };
    } else {
      if (f.mimeType !== 'application/vnd.google-apps.folder') throw fail('DRIVE_LINK_NOT_A_FOLDER', 400);
      drive = { id: FOLDER_PREFIX + f.id, name: f.name || null };
    }
  }
  // Test mode (preview): the real firm's Drive stays protected (TEST_SOURCE_DRIVE_ID).
  if (isTestModeEnv(env) && env.TEST_SOURCE_DRIVE_ID && drive.id === env.TEST_SOURCE_DRIVE_ID) throw fail('TEST_MODE_REAL_DRIVE_REFUSED', 409);
  // Everything the agents use goes into ONE folder 00_OFFICE_MANAGER of that drive / folder.
  const before = await loadFirmDrive(orgId, { fetchRows }).catch(() => null);
  const rootId = stripFolder(drive.id);
  let mem = null, cleaned = null;
  try {
    // The agents' home first: « … AI MANAGER / Atelier mémoire » (2026-10-08), never a new 00_OFFICE_MANAGER when it exists.
    const { findAtelier } = await import('./memory-home.js');
    mem = await findAtelier(H, { kind: kindOf(drive.id), driveId: rootId, fetchImpl }).catch(() => null) || await ensureMemoryFolder(rootId, kindOf(drive.id) === 'drive' ? rootId : null, H, fetchImpl);
    cleaned = await consolidateMemory(mem.id, [rootId, before && memOf(before.drive_id), before && stripFolder(before.drive_id)].filter(Boolean), H, fetchImpl).catch(() => null);
  } catch { mem = null; }
  await fetchRows('office_firm_drive?on_conflict=org_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: orgId, drive_id: drive.id + (mem ? MEM_SEP + mem.id : ''), drive_name: drive.name || null, set_by: String(req.account?.display_name || req.body?.by || '').slice(0, 120) || null, set_at: new Date().toISOString() }])
  });
  driveCache = null;
  await loadFirmDrive(orgId, { fetchRows });
  return { drive_id: rootId, drive_name: drive.name || null, kind: kindOf(drive.id), memory_folder: mem ? mem.id : null, cleaned };
}
