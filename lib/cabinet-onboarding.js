import { authCall, cleanEmail, checkPassword } from './accounts.js';
import { rest } from './supabase.js';

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const text = (value, code) => {
  const result = String(value || '').trim();
  if (!result || result.length > 120) throw fail(code, 400);
  return result;
};

// Separate from the pilot signup: never assigns a newcomer to DEFAULT_ORG_ID,
// never confirms an address on their behalf and never returns shared credentials.
export async function registerCabinet(body = {}, deps = {}) {
  const email = cleanEmail(body.email);
  const password = checkPassword(body.password);
  const displayName = text(body.display_name, 'INVALID_NAME');
  const firmName = text(body.firm_name, 'CABINET_NAME_REQUIRED');
  const result = await (deps.authCall || authCall)('signup', {
    body: { email, password, data: { display_name: displayName, firm_name: firmName } }
  });
  if (result.status === 429) throw fail('TOO_MANY_ATTEMPTS', 429);
  if (result.status < 200 || result.status >= 300) throw fail('REGISTRATION_FAILED', 400);
  // Supabase may deliberately return a masked user for an existing address.
  // No identity or permission is inferred from a signup response.
  return { confirmation_required: true };
}

export async function cabinetIdentity(req, deps = {}) {
  const value = String(req.headers?.authorization || req.headers?.Authorization || '');
  const match = /^Bearer\s+([A-Za-z0-9_.-]{20,4096})$/.exec(value);
  if (!match) throw fail('USER_SESSION_REQUIRED', 401);
  const verify = deps.verifyUser || (async token => {
    const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw fail('SUPABASE_SERVER_CONFIG_MISSING', 503);
    const response = await fetch(url + '/auth/v1/user', {
      headers: { apikey: key, Authorization: 'Bearer ' + token }
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw fail('AUTH_CHECK_FAILED', 503);
    return response.json();
  });
  const user = await verify(match[1]);
  if (!user?.id) throw fail('TOKEN_EXPIRED', 401);
  if (!user.email_confirmed_at || user.is_anonymous === true) throw fail('EMAIL_NOT_VERIFIED', 403);
  return user;
}

export async function createCabinet(req, deps = {}) {
  const user = await cabinetIdentity(req, deps);
  const firmName = text(req.body?.firm_name, 'CABINET_NAME_REQUIRED');
  const displayName = text(req.body?.display_name, 'INVALID_NAME');
  // The identity is verified with Auth, not taken from body or user_metadata.
  const result = await (deps.fetchRows || rest)('rpc/office_create_cabinet', {
    method: 'POST', body: JSON.stringify({
      p_auth_user_id: user.id, p_email: cleanEmail(user.email), p_name: firmName, p_display_name: displayName
    })
  });
  return { cabinet: result, operational_access: false };
}

export async function myCabinets(req, deps = {}) {
  const user = await cabinetIdentity(req, deps);
  const rows = await (deps.fetchRows || rest)('office_app_users?auth_user_id=eq.' +
    encodeURIComponent(user.id) + '&active=eq.true&select=org_id,display_name,role&limit=100');
  return { cabinets: rows || [] };
}
