// Several firms in one installation (Paul, 2026-10-24): at the first login a person joins their firm by
// invitation, or creates one (anyone signed in may; they become its owner). One person may belong to several
// firms; their data never mix (office_app_users is keyed by firm). SQL: db/cabinet-onboarding.sql.
// Invitations: a link for ONE address or a code to share; only a hash is stored; single use; 7 days; revocable;
// the role is fixed by whoever invites and follows lib/roles.js mayGrant (only an owner makes an owner).
import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { cleanEmail } from './accounts.js';
import { ROLES, ACCOUNT_ADMINS, mayGrant } from './roles.js';

const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const q = encodeURIComponent;
const DAY = 24 * 3600 * 1000;
const TTL_DAYS = 7;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const hash = secret => crypto.createHash('sha256').update('office-manager-invitation:' + String(secret).trim().toUpperCase()).digest('hex');
const text = (value, code, max = 120) => {
  const v = String(value ?? '').trim();
  if (!v || v.length > max) throw fail(code, 400);
  return v;
};
const timezone = value => {
  const tz = String(value || 'UTC').trim();
  try { new Intl.DateTimeFormat('fr', { timeZone: tz }); return tz; } catch { throw fail('INVALID_TIMEZONE', 400); }
};
function newCode() {
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out.slice(0, 5) + '-' + out.slice(5);
}

// The firms of a person (active memberships), with each firm's name.
export async function myCabinets(user, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const rows = await fetchRows('office_app_users?auth_user_id=eq.' + q(user.id) + '&active=eq.true&select=org_id,role,display_name&limit=100') || [];
  if (!rows.length) return [];
  const orgs = await fetchRows('office_organizations?id=in.(' + rows.map(r => q(r.org_id)).join(',') + ')&select=id,name&limit=100').catch(() => []) || [];
  const names = new Map(orgs.map(o => [o.id, o.name]));
  return rows.map(r => ({ org_id: r.org_id, name: names.get(r.org_id) || 'Cabinet', role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

// A new firm, its creator as owner. Same person + same name again (double click, retry) = the same firm.
export async function createCabinet(user, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const name = text(body.firm_name, 'CABINET_NAME_REQUIRED');
  const displayName = text(body.display_name || user.user_metadata?.display_name || String(user.email || '').split('@')[0], 'INVALID_NAME');
  const result = await fetchRows('rpc/office_create_cabinet', { method: 'POST', body: JSON.stringify({
    p_auth_user_id: user.id, p_email: cleanEmail(user.email), p_name: name, p_display_name: displayName, p_timezone: timezone(body.timezone)
  }) });
  const out = Array.isArray(result) ? result[0] : result;
  if (!out?.org_id) throw fail('CABINET_SETUP_FAILED', 500);
  await (d.audit || defaultAudit)(out.org_id, 'CABINET_CREATED', user.email, { name, created: out.created !== false });
  return { org_id: out.org_id, name, created: out.created !== false };
}

// An administrator of the firm invites: a link for one address, or a code to share. The secret is shown once.
export async function createInvitation(orgId, account, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  if (!ACCOUNT_ADMINS.includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const role = String(body.role || '');
  if (!ROLES.includes(role)) throw fail('INVALID_ROLE', 400);
  if (!mayGrant(account, role)) throw fail('ROLE_NOT_GRANTABLE', 403);
  const kind = body.kind === 'code' ? 'code' : 'link';
  const email = kind === 'link' ? cleanEmail(body.email) : null;
  const secret = kind === 'link' ? crypto.randomBytes(32).toString('base64url') : newCode();
  const expires = new Date((d.now || Date.now)() + TTL_DAYS * DAY).toISOString();
  const rows = await fetchRows('office_invitations', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{
    org_id: orgId, kind, email, secret_hash: hash(secret), role, invited_by: String(account.email || '').slice(0, 254), expires_at: expires
  }]) });
  const id = rows?.[0]?.id || null;
  await (d.audit || defaultAudit)(orgId, 'INVITATION_CREATED', account.email, { id, kind, email, role, expires_at: expires });
  return { id, kind, email, role, expires_at: expires, ...(kind === 'link' ? { token: secret } : { code: secret }) };
}

export async function listInvitations(orgId, account, d = {}) {
  if (!ACCOUNT_ADMINS.includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const rows = await (d.fetchRows || rest)('office_invitations?org_id=eq.' + q(orgId) +
    '&select=id,kind,email,role,invited_by,expires_at,used_at,revoked_at,created_at&order=created_at.desc&limit=100') || [];
  const now = (d.now || Date.now)();
  return rows.map(r => ({ ...r, state: r.revoked_at ? 'revoked' : r.used_at ? 'used' : Date.parse(r.expires_at) <= now ? 'expired' : 'open' }));
}

export async function revokeInvitation(orgId, account, id, d = {}) {
  if (!ACCOUNT_ADMINS.includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const rows = await (d.fetchRows || rest)('office_invitations?org_id=eq.' + q(orgId) + '&id=eq.' + q(id) + '&used_at=is.null&revoked_at=is.null', {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ revoked_at: new Date((d.now || Date.now)()).toISOString(), revoked_by: account.email })
  }) || [];
  if (!rows.length) throw fail('INVITATION_NOT_OPEN', 409);
  await (d.audit || defaultAudit)(orgId, 'INVITATION_REVOKED', account.email, { id });
  return { revoked: true };
}

// The invited person (signed in) joins: a link works only for its own address; a code for whoever holds it.
// The invitation is claimed FIRST (one use, even with two clicks at once), then the membership is written.
export async function acceptInvitation(user, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const secret = String(body.token || body.code || '').trim();
  if (secret.length < 8 || secret.length > 200) throw fail('INVITATION_NOT_FOUND', 404);
  const found = (await fetchRows('office_invitations?secret_hash=eq.' + hash(secret) + '&select=id,org_id,kind,email,role,expires_at,used_at,used_by,revoked_at&limit=1'))?.[0];
  if (!found) throw fail('INVITATION_NOT_FOUND', 404);
  const email = cleanEmail(user.email);
  if (found.kind === 'link' && found.email !== email) throw fail('INVITATION_FOR_ANOTHER_ADDRESS', 403);
  if (found.revoked_at) throw fail('INVITATION_REVOKED', 410);
  if (found.used_at) {
    if (found.used_by === user.id) return { org_id: found.org_id, joined: true, already: true };
    throw fail('INVITATION_ALREADY_USED', 410);
  }
  const nowIso = new Date((d.now || Date.now)()).toISOString();
  if (Date.parse(found.expires_at) <= Date.parse(nowIso)) throw fail('INVITATION_EXPIRED', 410);
  const claimed = await fetchRows('office_invitations?id=eq.' + q(found.id) + '&used_at=is.null&revoked_at=is.null&expires_at=gt.' + q(nowIso), {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ used_at: nowIso, used_by: user.id })
  }) || [];
  if (!claimed.length) throw fail('INVITATION_ALREADY_USED', 410);
  const displayName = text(body.display_name || user.user_metadata?.display_name || email.split('@')[0], 'INVALID_NAME');
  try {
    await fetchRows('office_app_users?on_conflict=org_id,auth_user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: found.org_id, auth_user_id: user.id, email, display_name: displayName, role: found.role, active: true, updated_at: nowIso }]) });
  } catch (e) {
    // The same address already belongs to another sign-in of this firm: the invitation is given back, nothing is merged.
    await fetchRows('office_invitations?id=eq.' + q(found.id) + '&used_by=eq.' + q(user.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: null, used_by: null }) }).catch(() => null);
    if (/23505|duplicate|unique/i.test(String(e.message))) throw fail('EMAIL_ALREADY_IN_CABINET', 409);
    throw e;
  }
  await (d.audit || defaultAudit)(found.org_id, 'INVITATION_ACCEPTED', email, { id: found.id, role: found.role });
  return { org_id: found.org_id, joined: true, role: found.role };
}

async function defaultAudit(orgId, action, who, detail) {
  try {
    const { audit } = await import('./audit-log.js');
    await audit(orgId, { agent: 'office-manager', action_type: action, approved_by: who || null, output_ref: JSON.stringify(detail || {}) });
  } catch { /* the journal never blocks joining a firm */ }
}
