import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { redirectUri as googleRedirectUri, canonicalOrigin } from './google-connection.js';

// All personal OAuth states and tokens are separate from office_google_connections.
// Never infer personal Gmail permission from "Continue with Google" authentication.
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const q = encodeURIComponent;
const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const email = s => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(s || ''));
const VALID = new Set(['google', 'microsoft']);
const GOOGLE = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];
const MICROSOFT = ['openid', 'email', 'offline_access', 'User.Read', 'Mail.Read', 'Mail.Send'];
const TTL = 15 * 60 * 1000;
const GRAPH = 'https://graph.microsoft.com/v1.0';

function secret(env = process.env) {
  const s = env.PERSONAL_MAIL_ENCRYPTION_KEY || env.GOOGLE_TOKEN_ENCRYPTION_KEY || env.OAUTH_STATE_SECRET || env.OWNER_APPROVAL_SECRET;
  if (!s || s.length < 20) throw fail('PERSONAL_MAIL_ENCRYPTION_KEY_MISSING', 503);
  return crypto.createHash('sha256').update('office-manager/personal-mail/v1:' + s).digest();
}
export function seal(value, binding, env = process.env) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret(env), iv);
  cipher.setAAD(Buffer.from(binding));
  const bytes = Buffer.concat([cipher.update(String(value)), cipher.final()]);
  return ['pm1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), bytes.toString('base64url')].join('.');
}
export function unseal(value, binding, env = process.env) {
  try {
    const p = String(value || '').split('.');
    if (p.length !== 4 || p[0] !== 'pm1') throw Error('bad');
    const dec = crypto.createDecipheriv('aes-256-gcm', secret(env), Buffer.from(p[1], 'base64url'));
    dec.setAAD(Buffer.from(binding));
    dec.setAuthTag(Buffer.from(p[2], 'base64url'));
    return Buffer.concat([dec.update(Buffer.from(p[3], 'base64url')), dec.final()]).toString();
  } catch { throw fail('PERSONAL_MAIL_SECRET_INVALID', 400); }
}
export function isPersonalState(value) { return String(value || '').startsWith('pm1.'); }
export function readPersonalState(value, env = process.env, now = Date.now()) {
  let body;
  try { body = JSON.parse(unseal(value, 'oauth-state', env)); } catch { throw fail('PERSONAL_MAIL_STATE_INVALID', 400); }
  if (!uuid(body.org) || !uuid(body.uid) || !VALID.has(body.provider) || !body.verifier) throw fail('PERSONAL_MAIL_STATE_INVALID', 400);
  if (!Number.isFinite(body.exp) || body.exp < now || body.exp > now + TTL) throw fail('PERSONAL_MAIL_STATE_EXPIRED', 400);
  return body;
}
function oauthClient(provider, env = process.env) {
  if (!VALID.has(provider)) throw fail('MAIL_PROVIDER_UNKNOWN', 400);
  const id = provider === 'google' ? (env.GOOGLE_CLIENT_ID || env.GOOGLE_OAUTH_CLIENT_ID) : (env.MICROSOFT_CLIENT_ID || env.AZURE_CLIENT_ID);
  const clientSecret = provider === 'google' ? (env.GOOGLE_CLIENT_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET) : (env.MICROSOFT_CLIENT_SECRET || env.AZURE_CLIENT_SECRET);
  if (!id || !clientSecret) throw fail('PERSONAL_MAIL_OAUTH_NOT_CONFIGURED', 503);
  return { id, clientSecret };
}
function callbackUri(provider, req, env = process.env) {
  if (provider === 'google') return googleRedirectUri(req, env);
  const fixed = env.MICROSOFT_MAIL_REDIRECT_URI || (canonicalOrigin(env) ? canonicalOrigin(env) + '/api/app?route=personal-mail-callback' : '');
  if (!fixed) throw fail('MICROSOFT_MAIL_REDIRECT_NOT_CONFIGURED', 503);
  const u = new URL(fixed);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) throw fail('MAIL_REDIRECT_INVALID', 503);
  return u.href;
}
export function personalMailStart(orgId, account, provider, req, d = {}) {
  if (!uuid(orgId) || !uuid(account?.auth_user_id)) throw fail('PERSONAL_SESSION_REQUIRED', 401);
  const env = d.env || process.env, { id } = oauthClient(provider, env);
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const redirect = callbackUri(provider, req, env);
  const body = { org: orgId, uid: account.auth_user_id, provider, verifier, redirect,
    exp: (d.now || Date.now)() + TTL, nonce: crypto.randomBytes(16).toString('base64url') };
  const state = seal(JSON.stringify(body), 'oauth-state', env);
  const google = provider === 'google';
  const endpoint = google ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  const p = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: redirect, scope: (google ? GOOGLE : MICROSOFT).join(' '),
    state, code_challenge: challenge, code_challenge_method: 'S256' });
  if (google) { p.set('access_type', 'offline'); p.set('prompt', 'consent'); }
  else p.set('prompt', 'select_account');
  return { url: endpoint + '?' + p, provider };
}
function tokenBinding(org, uid, provider, address) { return 'oauth-token:' + [org, uid, provider, String(address).toLowerCase()].join(':'); }
export function accountPublic(row) {
  return { id: row.id, provider: row.provider, email: row.email, ai_enabled: Boolean(row.ai_enabled),
    status: row.status, connected_at: row.connected_at, last_sync_at: row.last_sync_at, last_error: row.last_error || null };
}
export async function personalAccounts(orgId, account, d = {}) {
  if (!uuid(account?.auth_user_id)) throw fail('PERSONAL_SESSION_REQUIRED', 401);
  const rows = await (d.db || rest)('office_email_accounts?org_id=eq.' + q(orgId) + '&user_id=eq.' + q(account.auth_user_id) +
    '&status=neq.revoked&select=id,provider,email,ai_enabled,status,connected_at,last_sync_at,last_error&order=connected_at.asc') || [];
  return { accounts: rows.map(accountPublic) };
}
export async function ownedMailbox(orgId, account, mailboxId, d = {}) {
  if (!uuid(orgId) || !uuid(account?.auth_user_id)) throw fail('PERSONAL_SESSION_REQUIRED', 401);
  if (!uuid(mailboxId)) throw fail('MAILBOX_ID_INVALID', 400);
  const rows = await (d.db || rest)('office_email_accounts?org_id=eq.' + q(orgId) + '&user_id=eq.' + q(account.auth_user_id) +
    '&id=eq.' + q(mailboxId) + '&status=neq.revoked&select=*&limit=1');
  const row = rows?.[0];
  if (!row) throw fail('PERSONAL_MAILBOX_NOT_FOUND', 404);
  return row;
}
async function responseJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
export async function completePersonalMail(req, d = {}) {
  const env = d.env || process.env, fetchImpl = d.fetchImpl || fetch, db = d.db || rest;
  const body = readPersonalState(req.query?.state, env, (d.now || Date.now)());
  if (req.query?.error) throw fail('PERSONAL_MAIL_CONSENT_REFUSED', 400);
  if (!req.query?.code || String(req.query.code).length > 4096) throw fail('PERSONAL_MAIL_CODE_MISSING', 400);
  const active = await db('office_app_users?org_id=eq.' + q(body.org) + '&auth_user_id=eq.' + q(body.uid) +
    '&active=eq.true&select=auth_user_id&limit=1');
  if (!active?.length) throw fail('PERSONAL_ACCOUNT_INACTIVE', 403);
  const client = oauthClient(body.provider, env);
  const google = body.provider === 'google';
  const tokenUrl = google ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const parameters = new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: body.redirect,
    client_id: client.id, client_secret: client.clientSecret, code_verifier: body.verifier });
  if (!google) parameters.set('scope', MICROSOFT.join(' '));
  const { response, data } = await responseJson(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: parameters }, fetchImpl);
  if (!response.ok || !data.access_token || !data.refresh_token) throw fail('PERSONAL_MAIL_OAUTH_FAILED', 409);
  const permissions = String(data.scope || '').split(/\s+/).filter(Boolean);
  const needed = google ? GOOGLE.slice(2) : ['Mail.Read', 'Mail.Send'];
  if (!needed.every(x => permissions.includes(x))) throw fail('PERSONAL_MAIL_SCOPE_MISSING', 403);
  const userUrl = google ? 'https://openidconnect.googleapis.com/v1/userinfo' : GRAPH + '/me?$select=mail,userPrincipalName';
  const user = await responseJson(userUrl, { headers: { Authorization: 'Bearer ' + data.access_token } }, fetchImpl);
  if (!user.response.ok) throw fail('PERSONAL_MAIL_IDENTITY_FAILED', 502);
  const address = String((google ? user.data.email : (user.data.mail || user.data.userPrincipalName)) || '').trim().toLowerCase();
  if (!email(address) || (google && user.data.email_verified === false)) throw fail('PERSONAL_MAIL_IDENTITY_UNVERIFIED', 403);
  if (google) {
    const profile = await responseJson('https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: 'Bearer ' + data.access_token } }, fetchImpl);
    if (!profile.response.ok || String(profile.data.emailAddress || '').toLowerCase() !== address) throw fail('PERSONAL_MAIL_GMAIL_IDENTITY_MISMATCH', 403);
  }
  const sealed = seal(data.refresh_token, tokenBinding(body.org, body.uid, body.provider, address), env);
  const row = { org_id: body.org, user_id: body.uid, provider: body.provider, email: address, refresh_token_enc: sealed,
    scopes: permissions, status: 'connected', last_error: null, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await db('office_email_accounts?on_conflict=org_id,user_id,provider,email',
    { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]) });
  return { provider: body.provider, email: address, redirect: '/accueil.html?personal_mail=connected' };
}
export async function personalAccessToken(row, d = {}) {
  const env = d.env || process.env, fetchImpl = d.fetchImpl || fetch, db = d.db || rest;
  if (row.status === 'reconnect_required') throw fail('PERSONAL_MAIL_RECONNECT_REQUIRED', 409);
  const refresh = unseal(row.refresh_token_enc, tokenBinding(row.org_id, row.user_id, row.provider, row.email), env);
  const c = oauthClient(row.provider, env);
  const google = row.provider === 'google';
  const url = google ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const p = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: c.id, client_secret: c.clientSecret });
  if (!google) p.set('scope', MICROSOFT.join(' '));
  const { response, data } = await responseJson(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p }, fetchImpl);
  if (!response.ok || !data.access_token) {
    const revoked = data.error === 'invalid_grant';
    if (revoked) await db('office_email_accounts?id=eq.' + q(row.id) + '&org_id=eq.' + q(row.org_id) + '&user_id=eq.' + q(row.user_id),
      { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'reconnect_required', last_error: 'PERSONAL_MAIL_RECONNECT_REQUIRED' }) }).catch(() => null);
    throw fail(revoked ? 'PERSONAL_MAIL_RECONNECT_REQUIRED' : 'PERSONAL_MAIL_TOKEN_UNAVAILABLE', 409);
  }
  if (data.refresh_token && data.refresh_token !== refresh) {
    await db('office_email_accounts?id=eq.' + q(row.id) + '&org_id=eq.' + q(row.org_id) + '&user_id=eq.' + q(row.user_id),
      { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ refresh_token_enc: seal(data.refresh_token, tokenBinding(row.org_id, row.user_id, row.provider, row.email), env), updated_at: new Date().toISOString() }) });
  }
  return data.access_token;
}
export async function personalDisconnect(orgId, account, mailboxId, d = {}) {
  const row = await ownedMailbox(orgId, account, mailboxId, d);
  const db = d.db || rest, fetchImpl = d.fetchImpl || fetch;
  if (row.provider === 'google') {
    try {
      const token = unseal(row.refresh_token_enc, tokenBinding(row.org_id, row.user_id, row.provider, row.email), d.env || process.env);
      await fetchImpl('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }) });
    } catch { /* local disconnection always proceeds */ }
  }
  // Deletion cascades into this person's cached summaries and drafts; does not touch the cabinet inbox.
  await db('office_email_accounts?org_id=eq.' + q(orgId) + '&user_id=eq.' + q(account.auth_user_id) + '&id=eq.' + q(row.id),
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  return { disconnected: true };
}
export async function personalSettings(orgId, account, mailboxId, enabled, d = {}) {
  const row = await ownedMailbox(orgId, account, mailboxId, d);
  const db = d.db || rest;
  await db('office_email_accounts?org_id=eq.' + q(orgId) + '&user_id=eq.' + q(account.auth_user_id) + '&id=eq.' + q(row.id),
    { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ai_enabled: enabled === true, updated_at: new Date().toISOString() }) });
  return { ai_enabled: enabled === true };
}
