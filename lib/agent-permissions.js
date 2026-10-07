import { rest } from './supabase.js';

// "Autoriser les agents" (2026-10-07): the firm's owner allows the agents to list the Drive,
// read the selected documents and use the AI — one click in the app, recorded under the
// owner's own identity (the database requires a real approver: office_processing_permissions
// trigger + owner policies, so the grant is written WITH the owner's session, not the server's).
// Outbound messaging stays false here: e-mails go through « À valider » anyway.

const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const FLAGS = ['inventory_metadata_approved', 'selected_content_approved', 'external_ai_approved'];

function bearer(req) {
  const m = String(req.headers?.authorization || req.headers?.Authorization || '').match(/^Bearer\s+([A-Za-z0-9\-_.]{20,4096})$/);
  return m ? m[1] : null;
}

export async function agentPermissions(orgId, fetchRows = rest) {
  const row = (await fetchRows('office_processing_permissions?org_id=eq.' + q(orgId) + '&select=' + FLAGS.join(',') + ',approved_at,revoked_at&limit=1'))?.[0] || null;
  return { granted: Boolean(row && FLAGS.every(f => row[f])), approved_at: row?.approved_at || null, details: row };
}

export async function grantAgentPermissions(orgId, req, d = {}) {
  const fetchRows = d.fetchRows || rest, fetchImpl = d.fetchImpl || fetch, env = d.env || process.env;
  const account = req.account;
  if (!account || !['owner', 'partner'].includes(account.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const token = bearer(req);
  if (!token) throw fail('USER_SESSION_REQUIRED', 401);
  // 0. The firm itself must exist in office_organizations (memberships and permissions refer to it).
  const org = await fetchRows('office_organizations?id=eq.' + q(orgId) + '&select=id&limit=1');
  if (!org?.length) {
    let name = 'Cabinet';
    try { name = (await fetchRows('office_org_branding?org_id=eq.' + q(orgId) + '&select=firm_name&limit=1'))?.[0]?.firm_name || name; } catch { /* default */ }
    await fetchRows('office_organizations', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ id: orgId, slug: 'cabinet-' + orgId.slice(0, 8), name: String(name).slice(0, 120) }]) });
  }
  // 1. The owner's membership, which the database checks (office_role).
  const m = await fetchRows('office_memberships?org_id=eq.' + q(orgId) + '&user_id=eq.' + q(account.auth_user_id) + '&select=role,active&limit=1');
  if (!m?.length) {
    await fetchRows('office_memberships', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ org_id: orgId, user_id: account.auth_user_id, role: 'owner', active: true }]) });
  } else if (m[0].role !== 'owner' || !m[0].active) {
    await fetchRows('office_memberships?org_id=eq.' + q(orgId) + '&user_id=eq.' + q(account.auth_user_id), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ role: 'owner', active: true }) });
  }
  // 2. The grant itself, written with the owner's own session (the approver is the owner).
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw fail('SUPABASE_SERVER_CONFIG_MISSING', 503);
  const row = { org_id: orgId, outbound_messaging_approved: false,
    approval_scope: 'Autorisé dans l’application par ' + String(account.display_name || account.email || 'le propriétaire').slice(0, 80) + ' : lecture du Drive, lecture des documents choisis, IA. Envois : seulement après validation dans « À valider ».' };
  for (const f of FLAGS) row[f] = true;
  const r = await fetchImpl(url + '/rest/v1/office_processing_permissions?on_conflict=org_id', {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([row])
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw fail('PERMISSION_GRANT_FAILED: ' + (t.match(/"message"\s*:\s*"([^"]{0,120})/)?.[1] || r.status), r.status === 401 ? 401 : 409);
  }
  return agentPermissions(orgId, fetchRows);
}
