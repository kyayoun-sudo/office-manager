import { rest } from './supabase.js';

const q = encodeURIComponent;
const leads = ['owner', 'partner'];
const denied = () => Object.assign(new Error('NOT_ON_THIS_MISSION'), { statusCode: 403 });
// Read the current staffing, never trust a mission ID supplied by the browser.
export async function accessibleMissionIds(orgId, account, fetchRows = rest) {
  if (leads.includes(account?.role)) return null;
  const email = String(account?.email || '').trim().toLowerCase();
  if (!email || account?.role === 'it_admin') return new Set();
  const staff = await fetchRows(`office_staff_profiles?org_id=eq.${q(orgId)}&email=eq.${q(email)}&active=eq.true&select=id`);
  const ids = (staff || []).map(s => s.id).filter(Boolean);
  if (!ids.length) return new Set();
  const rows = await fetchRows(`office_mission_assignments?org_id=eq.${q(orgId)}&staff_profile_id=in.(${ids.map(q).join(',')})&select=office_mission_id,status`);
  return new Set((rows || []).filter(r => !['cancelled', 'canceled', 'rejected', 'completed'].includes(r.status)).map(r => r.office_mission_id).filter(Boolean));
}
export async function requireMissionAccess(orgId, missionId, account, fetchRows = rest) {
  const ids = await accessibleMissionIds(orgId, account, fetchRows);
  if (ids !== null && !ids.has(missionId)) throw denied();
}
