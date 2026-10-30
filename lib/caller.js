import { isSignedInternal } from './firm-context.js';

// Who is calling an endpoint (audit 2026-10-30): a person with their own session, or the server itself (a background
// call signed by lib/firm-context.js). The shared pilot token is in every browser: alone, it is neither.
// Returns the person's account, or null for the signed server call. Throws USER_SESSION_REQUIRED / ACCOUNT_NOT_ALLOWED.
export async function requirePersonOrServer(req, orgId, d = {}) {
  if (isSignedInternal(req, orgId)) return null;
  if (req.account) return req.account;
  const check = d.currentAccount || (await import('./user-auth.js')).currentAccount;
  req.account = await check(req, { orgId });
  return req.account;
}

// The missions a caller may see. null = all (the server, or a role the firm's rights let see every mission).
export async function visibleMissionIds(orgId, account, d = {}) {
  if (!account) return null;
  const { requireScreenAccess } = d.permissions || await import('./permissions.js');
  const access = await requireScreenAccess(orgId, account, 'mission', 'view');
  if (!access.mine) return null;
  const { accessibleMissionIds } = d.missionAccess || await import('./mission-access.js');
  return accessibleMissionIds(orgId, account);
}
