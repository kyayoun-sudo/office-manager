import { rest } from './supabase.js';
import { requireFirmOwner } from './owner-auth.js';

// Login by e-mail and password (Supabase Auth), with application roles kept in
// office_app_users: owner / partner (associé-gérant) / collaborator.
// Passwords never pass through this module's storage: Supabase Auth checks them.
//
// After a successful login the browser receives the existing pilot token (and the
// owner token for owner/partner), so every existing endpoint keeps working
// unchanged. The browser keeps the session until "Se déconnecter"; each page
// re-checks it with the refresh token, so a deactivated account is logged out.

export const ROLES = Object.freeze(['owner', 'partner', 'collaborator']);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (code, statusCode) => Object.assign(new Error(code), { statusCode });

export function cleanEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v.length > 254 || !EMAIL.test(v)) throw err('INVALID_EMAIL', 400);
  return v;
}

// At least 10 characters, with a letter and a digit.
export function checkPassword(value) {
  const v = String(value || '');
  if (v.length < 10 || v.length > 128 || !/[A-Za-z]/.test(v) || !/\d/.test(v)) throw err('WEAK_PASSWORD', 400);
  return v;
}

function authConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVER_CONFIG_MISSING');
  return { url: url.replace(/\/$/, ''), key };
}

// Calls Supabase Auth. Returns { status, data }.
export async function authCall(path, { method = 'POST', body, admin = false } = {}) {
  const { url, key } = authConfig();
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (admin) headers.Authorization = 'Bearer ' + key;
  const r = await fetch(url + '/auth/v1/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const raw = await r.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  return { status: r.status, data };
}

const USER_COLUMNS = 'auth_user_id,email,display_name,role,active,created_at';

async function findAccount(orgId, authUserId, fetchRows) {
  const rows = await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) +
    '&auth_user_id=eq.' + encodeURIComponent(authUserId) + '&select=' + USER_COLUMNS + '&limit=1');
  return rows?.[0] || null;
}

export function sessionPayload(account, tokens) {
  const isOwner = account.role === 'owner' || account.role === 'partner';
  return {
    user: { email: account.email, display_name: account.display_name, role: account.role },
    refresh_token: tokens.refresh_token,
    pilot_token: process.env.OFFICE_MANAGER_ACCESS_TOKEN || null,
    owner_token: isOwner ? (process.env.OFFICE_MANAGER_OWNER_TOKEN || null) : null
  };
}

async function accountFromTokens(orgId, tokens, fetchRows) {
  const id = tokens?.user?.id;
  if (!id || !tokens.refresh_token) throw err('INVALID_CREDENTIALS', 401);
  const account = await findAccount(orgId, id, fetchRows);
  if (!account || !account.active) throw err('ACCOUNT_NOT_ALLOWED', 403);
  return sessionPayload(account, tokens);
}

export async function login(orgId, body = {}, deps = {}) {
  const call = deps.authCall || authCall;
  const fetchRows = deps.fetchRows || rest;
  const email = cleanEmail(body.email);
  const password = String(body.password || '');
  if (!password) throw err('INVALID_CREDENTIALS', 401);
  const r = await call('token?grant_type=password', { body: { email, password } });
  if (r.status === 429) throw err('TOO_MANY_ATTEMPTS', 429);
  if (r.status !== 200) throw err('INVALID_CREDENTIALS', 401);
  return accountFromTokens(orgId, r.data, fetchRows);
}

export async function refreshSession(orgId, body = {}, deps = {}) {
  const call = deps.authCall || authCall;
  const fetchRows = deps.fetchRows || rest;
  const token = String(body.refresh_token || '');
  if (!token || token.length > 2000) throw err('SESSION_EXPIRED', 401);
  const r = await call('token?grant_type=refresh_token', { body: { refresh_token: token } });
  if (r.status !== 200) throw err('SESSION_EXPIRED', 401);
  return accountFromTokens(orgId, r.data, fetchRows);
}

export async function logout(body = {}, deps = {}) {
  // Best effort: the browser forgets the session in any case.
  const call = deps.authCall || authCall;
  const token = String(body.refresh_token || '');
  if (token) { try { await call('token?grant_type=refresh_token', { body: { refresh_token: token } }); } catch { /* ignore */ } }
  return { logged_out: true };
}

async function createAuthUser(email, password, call) {
  const r = await call('admin/users', { admin: true, body: { email, password, email_confirm: true } });
  if (r.status === 422 || r.status === 409) throw err('EMAIL_ALREADY_USED', 409);
  if (r.status !== 200 && r.status !== 201) throw new Error('AUTH_CREATE_FAILED');
  const id = r.data?.id || r.data?.user?.id;
  if (!UUID.test(id || '')) throw new Error('AUTH_CREATE_FAILED');
  return id;
}

function cleanName(value) {
  const v = String(value || '').trim();
  if (v.length < 1 || v.length > 120) throw err('INVALID_NAME', 400);
  return v;
}

// First owner of the firm: needs the owner code, and only works while no account exists.
export async function bootstrapOwner(orgId, req, deps = {}) {
  const call = deps.authCall || authCall;
  const fetchRows = deps.fetchRows || rest;
  requireFirmOwner(req);
  const body = req.body || {};
  const existing = await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&select=auth_user_id&limit=1');
  if (existing?.length) throw err('ACCOUNTS_ALREADY_EXIST', 409);
  const email = cleanEmail(body.email);
  const password = checkPassword(body.password);
  const name = cleanName(body.display_name);
  const id = await createAuthUser(email, password, call);
  await fetchRows('office_app_users', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ org_id: orgId, auth_user_id: id, email, display_name: name, role: 'owner', active: true }]) });
  return login(orgId, { email, password }, { authCall: call, fetchRows });
}

// Owner / partner: list and manage the firm's accounts.
export async function listAccounts(orgId, fetchRows = rest) {
  const rows = await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&select=' + USER_COLUMNS + '&order=display_name.asc&limit=200');
  return { users: rows || [] };
}

export async function manageAccount(orgId, body = {}, deps = {}) {
  const call = deps.authCall || authCall;
  const fetchRows = deps.fetchRows || rest;
  const action = String(body.action || '');
  if (action === 'create') {
    const email = cleanEmail(body.email);
    const password = checkPassword(body.password);
    const name = cleanName(body.display_name);
    const role = ROLES.includes(body.role) ? body.role : 'collaborator';
    const id = await createAuthUser(email, password, call);
    await fetchRows('office_app_users', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ org_id: orgId, auth_user_id: id, email, display_name: name, role, active: true }]) });
    return { created: true, email, role };
  }
  const id = String(body.auth_user_id || '');
  if (!UUID.test(id)) throw err('VALID_USER_REQUIRED', 400);
  const account = await findAccount(orgId, id, fetchRows);
  if (!account) throw err('USER_NOT_FOUND', 404);
  const filter = 'office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&auth_user_id=eq.' + encodeURIComponent(id);
  const patch = fields => fetchRows(filter, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }) });
  if (action === 'deactivate' || action === 'reactivate') {
    if (action === 'deactivate' && account.role === 'owner') {
      const owners = await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&role=eq.owner&active=eq.true&select=auth_user_id&limit=2');
      if ((owners || []).length < 2) throw err('LAST_OWNER', 409);
    }
    await patch({ active: action === 'reactivate' });
    return { updated: true, active: action === 'reactivate' };
  }
  if (action === 'set_role') {
    if (!ROLES.includes(body.role)) throw err('INVALID_ROLE', 400);
    if (account.role === 'owner' && body.role !== 'owner') {
      const owners = await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&role=eq.owner&active=eq.true&select=auth_user_id&limit=2');
      if ((owners || []).length < 2) throw err('LAST_OWNER', 409);
    }
    await patch({ role: body.role });
    return { updated: true, role: body.role };
  }
  if (action === 'reset_password') {
    const password = checkPassword(body.password);
    const r = await call('admin/users/' + id, { method: 'PUT', admin: true, body: { password } });
    if (r.status !== 200) throw new Error('AUTH_UPDATE_FAILED');
    return { updated: true };
  }
  throw err('UNKNOWN_ACTION', 400);
}
