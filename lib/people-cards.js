import { rest } from './supabase.js';
import { capabilityContext } from './capabilities.js';
import { loadFacts, personKpis } from './kpi.js';
import { firstAvailable, multiModel, parseJsonLoose } from './ai-plus.js';
import { PEOPLE_RULES } from './people-intelligence.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, updateJsonFile } from './mapping-scan.js';

// MANAGEMENT CARDS AND TEAM RECOMMENDATION (2026-10-08). Owner and managers only.
// The card brings together, for one person: experience, skills (CV), strengths, development
// points, suitable missions, communication style, recommended management style, motivation,
// need for autonomy / structure / recognition (work-preference questionnaire), KPI results
// (facts of the work), missions done, behaviour OBSERVED on missions, recommended trainings,
// evolution over time. It is updated from observed behaviour with an objective and EXPLAINABLE
// AI analysis: every statement cites its evidence. Rules R009–R012 prevail: no clinical
// diagnosis, no HR decision from the questionnaire alone, profiles revised only on documented
// observations validated by a manager. The AI recommends; a person decides.
//
// The team recommendation adds to what exists: CV, skills, experience, availability, load, past
// performance, KPI, HR profile, questionnaire, Management Card, observed behaviour, recent
// evolution, AI judgement n°1, an INDEPENDENT AI judgement n°2, independence / conflict risks.
// It proposes a team, explains why, shows the risks and the alternatives. Never assigns alone.

const q = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const cut = (s, n) => s == null ? null : String(s).slice(0, n);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const RECO_FILE = 'OFFICE_MANAGER_TEAM_RECOMMENDATIONS.json';

async function profileOf(orgId, staffId, fetchRows) {
  return (await fetchRows('office_staff_management_profiles?org_id=eq.' + q(orgId) + '&staff_profile_id=eq.' + q(staffId) + '&active=eq.true&select=profile_label,autonomy_score,structure_need_score,recognition_need_score,uncertainty_tolerance_score,innovation_score,team_orientation_score,decision_confidence_score,feedback_sensitivity_score,stability_preference_score,compliance_orientation_score,primary_motivators,demotivators,preferred_mission_types,best_mission_conditions,briefing_requirements,management_style,communication_guidance,feedback_guidance,risk_flags,development_focus,profile_confidence,profile_version,updated_at&order=profile_version.desc&limit=1').catch(() => []))?.[0] || null;
}

export async function listObservations(orgId, staffId, fetchRows = rest) {
  try { return await fetchRows('office_people_observations?org_id=eq.' + q(orgId) + '&staff_profile_id=eq.' + q(staffId) + '&select=id,office_mission_id,kind,observation,source,status,created_by,validated_by,created_at&order=created_at.desc&limit=100') || []; }
  catch { return null; }
}

// A documented observation after (or during) a mission. A manager's = validated; an agent's = proposed.
export async function addObservation(orgId, input, by, validated, fetchRows = rest) {
  if (!UUID.test(String(input.staff_profile_id || ''))) throw fail('VALID_STAFF_ID_REQUIRED');
  const text = String(input.observation || '').trim();
  if (text.length < 5) throw fail('OBSERVATION_TOO_SHORT');
  const row = { org_id: orgId, staff_profile_id: input.staff_profile_id, office_mission_id: UUID.test(String(input.mission_id || '')) ? input.mission_id : null,
    kind: ['force', 'developpement', 'comportement', 'resultat'].includes(input.kind) ? input.kind : 'comportement', observation: cut(text, 1500), source: cut(input.source || 'observation du manager', 300),
    status: validated ? 'validated' : 'proposed', created_by: cut(by, 120), validated_by: validated ? cut(by, 120) : null };
  try { const [r] = await fetchRows('office_people_observations', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) }); return r || row; }
  catch { throw fail('MIGRATION_MISSING_DB_MEMORY_SQL', 409); }
}

export async function cardVersions(orgId, staffId, fetchRows = rest) {
  try { return await fetchRows('office_management_card_versions?org_id=eq.' + q(orgId) + '&staff_profile_id=eq.' + q(staffId) + '&select=version,card,created_by,created_at&order=version.desc&limit=12') || []; }
  catch { return null; }
}

// Everything known about the person, read-only.
export async function managementCard(orgId, staffId, d = {}) {
  if (!UUID.test(String(staffId || ''))) throw fail('VALID_STAFF_ID_REQUIRED');
  const fetchRows = d.fetchRows || rest;
  const staff = (await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=eq.' + q(staffId) + '&select=id,full_name,email,role_title,grade_title,department,skills,weekly_capacity_hours&limit=1'))?.[0];
  if (!staff) throw fail('STAFF_NOT_FOUND', 404);
  const [cap, facts, profile, observations, versions] = await Promise.all([
    (d.capabilityContext || capabilityContext)(orgId, d).catch(() => ({ people: [] })),
    (d.loadFacts || loadFacts)(orgId, fetchRows).catch(() => ({ staff: [], assignments: [], actions: [], missions: [] })),
    profileOf(orgId, staffId, fetchRows), listObservations(orgId, staffId, fetchRows), cardVersions(orgId, staffId, fetchRows)
  ]);
  const cv = (cap.people || []).find(p => (p.email && norm(p.email) === norm(staff.email)) || norm(p.full_name) === norm(staff.full_name)) || {};
  const kpi = personKpis(staff, facts.assignments || [], facts.actions || []);
  const missionName = new Map((facts.missions || []).map(m => [m.id, m]));
  const missions = (facts.assignments || []).filter(a => a.staff_profile_id === staffId).map(a => ({ mission: missionName.get(a.office_mission_id)?.name || a.office_mission_id, mission_id: a.office_mission_id, status: missionName.get(a.office_mission_id)?.status || null, start: a.planned_start, end: a.planned_end, allocation_pct: a.allocation_pct }))
    .sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')));
  const latest = (versions || [])[0]?.card || null;
  return {
    person: { id: staff.id, name: staff.full_name, email: staff.email, title: staff.role_title, grade: staff.grade_title, department: staff.department },
    experience: { years: cv.years_experience ?? null, seniority: cv.seniority || null, industries: cv.industries || [], previous_engagements: cv.previous_engagements || [], trainings: cv.trainings || [] },
    skills: { specialist: cv.specialist_skills || [], technical: cv.technical_skills || staff.skills || [], qualifications: cv.qualifications || [], certifications: cv.certifications || [], languages: cv.languages || [] },
    work_preferences: profile ? { label: profile.profile_label, autonomy: profile.autonomy_score, structure: profile.structure_need_score, recognition: profile.recognition_need_score, motivators: profile.primary_motivators, demotivators: profile.demotivators,
      preferred_missions: profile.preferred_mission_types, best_conditions: profile.best_mission_conditions, briefing: profile.briefing_requirements, management_style: profile.management_style, communication: profile.communication_guidance,
      feedback: profile.feedback_guidance, development_focus: profile.development_focus, confidence: profile.profile_confidence, version: profile.profile_version,
      note: 'Préférences de travail déclarées (questionnaire) : repère pour le management, jamais un diagnostic ni la base seule d’une décision RH (R011).' } : null,
    kpi, missions,
    observations: observations || [], observations_available: observations !== null,
    analysis: latest, history: (versions || []).map(v => ({ version: v.version, at: v.created_at, by: v.created_by, summary: v.card?.summary || null })), versions_available: versions !== null,
    rules: PEOPLE_RULES
  };
}

const CARD = `Tu es le Grand Contrôleur d'un cabinet d'audit. Tu mets à jour la MANAGEMENT CARD d'un collaborateur pour ses managers.
Base-toi UNIQUEMENT sur les éléments fournis : CV et compétences, missions réalisées, indicateurs du travail (KPI), observations documentées et validées par un manager, préférences de travail déclarées (questionnaire). Chaque affirmation cite sa PREUVE (quel élément). Objectif, factuel, bienveillant, sans diagnostic psychologique ni clinique ; le questionnaire seul ne fonde aucune conclusion (règle R011). Si une information manque, dis-le.
JSON STRICT : {"summary":"(2 phrases)","strengths":[{"point":"","evidence":""}],"development_points":[{"point":"","evidence":""}],"suitable_missions":[{"type":"","why":""}],"communication_style":{"text":"","evidence":""},"recommended_management":{"style":"S1|S2|S3|S4","text":"","evidence":""},"motivation":{"text":"","evidence":""},"needs":{"autonomy":"","structure":"","recognition":"","evidence":""},"observed_behaviour":[{"point":"","evidence":""}],"recommended_trainings":[{"training":"","why":""}],"evolution":"(ce qui a changé depuis la version précédente, ou « première version »)","missing_information":[""]}`;

// A new, explainable version of the card (manager's click). Kept as a version: evolution over time.
export async function refreshCard(orgId, staffId, by, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const card = await managementCard(orgId, staffId, d);
  const evidence = { person: { title: card.person.title, grade: card.person.grade }, experience: card.experience, skills: card.skills,
    kpi: { load_pct: card.kpi.load_pct, actions_done: card.kpi.actions_done, on_time_rate: card.kpi.on_time_rate, verified_rate: card.kpi.verified_rate, avg_cycle_days: card.kpi.avg_cycle_days, actions_overdue: card.kpi.actions_overdue },
    missions: card.missions.slice(0, 20), observations: (card.observations || []).filter(o => o.status === 'validated').slice(0, 40).map(o => ({ kind: o.kind, observation: o.observation, source: o.source, at: o.created_at })),
    work_preferences: card.work_preferences ? { ...card.work_preferences, note: undefined } : null, previous_version: card.analysis || null };
  const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: CARD, input: 'RÈGLES : ' + JSON.stringify(PEOPLE_RULES) + '\n\nÉLÉMENTS : ' + JSON.stringify(evidence).slice(0, 60000), maxTokens: 5000 });
  const analysis = { ...parseJsonLoose(r.text), by_model: r.provider, at: new Date().toISOString() };
  const version = ((card.history || [])[0]?.version || 0) + 1;
  let saved = true;
  try { await fetchRows('office_management_card_versions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ org_id: orgId, staff_profile_id: staffId, version, card: analysis, created_by: cut(by, 120) }]) }); }
  catch { saved = false; }
  return { analysis, version, saved, notice: saved ? null : 'Analyse faite mais pas conservée : exécuter db/memory.sql pour garder l’historique des cartes.' };
}

// ---------- Team recommendation (two independent AI judgements) ----------

const TEAM = `Tu es un associé d'un cabinet d'audit qui compose l'équipe d'une mission. Tu ne DÉCIDES PAS : tu proposes, tu expliques, tu montres les risques et les alternatives.
Utilise, pour chaque personne : CV, compétences, expérience, disponibilité et charge, performance passée et KPI, profil RH et préférences de travail (questionnaire — jamais seul), Management Card, comportement observé et évolution récente, et les risques d'indépendance ou de conflit d'intérêts (lien passé ou actuel avec le client, missions incompatibles).
Règles impératives : ${Object.values(PEOPLE_RULES).join(' ')} Compétences et disponibilité d'abord.
JSON STRICT : {"team":[{"name":"","role":"","why":"","evidence":[""],"load_pct":null,"risks":[""]}],"alternatives":[{"name":"","instead_of":"","why":""}],"risks":[{"type":"competence|disponibilite|charge|independance|conflit|equilibre|supervision|developpement","message":""}],"gaps":[""],"confidence":"haute|moyenne|basse"}`;

export function consolidateJudgements(opinions) {
  const byName = new Map();
  for (const o of opinions) for (const t of o.team || []) {
    const k = norm(t.name); if (!k) continue;
    const e = byName.get(k) || { name: t.name, roles: new Set(), why: [], risks: new Set(), by: [] };
    if (t.role) e.roles.add(t.role); if (t.why) e.why.push(o.provider + ' : ' + t.why); (t.risks || []).forEach(x => e.risks.add(x)); e.by.push(o.provider);
    byName.set(k, e);
  }
  const team = [...byName.values()].map(e => ({ name: e.name, roles: [...e.roles], why: e.why, risks: [...e.risks], agreed_by: e.by, agreement: e.by.length >= Math.min(2, opinions.length) ? 'les deux jugements' : 'un seul jugement' }))
    .sort((a, b) => b.agreed_by.length - a.agreed_by.length);
  return { team, risks: opinions.flatMap(o => (o.risks || []).map(r => ({ ...r, by: o.provider }))), alternatives: opinions.flatMap(o => (o.alternatives || []).map(a => ({ ...a, by: o.provider }))),
    gaps: [...new Set(opinions.flatMap(o => o.gaps || []))], judgements: opinions.map(o => ({ provider: o.provider, confidence: o.confidence || null, team: (o.team || []).map(t => t.name) })) };
}

export async function recommendTeam(orgId, missionId, by, d = {}) {
  if (!UUID.test(String(missionId || ''))) throw fail('VALID_MISSION_ID_REQUIRED');
  const fetchRows = d.fetchRows || rest;
  const mission = (await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) + '&select=id,name,mission_code,planned_start,planned_end,status&limit=1'))?.[0];
  if (!mission) throw fail('MISSION_NOT_FOUND', 404);
  const [cap, facts, engagement, data, staff] = await Promise.all([
    (d.capabilityContext || capabilityContext)(orgId, d).catch(() => ({ people: [] })),
    (d.loadFacts || loadFacts)(orgId, fetchRows).catch(() => ({ assignments: [], actions: [], missions: [] })),
    import('./engagement-prep.js').then(m => m.engagementState(missionId)).catch(() => ({})),
    import('./mission-data.js').then(m => m.missionData(missionId)).catch(() => ({ contacts: [], facts: [] })),
    fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&active=eq.true&select=id,full_name,email&limit=300').catch(() => [])
  ]);
  const ids = new Map((staff || []).map(s => [norm(s.full_name), s.id]));
  const people = [];
  for (const p of cap.people || []) {
    const id = ids.get(norm(p.full_name));
    const [profile, observations, versions] = id ? await Promise.all([profileOf(orgId, id, fetchRows), listObservations(orgId, id, fetchRows), cardVersions(orgId, id, fetchRows)]) : [null, null, null];
    // Busy on the mission's dates elsewhere?
    const overlapping = (facts.assignments || []).filter(a => a.staff_profile_id === id && a.office_mission_id !== missionId && !['rejected', 'cancelled', 'completed'].includes(String(a.status || '')) &&
      (!mission.planned_start || !a.planned_end || a.planned_end >= mission.planned_start) && (!mission.planned_end || !a.planned_start || a.planned_start <= mission.planned_end)).map(a => ({ mission: (facts.missions || []).find(m => m.id === a.office_mission_id)?.name, pct: a.allocation_pct }));
    people.push({ name: p.full_name, kind: p.kind, title: p.title, grade: p.grade, years: p.years_experience, specialist: p.specialist_skills, technical: (p.technical_skills || []).slice(0, 20), certifications: p.certifications, industries: p.industries, languages: p.languages,
      past: (p.previous_engagements || []).slice(0, 8), load_pct: p.load_pct, on_time_rate: p.on_time_rate, actions_overdue: p.actions_overdue, busy_on_dates: overlapping,
      work_preferences: profile ? { autonomy: profile.autonomy_score, structure: profile.structure_need_score, recognition: profile.recognition_need_score, preferred_missions: profile.preferred_mission_types, management: profile.management_style } : null,
      observed: (observations || []).filter(o => o.status === 'validated').slice(0, 6).map(o => o.kind + ' : ' + o.observation),
      card: versions?.[0]?.card ? { summary: versions[0].card.summary, strengths: (versions[0].card.strengths || []).map(s => s.point), development: (versions[0].card.development_points || []).map(s => s.point), evolution: versions[0].card.evolution } : null });
  }
  const t = engagement?.tdr || {};
  const input = 'MISSION : ' + JSON.stringify({ name: mission.name, dates: [mission.planned_start, mission.planned_end], client: t.client, industry: t.industry, type: t.engagement_type, scope: cut(t.scope, 2000) }) +
    '\nCOMPÉTENCES REQUISES : ' + JSON.stringify((engagement?.match?.requirements || t.stated_requirements || []).map(r => ({ capability: r.capability || r.requirement, level: r.level }))).slice(0, 12000) +
    '\nPOINTS D’INDÉPENDANCE CONNUS : ' + JSON.stringify((data.facts || []).filter(f => f.kind === 'independance').map(f => f.label + ' : ' + f.value)) +
    '\nPERSONNES : ' + JSON.stringify(people).slice(0, 90000);
  const results = await (d.multiModel || multiModel)({ instructions: TEAM, input, maxTokens: 6000 }, ['anthropic', 'openai', 'gemini'], d);
  const opinions = [];
  for (const r of results) { if (r.error) continue; try { opinions.push({ provider: r.provider, ...parseJsonLoose(r.text) }); } catch { /* unreadable opinion */ } }
  if (!opinions.length) throw fail('NO_MODEL_ANSWERED', 502);
  const out = { mission: { id: mission.id, name: mission.name }, at: new Date().toISOString(), by: cut(by, 120), ...consolidateJudgements(opinions.slice(0, 2)),
    independent: opinions.length >= 2, notice: 'Proposition : aucune affectation n’est faite. Un responsable retient les personnes.' };
  await (d.updateJsonFile || updateJsonFile)(RECO_FILE, st => { const s = st || { missions: {} }; s.missions[missionId] = out; s.updated_at = out.at; return s; }, { drive: d.drive || driveAdapter, folder: d.folder || memoryFolderId() }).catch(() => null);
  return out;
}

export async function lastRecommendation(missionId, d = {}) {
  return (await loadJsonFile(RECO_FILE, d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null }))).state?.missions?.[missionId] || null;
}

// A manager RETAINS a person proposed for the mission (the human decision).
export async function retainPerson(orgId, missionId, input, by, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const mission = (await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) + '&select=id,planned_start,planned_end&limit=1'))?.[0];
  if (!mission) throw fail('MISSION_NOT_FOUND', 404);
  const s = (await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&full_name=ilike.' + q(String(input.name || '').replace(/[*,()]/g, ' ').trim()) + '&active=eq.true&select=id,full_name&limit=1'))?.[0];
  if (!s) throw fail('STAFF_NOT_FOUND', 404);
  const row = { org_id: orgId, office_mission_id: missionId, staff_profile_id: s.id, mission_role: cut(input.role || 'membre', 80), planned_start: mission.planned_start, planned_end: mission.planned_end,
    allocation_pct: Math.min(100, Math.max(5, Number(input.allocation_pct) || 100)), responsibility_scope: cut('Retenu par ' + (by || 'un responsable') + ' sur recommandation d’équipe', 300) };
  try { await fetchRows('office_mission_assignments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ ...row, status: 'active' }]) }); }
  catch { await fetchRows('office_mission_assignments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ ...row, status: 'proposed' }]) }); }
  return { retained: s.full_name };
}
