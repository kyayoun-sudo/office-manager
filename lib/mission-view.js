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
