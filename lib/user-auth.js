import crypto from 'node:crypto';
import { rest } from './supabase.js';

// Per-user check on the server, for sensitive routes (team KPIs, coordination).
// The browser sends its Supabase access token (Authorization: Bearer …), received
// at e-mail/password login. The server asks Supabase who it is, then reads the
// person's role in office_app_users. The shared pilot token alone is NOT enough.

const CACHE_MS = 60 * 1000;
const cache = new Map(); // token hash -> { account, until }
const err = (code, statusCode) => Object.assign(new Error(code), { statusCode });

function bearer(req) {
  const h = String(req.headers?.authorization || req.headers?.Authorization || '');
  const m = h.match(/^Bearer\s+([A-Za-z0-9\-_.]{20,4096})$/);
  return m ? m[1] : null;
}

async function supabaseUser(token) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVER_CONFIG_MISSING');
  const r = await fetch(url.replace(/\/$/, '') + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + token } });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error('AUTH_CHECK_FAILED');
  const u = await r.json();
  return u?.id ? u : null;
}

export async function currentAccount(req, deps = {}) {
  const token = bearer(req);
  if (!token) throw err('USER_SESSION_REQUIRED', 401);
  const h = crypto.createHash('sha256').update(token).digest('hex');
  const hit = cache.get(h);
  if (hit && hit.until > Date.now()) return hit.account;
  const user = await (deps.supabaseUser || supabaseUser)(token);
  if (!user) throw err('TOKEN_EXPIRED', 401);
  const orgId = process.env.DEFAULT_ORG_ID;
  const rows = await (deps.fetchRows || rest)('office_app_users?org_id=eq.' + encodeURIComponent(orgId) +
    '&auth_user_id=eq.' + encodeURIComponent(user.id) + '&select=auth_user_id,email,display_name,role,active&limit=1');
  const account = rows?.[0];
  if (!account || !account.active) throw err('ACCOUNT_NOT_ALLOWED', 403);
  cache.set(h, { account, until: Date.now() + CACHE_MS });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return account;
}

export async function requireRole(req, roles, deps = {}) {
  const account = await currentAccount(req, deps);
  if (!roles.includes(account.role)) throw err('ROLE_NOT_ALLOWED', 403);
  return account;
}

// Who looked at what, and when (append-only). Never blocks the request.
export async function logAccess(orgId, account, action, target = null, fetchRows = rest) {
  try {
    await fetchRows('office_access_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{
      org_id: orgId, auth_user_id: account.auth_user_id, email: account.email, role: account.role,
      action: String(action).slice(0, 60), target: target ? String(target).slice(0, 200) : null
    }]) });
  } catch { /* the journal must never break the screen */ }
}

export function _clearAuthCache() { cache.clear(); }
