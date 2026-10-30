// Several firms in one installation (Paul, 2026-10-24). The firm of a request is fixed ONCE, here, and every
// module reads it from this context: business functions keep their signatures and never guess a firm.
//   - OFFICE_MANAGER_MULTI_CABINET=on : the firm comes from x-office-manager-org, accepted only for a signed
//     internal call or a person who is an active member of that firm; otherwise DEFAULT_ORG_ID (pilot, unchanged).
//   - Server-level credentials and pilot settings (service account, bridge, TATY_* ids, mailbox…) belong to the
//     pilot firm only (DEFAULT_ORG_ID): another firm never works with them, it connects its own Google.
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
let lastOrg = null; // single-firm behaviour outside a request context (tests, scripts): the firm last loaded

export const multiCabinet = (env = process.env) => String(env.OFFICE_MANAGER_MULTI_CABINET || '').toLowerCase() === 'on';
export const pilotOrgId = (env = process.env) => env.DEFAULT_ORG_ID || null;
export const isUuid = v => UUID.test(String(v || ''));

export function runInFirm(orgId, run) { if (orgId) lastOrg = orgId; return store.run({ orgId }, run); }
export function noteFirm(orgId) { if (orgId && !store.getStore()) lastOrg = orgId; }
// Several firms: outside a request context there is NO firm (fail closed), never the one served last.
export function currentOrgId(env = process.env) {
  const here = store.getStore()?.orgId;
  if (here) return here;
  return multiCabinet(env) ? null : lastOrg || pilotOrgId(env);
}

// Server credentials and pilot settings: the pilot firm only, as soon as several firms share the installation.
export function serverCredentialsAllowed(env = process.env) {
  if (!multiCabinet(env)) return true;
  const org = currentOrgId(env);
  return Boolean(org) && org === pilotOrgId(env);
}

function internalSecret(env = process.env) {
  // Last resort: the server-only Supabase key (always set, never sent anywhere; only an HMAC of it travels), so the
  // background steps keep working on an installation without a dedicated secret (audit 2026-10-30).
  return env.OFFICE_MANAGER_INTERNAL_SECRET || env.OFFICE_MANAGER_SCHEDULER_SECRET || env.ORPAILLEUR_JOB_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
}
export function internalSignature(orgId, env = process.env) {
  const secret = internalSecret(env);
  return secret && orgId ? crypto.createHmac('sha256', secret).update('office-manager-org:' + orgId).digest('hex') : '';
}
// Headers carried by a background call to another endpoint of the app (lib/agent-passes.js fireInternal).
// Signed with one firm too (audit 2026-10-30): /api/agent tells the server's own calls (scheduled passes, no person) from a
// browser that has only the shared pilot token. Without a secret, nothing is signed.
export function internalHeaders(orgId = currentOrgId(), env = process.env) {
  const signature = internalSignature(orgId, env);
  if (!orgId || !signature) return {};
  return { 'x-office-manager-org': orgId, 'x-office-manager-internal': signature };
}
export function isSignedInternal(req, orgId, env = process.env) {
  const given = Buffer.from(String(req?.headers?.['x-office-manager-internal'] || ''));
  const want = Buffer.from(internalSignature(orgId, env));
  return want.length > 0 && given.length === want.length && crypto.timingSafeEqual(given, want);
}

// The firm a request works on. requireMember: the person must belong to it (or the call is signed internally).
// Without the switch, nothing changes: DEFAULT_ORG_ID.
export async function resolveRequestOrg(req, options = {}) {
  const orgId = await resolveOrg(req, options);
  // The rest of this request (its awaits included) works on this firm, even outside runInFirm.
  if (orgId) { if (!multiCabinet(options.env)) lastOrg = orgId; store.enterWith({ orgId }); }
  return orgId;
}
async function resolveOrg(req, { requireMember = true, env = process.env, currentAccount } = {}) {
  const pilot = pilotOrgId(env);
  if (!multiCabinet(env)) return pilot;
  const header = String(req?.headers?.['x-office-manager-org'] || '').trim();
  if (header && !isUuid(header)) throw fail('INVALID_CABINET', 400);
  const orgId = header || pilot;
  if (!orgId) throw fail('CABINET_REQUIRED', 400);
  req.orgId = orgId;
  if (isSignedInternal(req, orgId, env)) { req.internal = true; return orgId; }
  if (!requireMember) return orgId;
  const check = currentAccount || (await import('./user-auth.js')).currentAccount;
  try { req.account = await check(req, { orgId }); }
  catch (e) { if (['USER_SESSION_REQUIRED', 'TOKEN_EXPIRED'].includes(e.message)) throw e; throw fail('NOT_IN_THIS_CABINET', 403); }
  return orgId;
}

export function _resetFirmContext() { lastOrg = null; }
