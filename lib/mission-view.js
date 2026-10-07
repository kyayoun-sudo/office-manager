import { rest } from './supabase.js';
import { getMissionDossier, MISSION_ID } from './mission-dossier.js';

// Display view of a mission for the "Dossier de mission" screen.
// Reuses the existing read-only dossier and only adds staff display names
// (name and role title; no email, skills, CV or HR profile). Read-only.

export function summarizeDossier(dossier) {
  const docs = dossier.documents || [];
  const actions = dossier.actions || [];
  const openActions = actions.filter(a => !['verified', 'cancelled', 'canceled', 'rejected'].includes(a.work_state || a.status));
  return {
    documents_total: docs.length,
    documents_verified: docs.filter(d => d.content_verified_at).length,
    team_size: (dossier.assignments || []).filter(a => !['cancelled', 'canceled', 'rejected', 'completed'].includes(a.status)).length,
    open_actions: openActions.length,
    plan_versions: (dossier.plans || []).length
  };
}

export async function getMissionView(orgId, missionId, deps = {}) {
  const loadDossier = deps.getMissionDossier || getMissionDossier;
  const fetchRows = deps.fetchRows || rest;
  if (!MISSION_ID.test(missionId || '')) {
    throw Object.assign(new Error('VALID_MISSION_ID_REQUIRED'), { statusCode: 400 });
  }
  const dossier = await loadDossier(orgId, missionId);
  const ids = [...new Set((dossier.assignments || []).map(a => a.staff_profile_id).filter(id => MISSION_ID.test(id || '')))];
  let names = {};
  if (ids.length) {
    const staff = await fetchRows('office_staff_profiles?org_id=eq.' + encodeURIComponent(orgId) +
      '&id=in.(' + ids.join(',') + ')&select=id,full_name,role_title&limit=100');
    names = Object.fromEntries(staff.map(s => [s.id, { full_name: s.full_name, role_title: s.role_title }]));
  }
  const assignments = (dossier.assignments || []).map(a => ({
    ...a,
    full_name: names[a.staff_profile_id]?.full_name || null,
    role_title: names[a.staff_profile_id]?.role_title || null
  }));
  // Plans: only the latest version's text is shown on this screen.
  const latestPlan = (dossier.plans || [])[0] || null;
  return {
    ...dossier,
    assignments,
    plans: latestPlan ? [latestPlan] : [],
    summary: summarizeDossier(dossier)
  };
}

// Who a message about this mission goes to (Paul, 2026-10-07: « sur une mission, quand on envoie une
// validation ou une question, il prend automatiquement les personnes concernées selon le programme
// de travail »): the people assigned to the mission (work programme / planning), then everyone of
// the firm with an e-mail, for the list to pick from.
export async function getMissionContacts(orgId, missionId, deps = {}) {
  const fetchRows = deps.fetchRows || rest;
  const org = 'org_id=eq.' + encodeURIComponent(orgId);
  const staff = await fetchRows('office_staff_profiles?' + org + '&active=eq.true&select=id,full_name,email,role_title&order=full_name.asc&limit=300') || [];
  const all = staff.filter(s => s.email).map(s => ({ name: s.full_name, email: String(s.email).toLowerCase(), role: s.role_title || null }));
  if (!missionId) return { team: [], all };
  if (!MISSION_ID.test(missionId)) throw Object.assign(new Error('VALID_MISSION_ID_REQUIRED'), { statusCode: 400 });
  const rows = await fetchRows('office_mission_assignments?' + org + '&office_mission_id=eq.' + encodeURIComponent(missionId) +
    '&status=not.in.(rejected,completed)&select=staff_profile_id,mission_role&limit=100') || [];
  const byId = new Map(staff.map(s => [s.id, s]));
  const team = rows.map(r => ({ s: byId.get(r.staff_profile_id), role: r.mission_role })).filter(x => x.s && x.s.email)
    .map(x => ({ name: x.s.full_name, email: String(x.s.email).toLowerCase(), role: x.role || x.s.role_title || null }));
  const seen = new Set();
  return { team: team.filter(t => !seen.has(t.email) && seen.add(t.email)), all };
}
