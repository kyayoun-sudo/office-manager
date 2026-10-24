import { rest } from './supabase.js';
import { multiCabinet, pilotOrgId } from './firm-context.js';
import { requireFirmOwner } from './owner-auth.js';

// Login by e-mail and password (Supabase Auth), with application roles kept in
// office_app_users: owner / partner (associé-gérant) / collaborator.
// Passwords never pass through this module's storage: Supabase Auth checks them.
//
// After a successful login the browser receives the existing pilot token (and the
// owner token for owner/partner), so every existing endpoint keeps working
// unchanged. The browser keeps the session until "Se déconnecter"; each page
// re-checks it with the refresh token, so a deactivated account is logged out.

// The roles live in lib/roles.js (2026-10-10: roles and positions of the firm).
import { ROLES, FIRM_LEAD, mayGrant } from './roles.js';
export { ROLES };
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

export function sessionPayload(account, tokens, orgId = null) {
  const isOwner = account.role === 'owner' || account.role === 'partner';
  // The owner code is the pilot firm's: never handed to another firm's owners (several firms per installation).
  const pilot = !multiCabinet() || !orgId || orgId === pilotOrgId();
  return {
    user: { email: account.email, display_name: account.display_name, role: account.role },
    refresh_token: tokens.refresh_token,
    // Short-lived personal token: the server checks it on sensitive routes.
    access_token: tokens.access_token || null,
    pilot_token: process.env.OFFICE_MANAGER_ACCESS_TOKEN || null,
    owner_token: isOwner && pilot ? (process.env.OFFICE_MANAGER_OWNER_TOKEN || null) : null
  };
}

// ---- The firm's space (Paul, 2026-10-11: « quand je ferme mon compte, je veux que toutes les données du
// cabinet partent ; quand je recrée un compte, je recommence une configuration nouvelle »). The LAST owner who
// closes the space erases it (lib/firm-purge.js: Office Manager's data of this firm, the agents' memory in the
// Drive, the login accounts; never the firm's documents). The next person to create an account is the owner of
// a blank space and goes through « Démarrer » (account, Google, Drive).
// A space closed before this rule (accounts kept, none active) is restarted by its former owner (or an address
// of FIRST_OWNER_EMAILS) with the same explicit confirmation: FIRM_CLOSED, then route firm-restart.
async function activeCount(orgId, fetchRows) {
  return (await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&active=eq.true&select=auth_user_id&limit=1') || []).length;
}
async function readSettings(orgId, fetchRows) {
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + encodeURIComponent(orgId) + '&select=settings&limit=1').catch(() => null);
  return (Array.isArray(rows) && rows[0]?.settings) || {};
}
export function mayReopen(account, space = {}, env = process.env) {
  const email = String(account?.email || '').toLowerCase();
  const allowed = String(env.FIRST_OWNER_EMAILS || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  return Boolean(email && (email === String(space.closed_by || '').toLowerCase() || account?.role === 'owner' || allowed.includes(email)));
}
export const ERASE_WORD = 'EFFACER';
const erased = s => String(s || '').trim().toUpperCase() === ERASE_WORD;

// Restart a closed space from zero: identity checked (password or Google session), explicit « EFFACER ».
export async function restartFirm(orgId, body = {}, deps = {}) {
  const call = deps.authCall || authCall;
  const fetchRows = deps.fetchRows || rest;
  if (!erased(body.confirm)) throw err('TYPE_EFFACER_TO_CONFIRM', 400);
  let tokens = null;
  if (body.refresh_token) {
    const r = await call('token?grant_type=refresh_token', { body: { refresh_token: String(body.refresh_token).slice(0, 2000) } });
    if (r.status !== 200 || !r.data?.user?.id) throw err('SESSION_EXPIRED', 401);
    tokens = r.data;
  } else {
    const r = await call('token?grant_type=password', { body: { email: cleanEmail(body.email), password: String(body.password || '') } });
    if (r.status === 429) throw err('TOO_MANY_ATTEMPTS', 429);
    if (r.status !== 200 || !r.data?.user?.id) throw err('INVALID_CREDENTIALS', 401);
    tokens = r.data;
  }
  const id = tokens.user.id, email = cleanEmail(tokens.user.email || body.email);
  if (await activeCount(orgId, fetchRows)) throw err('FIRM_NOT_CLOSED', 409);
  const existing = await findAccount(orgId, id, fetchRows);
  if (!mayReopen(existing || { email }, (await readSettings(orgId, fetchRows)).space, deps.env || process.env)) throw err('ACCOUNT_PENDING', 403);
  const name = existing?.display_name || String(tokens.user.user_metadata?.full_name || tokens.user.user_metadata?.name || email.split('@')[0]).slice(0, 120);
  await (deps.purgeFirm || (await import('./firm-purge.js')).purgeFirm)(orgId, { email, auth_user_id: id }, { ...deps, keepAuthUser: id });
  await fetchRows('office_app_users', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ org_id: orgId, auth_user_id: id, email, display_name: name, role: 'owner', active: true }]) });
  return { restarted: true, session: sessionPayload({ email, display_name: name, role: 'owner' }, tokens) };
}

// « Repartir de zéro » (Paul, 2026-10-11) for the owner who is connected: everything of the firm is erased exactly
// as when the space is closed (lib/firm-purge.js), except this person's login; they stay owner of a blank space
// and go through « Démarrer » again (Google, Drive). Typed « EFFACER ».
export async function resetFirm(orgId, account, body = {}, deps = {}) {
  const fetchRows = deps.fetchRows || rest;
  if (!account?.auth_user_id || account.role !== 'owner') throw err('OWNER_ONLY', 403);
  if (!erased(body.confirm)) throw err('TYPE_EFFACER_TO_CONFIRM', 400);
  const report = await (deps.purgeFirm || (await import('./firm-purge.js')).purgeFirm)(orgId, account, { ...deps, keepAuthUser: account.auth_user_id });
  await fetchRows('office_app_users', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ org_id: orgId, auth_user_id: account.auth_user_id, email: account.email, display_name: account.display_name || String(account.email || '').split('@')[0], role: 'owner', active: true }]) });
  return { reset: true, report };
}

async function accountFromTokens(orgId, tokens, fetchRows) {
  const id = tokens?.user?.id;
  if (!id || !tokens.refresh_token) throw err('INVALID_CREDENTIALS', 401);
  const account = await findAccount(orgId, id, fetchRows);
  if (multiCabinet()) {
    // Several firms: the session says which firm it works on and lists the person's firms (the selector).
    const { myCabinets } = await import('./cabinet-onboarding.js');
    const cabinets = await myCabinets({ id }, { fetchRows });
    const chosen = account?.active ? { org_id: orgId, account } : null;
    const other = chosen ? null : cabinets[0];
    if (chosen || other) {
      const acc = chosen ? account : await findAccount(other.org_id, id, fetchRows);
      const org = chosen ? orgId : other.org_id;
      return { ...sessionPayload(acc, tokens, org), org_id: org, cabinets };
    }
    // Signed in, member of no firm yet (or only of a closed / pending one): create a firm or join one by invitation.
    if (!account) return { user: { email: cleanEmail(tokens.user.email), display_name: tokens.user.user_metadata?.display_name || null, role: null },
      refresh_token: tokens.refresh_token, access_token: tokens.access_token || null, pilot_token: process.env.OFFICE_MANAGER_ACCESS_TOKEN || null,
      owner_token: null, org_id: null, cabinets: [], needs_cabinet: true };
  }
  if (!account) throw err('ACCOUNT_NOT_ALLOWED', 403);
  // A space closed earlier (no active account left): its former owner may restart it from zero (FIRM_CLOSED →
  // the login page asks for « EFFACER », then route firm-restart).
  if (!account.active && !(await activeCount(orgId, fetchRows)) && mayReopen(account, (await readSettings(orgId, fetchRows)).space)) throw err('FIRM_CLOSED', 409);
  // Created by sign-up, waiting for the owner (or deactivated): no access.
  if (!account.active) throw err('ACCOUNT_PENDING', 403);
  return sessionPayload(account, tokens, orgId);
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

// Owner, partners, IT administrator: list and manage the firm's accounts. Position and « reports to »
// come with them once db/roles.sql is installed (before that, the list still works without them).
export async function listAccounts(orgId, fetchRows = rest) {
  const base = 'office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&order=display_name.asc&limit=200&select=' + USER_COLUMNS;
  try { return { users: await fetchRows(base + ',position,reports_to') || [], roles_installed: true }; }
  catch { return { users: await fetchRows(base) || [], roles_installed: false }; }
}
const missingColumns = e => /position|reports_to|column|PGRST204|42703|check constraint|23514/i.test(String(e?.message || e));

const cleanPosition = v => { const s = String(v ?? '').trim().slice(0, 120); return s || null; };
export async function manageAccount(orgId, body = {}, deps = {}) {
  const call = deps.authCall || authCall;
  const fetchRows = deps.fetchRows || rest;
  // Who acts (personal session). The former owner-code path acts as an owner.
  const actor = deps.actor || { role: 'owner' };
  const action = String(body.action || '');
  if (action === 'create') {
    const email = cleanEmail(body.email);
    const name = cleanName(body.display_name);
    const role = ROLES.includes(body.role) ? body.role : 'auditor';
    if (!mayGrant(actor, role)) throw err('ROLE_NOT_GRANTABLE', 403);
    const extra = {};
    if (body.position) extra.position = cleanPosition(body.position);
    if (body.reports_to) { if (!UUID.test(String(body.reports_to))) throw err('VALID_MANAGER_REQUIRED', 400); extra.reports_to = String(body.reports_to); }
    const password = checkPassword(body.password);
    const id = await createAuthUser(email, password, call);
    try {
      await fetchRows('office_app_users', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([{ org_id: orgId, auth_user_id: id, email, display_name: name, role, active: true, ...extra }]) });
    } catch (e) { if (missingColumns(e)) throw err('ROLES_SQL_NOT_INSTALLED', 409); throw e; }
    return { created: true, email, role };
  }
  const id = String(body.auth_user_id || '');
  if (!UUID.test(id)) throw err('VALID_USER_REQUIRED', 400);
  const account = await findAccount(orgId, id, fetchRows);
  if (!account) throw err('USER_NOT_FOUND', 404);
  const filter = 'office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&auth_user_id=eq.' + encodeURIComponent(id);
  const patch = fields => fetchRows(filter, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }) });
  // The IT administrator manages accounts, never those of the firm's owners and partners.
  if (actor.role === 'it_admin' && FIRM_LEAD.includes(account.role)) throw err('ROLE_NOT_GRANTABLE', 403);
  if (action === 'set_profile') {
    const fields = {};
    if ('position' in body) fields.position = cleanPosition(body.position);
    if ('reports_to' in body) {
      const to = body.reports_to ? String(body.reports_to) : null;
      if (to && (!UUID.test(to) || to === id)) throw err('VALID_MANAGER_REQUIRED', 400);
      fields.reports_to = to;
    }
    try { await patch(fields); } catch (e) { if (missingColumns(e)) throw err('ROLES_SQL_NOT_INSTALLED', 409); throw e; }
    return { updated: true, ...fields };
  }
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
    if (!mayGrant(actor, body.role, account.role, Boolean(actor.auth_user_id) && actor.auth_user_id === id)) throw err('ROLE_NOT_GRANTABLE', 403);
    if (account.role === 'owner' && body.role !== 'owner') {
      const owners = await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&role=eq.owner&active=eq.true&select=auth_user_id&limit=2');
      if ((owners || []).length < 2) throw err('LAST_OWNER', 409);
    }
    try { await patch({ role: body.role }); } catch (e) { if (missingColumns(e)) throw err('ROLES_SQL_NOT_INSTALLED', 409); throw e; }
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

// ---- Sign-up (Paul, 2026-10-07: "tout le monde peut se connecter la première fois : mail, nom,
// mot de passe ; ensuite on signifie qu'on est propriétaire et on met le code") ----
// Anyone can create their account; it stays INACTIVE (no access at all) until the owner gives
// it a role in Paramètres → Comptes du cabinet. An address that already has a password elsewhere
// (another firm on the same server) must give that password: nobody can take an address over.

async function authIdFor(email, password, call) {
  const r = await call('token?grant_type=password', { body: { email, password } });
  if (r.status === 429) throw err('TOO_MANY_ATTEMPTS', 429);
  if (r.status === 200 && r.data?.user?.id) return { id: r.data.user.id, tokens: r.data };
  return null;
}

export async function signUp(orgId, body = {}, deps = {}) {
  const call = deps.authCall || authCall;
  const fetchRows = deps.fetchRows || rest;
  const email = cleanEmail(body.email);
  const password = checkPassword(body.password);
  const name = cleanName(body.display_name);
  if (multiCabinet(deps.env)) {
    // Several firms: the address is confirmed by Supabase's e-mail (never confirmed on the person's behalf), and the
    // newcomer belongs to no firm — never the pilot's. After confirming: create a firm, or join one by invitation.
    const r = await call('signup', { body: { email, password, data: { display_name: name } } });
    if (r.status === 429) throw err('TOO_MANY_ATTEMPTS', 429);
    if (r.status < 200 || r.status >= 300) throw err('REGISTRATION_FAILED', 400);
    // A confirmed address is signed in straight away (Supabase setting « Confirm email » off): the session has no firm yet.
    if (r.data?.access_token && r.data?.refresh_token) return { created: true, session: await accountFromTokens(orgId, r.data, fetchRows) };
    return { created: true, confirmation_required: true, email };
  }
  let id;
  try { id = await createAuthUser(email, password, call); }
  catch (e) {
    if (e.message !== 'EMAIL_ALREADY_USED') throw e;
    const known = await authIdFor(email, password, call);
    if (!known) throw err('EMAIL_ALREADY_USED_WRONG_PASSWORD', 409);
    id = known.id;
  }
  const existing = await findAccount(orgId, id, fetchRows);
  // A closed space (no active account): its former owner restarts it from zero (explicit confirmation).
  if (existing && !existing.active && !(await activeCount(orgId, fetchRows)) && mayReopen(existing, (await readSettings(orgId, fetchRows)).space)) throw err('FIRM_CLOSED', 409);
  if (existing) throw err('ACCOUNT_ALREADY_EXISTS', 409);
  // A firm with no ACTIVE account (new, or its space closed): the first person to sign up sets it up and
  // becomes its owner (no code to remember). Everyone after waits for a role given by the owner.
  // A closed space (accounts exist, none active) is reopened only by its former owner (above) or an address
  // listed in FIRST_OWNER_EMAILS — never by a newcomer who happens to sign up first.
  const anyRow = (await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&select=auth_user_id&limit=1') || []).length > 0;
  if (anyRow && !(await activeCount(orgId, fetchRows)) && mayReopen({ email }, {}, deps.env || process.env)) throw err('FIRM_CLOSED', 409);
  const first = !anyRow;
  await fetchRows('office_app_users', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ org_id: orgId, auth_user_id: id, email, display_name: name, role: first ? 'owner' : 'collaborator', active: first }]) });
  if (first) { return { created: true, owner: true, session: await login(orgId, { email, password }, { authCall: call, fetchRows }) }; }
  return { created: true, pending: true, email };
}

// "Je suis le propriétaire du cabinet": e-mail + password (who you are) + owner code (proof).
// The account becomes owner and active; it is created on the spot if it did not exist yet.
export async function claimOwner(orgId, req, deps = {}) {
  const call = deps.authCall || authCall;
  const fetchRows = deps.fetchRows || rest;
  requireFirmOwner(req);
  const body = req.body || {};
  const email = cleanEmail(body.email);
  const password = String(body.password || '');
  if (!password) throw err('INVALID_CREDENTIALS', 401);
  const known = await authIdFor(email, password, call);
  if (!known) throw err('INVALID_CREDENTIALS', 401);
  const filter = 'office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&auth_user_id=eq.' + encodeURIComponent(known.id);
  if (await findAccount(orgId, known.id, fetchRows)) {
    await fetchRows(filter, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ role: 'owner', active: true, updated_at: new Date().toISOString() }) });
  } else {
    await fetchRows('office_app_users', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ org_id: orgId, auth_user_id: known.id, email, display_name: cleanName(body.display_name || email.split('@')[0]), role: 'owner', active: true }]) });
  }
  return login(orgId, { email, password }, { authCall: call, fetchRows });
}


// ---- "Continuer avec Google" (Paul, 2026-10-07: "je veux des connexions simples comme Google") ----
// Supabase Auth runs the Google sign-in and sends the browser back with a session; the server
// re-checks that session itself with Supabase (refresh token), never trusting the browser's word.
//   - the account exists for this firm → normal login (inactive = waiting for a role);
//   - first person of a firm that has NO account yet → becomes the owner (setting up the firm);
//     FIRST_OWNER_EMAILS (optional) limits who may do that;
//   - anyone else → account created INACTIVE, waiting for the owner to give a role.
export async function oauthLogin(orgId, body = {}, deps = {}) {
  const call = deps.authCall || authCall;
  const fetchRows = deps.fetchRows || rest;
  const env = deps.env || process.env;
  const token = String(body.refresh_token || '');
  if (!token || token.length > 2000) throw err('SESSION_EXPIRED', 401);
  const r = await call('token?grant_type=refresh_token', { body: { refresh_token: token } });
  if (r.status !== 200 || !r.data?.user?.id) throw err('SESSION_EXPIRED', 401);
  const user = r.data.user;
  const email = cleanEmail(user.email);
  if (user.email_confirmed_at === null) throw err('EMAIL_NOT_VERIFIED', 403);
  if (!await findAccount(orgId, user.id, fetchRows)) {
    const any = await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&select=auth_user_id&limit=1');
    const allowed = String(env.FIRST_OWNER_EMAILS || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    // A brand-new firm: the first person; a closed space: only an address listed in FIRST_OWNER_EMAILS
    // (its former owner reopens it simply by logging in, in accountFromTokens).
    const hadRows = Boolean(any?.length);
    // A closed space: an address of FIRST_OWNER_EMAILS may restart it, with the explicit confirmation.
    if (hadRows && !(await activeCount(orgId, fetchRows)) && allowed.includes(email)) throw err('FIRM_CLOSED', 409);
    const firstOwner = !hadRows && (!allowed.length || allowed.includes(email));
    const name = String(user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0]).slice(0, 120);
    await fetchRows('office_app_users', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ org_id: orgId, auth_user_id: user.id, email, display_name: name, role: firstOwner ? 'owner' : 'collaborator', active: firstOwner }]) });
  }
  return accountFromTokens(orgId, r.data, fetchRows);
}

// Public: where the browser starts the Google sign-in (Supabase Auth, provider google).
export function authStartUrl(provider, redirectTo, env = process.env) {
  if (!['google', 'azure'].includes(provider)) throw err('PROVIDER_NOT_SUPPORTED', 400);
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!url) throw err('SUPABASE_SERVER_CONFIG_MISSING', 503);
  const p = new URLSearchParams({ provider, redirect_to: redirectTo });
  if (provider === 'azure') p.set('scopes', 'email');
  return url + '/auth/v1/authorize?' + p;
}


// Public: does this firm already have accounts? (the start page shows "Démarrer" when not)
export async function setupState(orgId, fetchRows = rest, call = authCall) {
  const any = await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&active=eq.true&select=auth_user_id&limit=1');
  // "Continuer avec Google" is shown only once Google sign-in is switched on in Supabase Auth.
  let google = false;
  try { const r = await call('settings', { method: 'GET' }); google = Boolean(r.status === 200 && r.data?.external?.google); } catch { google = false; }
  return { has_accounts: Boolean(any?.length), google_login: google };
}

// « On peut aussi décider de fermer son compte » (Paul, 2026-10-07). Anyone closes their own account by typing
// their e-mail (it is deactivated; an owner can reactivate it). The LAST owner closes the firm's space with it
// and, since 2026-10-11, the space is ERASED (typed « EFFACER »): lib/firm-purge.js. The firm's documents in
// its Drive are never touched.
export async function closeOwnAccount(orgId, account, body = {}, deps = {}) {
  const fetchRows = deps.fetchRows || rest;
  if (!account?.auth_user_id) throw err('USER_SESSION_REQUIRED', 401);
  if (String(body.confirm || '').trim().toLowerCase() !== String(account.email || '').toLowerCase()) throw err('CONFIRM_WITH_YOUR_EMAIL', 400);
  let firmClosed = false;
  if (account.role === 'owner') {
    const owners = await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&role=eq.owner&active=eq.true&select=auth_user_id&limit=2') || [];
    if (owners.length < 2) {
      if (body.close_firm !== true) throw err('LAST_OWNER_CLOSES_FIRM', 409);
      if (!erased(body.confirm_erase)) throw err('TYPE_EFFACER_TO_CONFIRM', 400);
      const report = await (deps.purgeFirm || (await import('./firm-purge.js')).purgeFirm)(orgId, account, deps);
      return { closed: true, firm_closed: true, erased: true, report };
    }
  }
  await fetchRows('office_app_users?org_id=eq.' + encodeURIComponent(orgId) + '&auth_user_id=eq.' + encodeURIComponent(account.auth_user_id),
    { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }) });
  return { closed: true, firm_closed: firmClosed };
}
