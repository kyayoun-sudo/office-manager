import { rest } from './supabase.js';
import { runAI } from './ai.js';
import { loadPeoplePolicy } from './people-policy.js';
import { PEOPLE_RULES } from './people-intelligence.js';

// « Équipe et briefing » with the firm's people-management policy (Paul, 2026-10-07: « ça
// n'utilise pas les données que je viens d'envoyer »). For one mission, the AI reads the firm's
// policy (kept in the HR / CV folder), the people of the firm (profiles, current load), the
// mission and its current team, and prepares: each person's role (ownership, authority, reviewer,
// development objective), the leadership style for this task (person × task), the briefing
// written in that person's COMMUNICATION PROTOCOL, a mini-RACI and team-misfit alerts.
// The app's rules R009–R012 always prevail. It proposes; a manager decides. Nothing is sent.

const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INSTRUCTIONS = `Tu es le Grand Contrôleur d'un cabinet, en charge de la gestion des personnes.
Applique la POLITIQUE DE GESTION DES PERSONNES du cabinet fournie (protocoles de communication de chacun, leadership situationnel personne × tâche, RACI, détection d'équipe mal composée, développement), SOUS les règles impératives de l'application qui priment toujours.
Réponds en JSON STRICT :
{"team":[{"full_name":"","mission_role":"","ownership":"","authority":"","reviewer":"","development_objective":"","leadership_style":"S1|S2|S3|S4","why_style":"","briefing":"","checks_before_staffing":[""]}],
 "raci":[{"activity":"","responsible":"","reviewer":"","consulted":"","final_authority":""}],
 "alerts":[{"type":"technical|balance|structure|supervision|development|fairness","message":""}],
 "missing_information":[""]}
Règles : n'utilise que les personnes listées ; le briefing est écrit dans le protocole de communication de la personne (si la politique en donne un), en français, adressé à elle ; ne pose aucun diagnostic psychologique ; disponibilité et compétences restent à confirmer par le responsable ; si l'équipe de la mission est vide, propose une composition et dis-le dans "missing_information".`;

function parseJson(text) {
  const t = String(text || ''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw fail('PEOPLE_BRIEF_UNREADABLE', 502);
  return JSON.parse(t.slice(a, b + 1));
}

export async function peopleBrief(orgId, missionId, d = {}) {
  if (!ID.test(missionId || '')) throw fail('VALID_MISSION_ID_REQUIRED');
  const fetchRows = d.fetchRows || rest, org = 'org_id=eq.' + q(orgId);
  const [mission] = await fetchRows('office_missions?' + org + '&id=eq.' + q(missionId) + '&select=id,name,mission_code,planned_start,planned_end,status&limit=1') || [];
  if (!mission) throw fail('MISSION_NOT_FOUND', 404);
  const staff = await fetchRows('office_staff_profiles?' + org + '&active=eq.true&select=id,full_name,email,role_title,grade_title,department,skills,weekly_capacity_hours&limit=200') || [];
  const assignments = await fetchRows('office_mission_assignments?' + org + '&status=not.in.(rejected,completed)&select=office_mission_id,staff_profile_id,mission_role,planned_start,planned_end,allocation_pct&limit=1000') || [];
  const byId = new Map(staff.map(s => [s.id, s]));
  const load = {};
  for (const a of assignments) load[a.staff_profile_id] = (load[a.staff_profile_id] || 0) + Number(a.allocation_pct || 0);
  const team = assignments.filter(a => a.office_mission_id === missionId).map(a => ({ ...byId.get(a.staff_profile_id), mission_role: a.mission_role })).filter(x => x.full_name);
  const policy = (await (d.loadPolicy || loadPeoplePolicy)().catch(() => ({ text: '' }))).text;
  const input = 'RÈGLES IMPÉRATIVES (priment) :\n' + Object.entries(PEOPLE_RULES).map(([k, v]) => k + ' — ' + v).join('\n') +
    '\n\nPOLITIQUE DE GESTION DES PERSONNES DU CABINET :\n' + (policy ? policy.slice(0, 60000) : '(aucune politique enregistrée)') +
    '\n\nMISSION : ' + JSON.stringify(mission) +
    '\n\nÉQUIPE ACTUELLE DE LA MISSION : ' + JSON.stringify(team.map(t => ({ full_name: t.full_name, role: t.mission_role, title: t.role_title, grade: t.grade_title, skills: t.skills }))) +
    '\n\nPERSONNES DU CABINET (charge déjà planifiée en %) : ' + JSON.stringify(staff.map(s => ({ full_name: s.full_name, title: s.role_title, grade: s.grade_title, skills: (s.skills || []).slice(0, 12), load_pct: load[s.id] || 0 })));
  let out = null, lastError = null;
  for (const provider of ['auto', 'openai', 'anthropic']) {
    try { out = parseJson((await (d.runAI || runAI)({ agentKey: 'grand-controleur', instructions: INSTRUCTIONS, input: input.slice(0, 120000), provider, maxTokens: 12000 })).text); break; }
    catch (e) { lastError = e; }
  }
  if (!out) throw lastError || fail('PEOPLE_BRIEF_FAILED', 502);
  return { mission: { id: mission.id, name: mission.name }, policy_used: Boolean(policy), rules: PEOPLE_RULES,
    team: out.team || [], raci: out.raci || [], alerts: out.alerts || [], missing_information: out.missing_information || [],
    notice: 'Proposition à valider par le responsable : rien n’est affecté ni envoyé.' };
}
