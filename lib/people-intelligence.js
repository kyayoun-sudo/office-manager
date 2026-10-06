import { rest } from './supabase.js';

export const PEOPLE_RULES = Object.freeze({
  R009: 'Vérifier les compétences et la disponibilité avant le people fit.',
  R010: 'Fournir un briefing, un cadrage et un feedback adaptés.',
  R011: 'Aucun diagnostic clinique ni décision RH sensible fondée sur le questionnaire seul.',
  R012: 'Réviser les profils uniquement sur des observations post-mission documentées et validées.'
});

export function assessEligibility(staff, mission, requirements, absences, assignments) {
  const skills = requirements.required_skills || [];
  const technical = skills.length ? skills.every(skill =>
    (staff.skills || []).some(value => value.toLowerCase() === skill.toLowerCase())) : null;
  const start = Date.parse(mission.planned_start);
  const end = Date.parse(mission.planned_end);
  const overlaps = (a, b) => {
    const from = Date.parse(a), until = Date.parse(b);
    return !Number.isFinite(from) || !Number.isFinite(until) ||
      (from < end + 86400000 && until >= start);
  };
  const dated = Number.isFinite(start) && Number.isFinite(end) && start <= end;
  const blocked = dated && (
    absences.some(row => row.staff_profile_id === staff.id && row.approved && overlaps(row.starts_at, row.ends_at)) ||
    assignments.some(row => row.staff_profile_id === staff.id && row.office_mission_id !== mission.id &&
      !['cancelled', 'completed'].includes(row.status) && overlaps(row.planned_start, row.planned_end))
  );
  // No recorded absence is not evidence of available capacity.
  return { technical, availability: blocked ? false : null,
    state: technical === false || blocked ? 'excluded' : 'manager_review_required' };
}

export async function getPeopleIntelligence(orgId, missionId) {
  const scope = `org_id=eq.${encodeURIComponent(orgId)}`;
  const id = encodeURIComponent(missionId);
  const [missions, requirements] = await Promise.all([
    rest(`office_missions?${scope}&id=eq.${id}&select=id,mission_code,name,planned_start,planned_end&limit=1`),
    rest(`office_mission_people_requirements?${scope}&office_mission_id=eq.${id}&select=*&limit=1`)
  ]);
  if (!missions?.[0]) throw Object.assign(new Error('MISSION_NOT_FOUND'), { statusCode: 404 });
  if (!requirements?.[0]) return { state: 'requirements_missing', rules: PEOPLE_RULES, candidates: [] };
  const [staff, absences, assignments] = await Promise.all([
    rest(`office_staff_profiles?${scope}&active=eq.true&select=id,skills&limit=1000`),
    rest(`office_staff_availability?${scope}&approved=eq.true&select=staff_profile_id,starts_at,ends_at,approved&limit=1000`),
    rest(`office_mission_assignments?${scope}&select=staff_profile_id,office_mission_id,planned_start,planned_end,status&limit=1000`)
  ]);
  if ([staff, absences, assignments].some(rows => rows.length >= 1000)) {
    throw new Error('PEOPLE_EVIDENCE_LIMIT_REACHED');
  }
  const byId = new Map(staff.map(row => [row.id, row]));
  const eligibleIds = staff.filter(row => assessEligibility(row, missions[0], requirements[0], absences, assignments).state !== 'excluded').map(row => row.id);
  const matches = eligibleIds.length ? await rest('rpc/office_people_match', { method: 'POST', body: JSON.stringify({
    p_org_id: orgId, p_requirements: { ...requirements[0], eligible_staff_profile_ids: eligibleIds }, p_limit: 5
  }) }) : [];
  const candidates = matches.filter(row => byId.has(row.staff_profile_id)).map(row => ({
    staff_profile_id: row.staff_profile_id, full_name: row.full_name, role_title: row.role_title,
    people_fit_score: row.fit_score, fit_band: row.fit_band,
    management_brief: row.management_brief,
    eligibility: assessEligibility(byId.get(row.staff_profile_id), missions[0], requirements[0], absences, assignments)
  })).filter(row => row.eligibility.state !== 'excluded').slice(0, 5);
  return { state: 'manager_review_required', mission_id: missionId,
    requirements: requirements[0], candidates, rules: PEOPLE_RULES,
    limitation: 'People fit complémentaire; capacité et niveau hiérarchique à confirmer avant toute affectation.' };
}
