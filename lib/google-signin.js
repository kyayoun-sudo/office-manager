import { rest } from './supabase.js';
import { authCall } from './accounts.js';
import { exchangeCode, saveConnection, finishConnect, startSignin, SCOPES } from './google-connection.js';

// "Continuer avec Google" — like Claude or ChatGPT (Paul, 2026-10-07: « pourquoi se compliquer
// la vie ? »). No password to create: Google says who the person is.
//   - A firm with no account yet: the first person becomes its owner, and the same Google page
//     grants Drive + Gmail to the firm (no second "Connecter Google").
//   - Afterwards: Google only identifies; the account waits for a role given by the owner.
// The Supabase session is opened server-side (admin magic link, verified at once), then the
// browser finishes on /login.html exactly like the existing "oauth-login" path.

const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });

async function firmHasAccounts(orgId, fetchRows) {
  const any = await fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&select=auth_user_id&limit=1');
  return Boolean(any?.length);
}

export async function signinUrl(orgId, req, d = {}) {
  const fetchRows = d.fetchRows || rest;
  return startSignin(orgId, req, { full: !(await firmHasAccounts(orgId, fetchRows)) }, d.env);
}

// Opens a Supabase session for a Google-verified e-mail (user created on first visit).
export async function sessionForEmail(email, name, call = authCall) {
  const created = await call('admin/users', { admin: true, body: { email, email_confirm: true, user_metadata: { full_name: name || undefined } } });
  if (![200, 201, 409, 422].includes(created.status)) throw fail('AUTH_CREATE_FAILED', 502);
  const link = await call('admin/generate_link', { admin: true, body: { type: 'magiclink', email } });
  const hash = link.data?.properties?.hashed_token || link.data?.hashed_token;
  if (link.status !== 200 || !hash) throw fail('AUTH_LINK_FAILED', 502);
  for (const type of ['magiclink', 'email']) {
    const v = await call('verify', { body: { type, token_hash: hash } });
    if (v.status === 200 && v.data?.refresh_token) return v.data;
  }
  throw fail('AUTH_SESSION_FAILED', 502);
}

// Google sends the person back to /oauth/google/callback: sign-in or "Connecter Google".
export async function completeGoogleReturn(orgId, req, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const peek = (() => { try { return JSON.parse(Buffer.from(String(req.query?.state || '').split('.')[0], 'base64url').toString('utf8')); } catch { return {}; } })();
  if (peek.m !== 'signin') {
    const r = await finishConnect(orgId, req, d);
    return { __redirect: r.return_to + '?google=ok&email=' + q(r.email) + '#google' };
  }
  const x = await exchangeCode(orgId, req, d);          // verifies the signed state
  if (x.st.m !== 'signin') throw fail('OAUTH_STATE_INVALID');
  const session = await sessionForEmail(x.email, x.name, d.authCall || authCall);
  const userId = session.user?.id;
  const rows = userId ? await fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&auth_user_id=eq.' + q(userId) + '&select=role,active&limit=1') : [];
  const mine = rows?.[0] || null;
  const first = !mine && !(await firmHasAccounts(orgId, fetchRows));
  if (first) {
    await fetchRows('office_app_users', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ org_id: orgId, auth_user_id: userId, email: x.email, display_name: x.name || x.email.split('@')[0], role: 'owner', active: true }]) });
  }
  const owner = first || (mine && mine.active && ['owner', 'partner'].includes(mine.role));
  // The firm's Google access, granted on the same page (first owner, or an owner re-granting).
  if (owner && x.refresh && x.scopes.includes(SCOPES.drive)) {
    await saveConnection(orgId, { email: x.email, refresh: x.refresh, scopes: x.scopes, by: x.name || x.email }, d);
  }
  const h = new URLSearchParams({ refresh_token: session.refresh_token });
  if (first) h.set('setup', '1');
  return { __redirect: '/login.html#' + h };
}
