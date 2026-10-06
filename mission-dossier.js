import { rest } from './supabase.js';

export const MISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function listMissions(orgId) {
  const rows = await rest('office_missions?org_id=eq.' + encodeURIComponent(orgId) +
    '&select=id,mission_code,name,status,planned_start,planned_end&order=created_at.desc&limit=101');
  return { missions: rows.slice(0,100), truncated: rows.length > 100 };
}

export async function getMissionDossier(orgId, missionId) {
  if (!MISSION_ID.test(missionId)) throw Object.assign(new Error('VALID_MISSION_ID_REQUIRED'), { statusCode:400 });
  const scope = 'org_id=eq.' + encodeURIComponent(orgId);
  const filter = scope + '&office_mission_id=eq.' + encodeURIComponent(missionId);
  const missions = await rest('office_missions?' + scope + '&id=eq.' + missionId +
    '&select=id,mission_code,name,status,planned_start,planned_end&limit=1');
  if (!missions[0]) throw Object.assign(new Error('MISSION_NOT_FOUND'), { statusCode:404 });
  const [requirements, assignments, actions, documents] = await Promise.all([
    rest('office_mission_people_requirements?' + filter + '&select=mission_context,required_skills,preferred_team_size,source&limit=1'),
    rest('office_mission_assignments?' + filter + '&select=id,staff_profile_id,mission_role,planned_start,planned_end,allocation_pct,status&limit=101'),
    // Private staffing advice stays in the dedicated internal People view.
    rest('office_action_queue?' + filter + '&action_type=neq.PEOPLE_INTELLIGENCE_RECOMMENDATION' +
      '&select=id,agent_key,action_type,summary,status,work_state,due_at&order=created_at.desc&limit=101'),
    rest('orpailleur_inventory?' + filter + '&is_folder=eq.false&select=file_id,name,document_type,content_verified_at&limit=101')
  ]);
  const mission = missions[0], requirementsRow = requirements[0] || null;
  const activeAssignments = assignments.filter(a => !['cancelled','canceled','rejected','completed'].includes(a.status));
  const blockers = [];
  if (!mission.planned_start || !mission.planned_end) blockers.push('Dates de mission à renseigner.');
  if (!requirementsRow?.mission_context) blockers.push('Cadrage détaillé à renseigner.');
  if (!activeAssignments.length) blockers.push('Aucune affectation active enregistrée ; équipe à valider.');
  if (!documents.length) blockers.push('Aucun document relié dans l’inventaire ; vérifier le mapping et la source documentaire.');
  return {
    source: 'Supabase — dossier Office Manager', mission, requirements: requirementsRow,
    assignments: assignments.slice(0,100), actions: actions.slice(0,100),
    documents: documents.slice(0,100), blockers,
    truncated: { assignments:assignments.length>100, actions:actions.length>100, documents:documents.length>100 },
    next_steps: [
      'Confirmer le cadrage, les livrables et les échéances avec le responsable.',
      'Préparer puis faire valider l’équipe et sa capacité.',
      'Faire préparer le programme par Mission Controller et le soumettre à validation.',
      'Vérifier la cartographie documentaire avec Orpailleur.',
      'Confirmer les conditions administratives avec Sika.'
    ],
    guardrail: 'Ces étapes sont un parcours proposé, pas un programme de travail approuvé. Un dossier Supabase ne certifie pas le contenu du registre Drive.'
  };
}
