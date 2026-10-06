import { rest } from './supabase.js';

export const PEOPLE_RULES = Object.freeze({
  R009: 'Vérifier les compétences, la disponibilité et la charge avant la préparation du management.',
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
  const matches = await rest('rpc/office_mission_staffing_advice', { method: 'POST', body: JSON.stringify({
    p_org_id: orgId, p_office_mission_id: missionId
  }) });
  const candidates = matches.filter(row => row.technical_eligible === true &&
    row.available_for_window === true && Number.isFinite(Number(row.current_load_pct)) &&
    Number(row.current_load_pct) < 100).map(row => ({
    staff_profile_id: row.staff_profile_id, full_name: row.full_name, role_title: row.role_title,
    role_family: row.role_family, skills: row.skills,
    current_load_pct: Number(row.current_load_pct), profile_available: row.profile_available,
    management_brief: row.management_support,
    data_quality_flags: row.data_quality_flags || [],
    eligibility: { technical: true, availability: (row.data_quality_flags || []).length ? null : true,
      state: 'manager_review_required' }
  }));
  return { state: 'manager_review_required', mission_id: missionId,
    requirements: requirements[0], candidates, rules: PEOPLE_RULES,
    data_quality_flags: [...new Set(matches.flatMap(row => row.data_quality_flags || []))],
    preferred_team_size: requirements[0].preferred_team_size || 4,
    limitation: 'Présélection technique, disponibilité et charge; composition de l’équipe à valider par le responsable. Le questionnaire adapte uniquement le management après présélection.' };
}
