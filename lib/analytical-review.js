import { createHash } from 'node:crypto';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { missionDocuments } from './mission-files.js';
import { updateMissionRegister, notifyMissionKnowledge } from './mission-register.js';
import { tidyDrive } from './tidy-drive.js';
import { firmKnowledge } from './firm-learning.js';
import { gatherSources } from './mission-memory.js';
import { callModel, parseJsonLoose, providersStatus } from './ai-plus.js';
import { setMissionFunction } from './mission-function.js';
import { startAuditorReview } from './enhanced-auditor.js';
import { audit } from './audit-log.js';

const FILE = 'OFFICE_MANAGER_ANALYTICAL_REVIEW.json';
const MISSION_FILES = 'OFFICE_MANAGER_MISSION_FILES.json';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const q = encodeURIComponent;
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const cut = (v, n = 1000) => String(v ?? '').slice(0, n);
const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const folderSlug = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase().slice(0, 60) || 'AUTRES';

export const BASE_REQUIREMENTS = Object.freeze([
  { key: 'trial_balance_current', label: 'Balance générale de la période', why: 'Base de la revue analytique et des comparaisons par comptes.', required: true, match_terms: ['balance générale', 'balance generale', 'trial balance'] },
  { key: 'general_ledger', label: 'Grand livre', why: 'Permet d’expliquer les variations et d’investiguer les mouvements inhabituels.', required: true, match_terms: ['grand livre', 'general ledger', 'ledger'] },
  { key: 'comparative', label: 'Comparatif N-1', why: 'Permet l’analyse des évolutions par rapport à la période précédente.', required: false, match_terms: ['n-1', 'comparatif', 'previous year', 'prior year'] },
  { key: 'financial_statements', label: 'États financiers', why: 'Permet de rapprocher les principaux agrégats et ratios.', required: false, match_terms: ['états financiers', 'etats financiers', 'financial statements', 'bilan', 'compte de résultat'] },
  { key: 'budget', label: 'Budget / prévisions', why: 'Permet une comparaison réel vs prévision lorsqu’elle est pertinente.', required: false, match_terms: ['budget', 'forecast', 'prévision', 'prevision'] }
]);

const LAB_INSTRUCTIONS = `Tu es EYNOWA Lab, la couche de connaissance métier d’un système d’audit. Ton rôle ici n’est PAS de constater des faits sur le client : les documents de la mission restent la seule preuve des faits client. Tu apportes la connaissance accumulée du cabinet, les leçons de missions précédentes, la méthodologie et ton expérience de raisonnement pour préparer une REVUE ANALYTIQUE PRÉLIMINAIRE avant le programme de travail.
À partir du contexte fourni :
1. indique les documents réellement utiles à demander pour cette mission ;
2. explique pourquoi chacun est utile et s’il est indispensable ou seulement recommandé ;
3. indique les axes analytiques à regarder en priorité ;
4. liste les risques ou pièges méthodologiques à ne pas oublier ;
5. ne transforme jamais une connaissance historique ou une hypothèse en fait sur le client actuel.
Les deux documents de base "Balance générale de la période" et "Grand livre" ne peuvent pas être supprimés de la liste minimale.
Réponds en JSON STRICT : {"documents":[{"key":"","label":"","why":"","required":true,"match_terms":[""]}],"focus":[""],"knowledge_points":[""],"methodology_warnings":[""]}.`;

async function missionRow(orgId, missionId, d = {}) {
  if (!UUID.test(String(missionId || ''))) throw fail('VALID_MISSION_ID_REQUIRED');
  const fetchRows = d.fetchRows || rest;
  const base = `office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}`;
  let row;
  try {
    row = (await fetchRows(base + '&select=id,name,client_name,status,drive_folder_id,planned_start,planned_end,engagement_type,period_label&limit=1'))?.[0];
  } catch {
    row = (await fetchRows(base + '&select=id,name,client_name,status,drive_folder_id,planned_start,planned_end&limit=1'))?.[0];
  }
  if (!row) throw fail('MISSION_NOT_FOUND', 404);
  return row;
}

async function teamWithAssignments(orgId, missionId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  let rows;
  try {
    rows = await fetchRows(`office_mission_assignments?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&status=not.in.(cancelled,canceled,rejected,completed)&select=id,staff_profile_id,mission_role,mission_function,status&limit=100`) || [];
  } catch {
    rows = await fetchRows(`office_mission_assignments?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&status=not.in.(cancelled,canceled,rejected,completed)&select=id,staff_profile_id,mission_role,status&limit=100`) || [];
  }
  const ids = [...new Set(rows.map(x => x.staff_profile_id).filter(Boolean))];
  const people = ids.length ? await fetchRows(`office_staff_profiles?org_id=eq.${q(orgId)}&id=in.(${ids.map(q).join(',')})&select=id,full_name,email,role_title&limit=100`).catch(() => []) || [] : [];
  const byId = new Map(people.map(p => [p.id, p]));
  return rows.map(r => ({ ...r, full_name: byId.get(r.staff_profile_id)?.full_name || r.staff_profile_id, email: byId.get(r.staff_profile_id)?.email || null, role_title: byId.get(r.staff_profile_id)?.role_title || null }));
}

function hasAccess(account, team) {
  if (['owner', 'partner'].includes(account?.role)) return true;
  const email = String(account?.email || '').toLowerCase();
  return Boolean(email) && team.some(t => String(t.email || '').toLowerCase() === email);
}

function mergeRequirements(lab = []) {
  const out = BASE_REQUIREMENTS.map(x => ({ ...x, match_terms: [...x.match_terms], source: 'minimum' }));
  for (const raw of Array.isArray(lab) ? lab : []) {
    if (!raw || !raw.label) continue;
    const label = cut(raw.label, 160), key = cut(raw.key || norm(label).replace(/\s+/g, '_'), 100);
    const existing = out.find(x => x.key === key || norm(x.label) === norm(label));
    const terms = (Array.isArray(raw.match_terms) ? raw.match_terms : []).map(x => cut(x, 100)).filter(Boolean).slice(0, 12);
    if (existing) {
      existing.required = Boolean(existing.required || raw.required);
      if (raw.why) existing.why = cut(raw.why, 500);
      existing.match_terms = [...new Set([...existing.match_terms, ...terms])];
    } else {
      out.push({ key, label, why: cut(raw.why, 500), required: Boolean(raw.required), match_terms: terms.length ? terms : [label], source: 'eynowa-lab' });
    }
  }
  return out.slice(0, 20);
}

function documentSignature(mission, docs) {
  const raw = JSON.stringify({ mission: [mission.id, mission.name, mission.client_name, mission.engagement_type, mission.period_label], docs: docs.map(d => [d.id, d.name, d.role, d.period, d.at]) });
  return createHash('sha256').update(raw).digest('hex');
}

async function loadCache(d = {}) {
  return loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ fileId: null, state: null }));
}
async function saveCache(state, cur, d = {}) {
  return saveJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId(), cur.fileId, state, cur.modifiedTime || null);
}

export async function eynowaAnalyticalKnowledge(orgId, missionId, d = {}) {
  const mission = await missionRow(orgId, missionId, d);
  const docs = await (d.missionDocuments || missionDocuments)(missionId, d).catch(() => []) || [];
  const signature = documentSignature(mission, docs);
  const cache = await loadCache(d);
  const prior = cache.state?.missions?.[missionId];
  if (prior?.signature === signature && prior?.lab?.status === 'used' && Date.now() - Date.parse(prior.updated_at || 0) < 6 * 60 * 60 * 1000) return prior;

  const labReady = Boolean((d.providersStatus || providersStatus)(d.env || process.env)['eynowa-lab']);
  let firm = null, sources = null;
  try { firm = await (d.firmKnowledge || firmKnowledge)(d); } catch { firm = null; }
  try { sources = await (d.gatherSources || gatherSources)(orgId, mission, d); } catch { sources = null; }
  const priorMissions = (firm?.missions || []).filter(x => {
    const hay = norm([x.client, x.name, x.type, x.kind].filter(Boolean).join(' '));
    return hay && (hay.includes(norm(mission.client_name)) || (mission.engagement_type && hay.includes(norm(mission.engagement_type))));
  }).slice(0, 12);
  const compact = {
    mission: { name: mission.name, client: mission.client_name || null, type: mission.engagement_type || null, period: mission.period_label || null, dates: [mission.planned_start, mission.planned_end] },
    documents_already_present: docs.slice(0, 80).map(x => ({ name: x.name, type: x.type, role: x.role, period: x.period, summary: cut(x.summary, 500) })),
    firm: firm ? { name: firm.firm?.name || null, activity: firm.firm?.activity || null, summary: cut(firm.firm?.summary, 1500), prior_missions: priorMissions } : null,
    mission_memory: sources ? { engagement: sources.engagement ? { tdr: sources.engagement.tdr || null, match: sources.engagement.match || null } : null, prior_review: sources.review ? { summary: sources.review.summary || null, priority_actions: sources.review.priority_actions || [] } : null, mission_data: sources.missionData?.structured || null } : null
  };

  let parsed = { documents: [], focus: [], knowledge_points: [], methodology_warnings: [] };
  let lab = { status: labReady ? 'failed' : 'not_configured', provider: 'eynowa-lab', model: null, error: null };
  if (labReady) {
    try {
      const r = await (d.callModel || callModel)({ provider: 'eynowa-lab', instructions: LAB_INSTRUCTIONS, input: JSON.stringify(compact).slice(0, 70000), maxTokens: 5000 }, d);
      parsed = parseJsonLoose(r.text);
      lab = { status: 'used', provider: r.provider || 'eynowa-lab', model: r.model || null, error: null };
    } catch (e) {
      lab.error = cut(e.message || e, 220);
    }
  }
  const entry = {
    mission_id: missionId,
    signature,
    updated_at: new Date().toISOString(),
    lab,
    requirements: mergeRequirements(parsed.documents),
    focus: (parsed.focus || []).map(x => cut(x, 500)).filter(Boolean).slice(0, 20),
    knowledge_points: (parsed.knowledge_points || []).map(x => cut(x, 700)).filter(Boolean).slice(0, 20),
    methodology_warnings: (parsed.methodology_warnings || []).map(x => cut(x, 700)).filter(Boolean).slice(0, 20)
  };
  const next = cache.state || { missions: {} };
  next.missions ||= {};
  next.missions[missionId] = entry;
  next.updated_at = entry.updated_at;
  await saveCache(next, cache, d).catch(() => null);
  return entry;
}

export async function analyticalReviewContext(orgId, missionId, account, d = {}) {
  const mission = await missionRow(orgId, missionId, d);
  const [team, docs, knowledge] = await Promise.all([
    teamWithAssignments(orgId, missionId, d),
    (d.missionDocuments || missionDocuments)(missionId, d).catch(() => []),
    eynowaAnalyticalKnowledge(orgId, missionId, d)
  ]);
  if (!hasAccess(account, team)) throw fail('NOT_ON_THIS_MISSION', 403);
  const managers = team.filter(x => x.mission_function === 'manager');
  return {
    mission,
    team,
    manager: managers[0] || null,
    manager_required: !managers.length,
    can_choose_manager: ['owner', 'partner'].includes(account?.role),
    documents: docs,
    lab: knowledge.lab,
    requirements: knowledge.requirements,
    focus: knowledge.focus,
    knowledge_points: knowledge.knowledge_points,
    methodology_warnings: knowledge.methodology_warnings
  };
}

export async function chooseAnalyticalManager(orgId, missionId, assignmentId, account, d = {}) {
  await missionRow(orgId, missionId, d);
  return (d.setMissionFunction || setMissionFunction)(orgId, { mission_id: missionId, assignment_id: assignmentId, function: 'manager' }, account, d);
}

async function ensureReviewFolders(mission, d = {}) {
  if (!mission.drive_folder_id) throw fail('MISSION_FOLDER_REQUIRED', 409);
  const drive = d.tidyDrive || tidyDrive;
  const root = await drive.findOrCreateFolder(mission.drive_folder_id, 'REVUE_ANALYTIQUE');
  const sources = await drive.findOrCreateFolder(root.id, 'SOURCES');
  return { root: root.id, sources: sources.id };
}

function requirementForDocument(doc, requirements) {
  const hay = norm([doc.name, doc.type, doc.role, doc.period, doc.summary].filter(Boolean).join(' '));
  if (!hay) return null;
  let best = null, score = 0;
  for (const r of requirements || []) {
    const terms = [...(r.match_terms || []), r.label].map(norm).filter(Boolean);
    const hits = terms.filter(t => hay.includes(t)).length;
    if (hits > score) { score = hits; best = r; }
  }
  return best;
}

async function cachedRequirements(missionId, d = {}) {
  const cache = await loadCache(d);
  return cache.state?.missions?.[missionId]?.requirements || BASE_REQUIREMENTS;
}

async function patchMissionDocument(orgId, missionId, fileId, patch, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const result = await (d.updateMissionRegister || updateMissionRegister)(MISSION_FILES, previous => {
    const st = previous || { missions: {} };
    const m = st.missions?.[missionId];
    if (!m) return st;
    const doc = (m.documents || []).find(x => x.id === fileId);
    if (doc) Object.assign(doc, patch, { at: new Date().toISOString() });
    st.updated_at = new Date().toISOString();
    return st;
  }, { drive, folder, orgId, fetchRows: d.fetchRows || rest, acquireLease: d.acquireLease });
  await (d.notifyMissionKnowledge || notifyMissionKnowledge)(orgId, missionId, { agent: 'mission-controller', action: 'ANALYTICAL_REVIEW_DOCUMENT_UPDATED', source: result.fileId, input: { file_id: fileId, patch } }, d).catch(() => null);
}

export async function organizeAnalyticalFile(orgId, missionId, fileId, kind, account, d = {}) {
  const mission = await missionRow(orgId, missionId, d);
  const team = await teamWithAssignments(orgId, missionId, d);
  if (!hasAccess(account, team)) throw fail('NOT_ON_THIS_MISSION', 403);
  const docs = await (d.missionDocuments || missionDocuments)(missionId, d).catch(() => []) || [];
  const doc = docs.find(x => x.id === fileId);
  if (!doc) throw fail('FILE_NOT_LINKED_TO_MISSION', 404);
  const folders = await ensureReviewFolders(mission, d);
  const drive = d.tidyDrive || tidyDrive;
  const meta = await drive.getFile(fileId);
  if (!meta || meta.trashed) throw fail('FILE_GONE', 404);
  const from = meta.parents?.[0] || null;
  let target = folders.root, category = null;
  if (kind !== 'review') {
    const requirements = await cachedRequirements(missionId, d);
    const req = requirementForDocument(doc, requirements);
    category = folderSlug(req?.label || doc.type || doc.role || 'AUTRES');
    const categoryFolder = await drive.findOrCreateFolder(folders.sources, category);
    target = categoryFolder.id;
  }
  if (from !== target) await drive.move(fileId, from, target, null);
  const rel = kind === 'review' ? `REVUE_ANALYTIQUE/${meta.name}` : `REVUE_ANALYTIQUE/SOURCES/${category}/${meta.name}`;
  await patchMissionDocument(orgId, missionId, fileId, { path: rel, deposit: kind === 'review' ? 'analytical_review' : 'analytical_review_source', analytical_category: category, ...(kind === 'review' ? { role: 'feuille_de_travail' } : {}) }, d);
  await (d.audit || audit)(orgId, { agent: 'mission-controller', mission_id: missionId, action_type: 'ANALYTICAL_REVIEW_FILE_ORGANIZED', status: 'succeeded', decision: rel, approved_by: cut(account.display_name || account.email, 120), approved_at: new Date().toISOString(), source_ref: 'drive:' + fileId }, { fetchRows: d.fetchRows || rest }).catch(() => null);
  return { organized: true, file_id: fileId, folder_id: target, path: rel, category };
}

export async function deleteAnalyticalFile(orgId, missionId, fileId, account, d = {}) {
  await missionRow(orgId, missionId, d);
  const team = await teamWithAssignments(orgId, missionId, d);
  if (!hasAccess(account, team)) throw fail('NOT_ON_THIS_MISSION', 403);
  const docs = await (d.missionDocuments || missionDocuments)(missionId, d).catch(() => []) || [];
  const doc = docs.find(x => x.id === fileId);
  if (!doc) throw fail('FILE_NOT_LINKED_TO_MISSION', 404);
  const isManager = team.some(t => t.mission_function === 'manager' && String(t.email || '').toLowerCase() === String(account.email || '').toLowerCase());
  const isLead = ['owner', 'partner'].includes(account.role) || isManager;
  const mine = [account.email, account.display_name].filter(Boolean).some(v => norm(v) === norm(doc.by));
  if (!isLead && !mine) throw fail('ONLY_UPLOADER_OR_MISSION_MANAGER_MAY_DELETE', 403);
  const drive = d.tidyDrive || tidyDrive;
  const meta = await drive.getFile(fileId);
  if (!meta || meta.trashed) throw fail('FILE_GONE', 404);
  await drive.trashFile(fileId, { expectedChecksum: meta.md5Checksum || null, expectedVersion: meta.modifiedTime || null, expectedName: meta.name });
  const memDrive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const result = await (d.updateMissionRegister || updateMissionRegister)(MISSION_FILES, previous => {
    const st = previous || { missions: {} };
    if (st.missions?.[missionId]) st.missions[missionId].documents = (st.missions[missionId].documents || []).filter(x => x.id !== fileId);
    st.updated_at = new Date().toISOString();
    return st;
  }, { drive: memDrive, folder, orgId, fetchRows: d.fetchRows || rest, acquireLease: d.acquireLease });
  await (d.notifyMissionKnowledge || notifyMissionKnowledge)(orgId, missionId, { agent: 'mission-controller', action: 'ANALYTICAL_REVIEW_DOCUMENT_REMOVED', source: result.fileId, input: { file_id: fileId, name: meta.name } }, d).catch(() => null);
  await (d.audit || audit)(orgId, { agent: 'mission-controller', mission_id: missionId, action_type: 'ANALYTICAL_REVIEW_FILE_TRASHED', status: 'succeeded', decision: meta.name, approved_by: cut(account.display_name || account.email, 120), approved_at: new Date().toISOString(), source_ref: 'drive:' + fileId }, { fetchRows: d.fetchRows || rest }).catch(() => null);
  return { deleted: true, recoverable: true, file_id: fileId, name: meta.name };
}

export async function startAnalyticalReview(orgId, req, missionId, account, d = {}) {
  await missionRow(orgId, missionId, d);
  const team = await teamWithAssignments(orgId, missionId, d);
  if (!hasAccess(account, team)) throw fail('NOT_ON_THIS_MISSION', 403);
  const manager = team.find(x => x.mission_function === 'manager');
  if (!manager) throw fail('MANAGER_REQUIRED_BEFORE_ANALYTICAL_REVIEW', 409);
  if (!['owner', 'partner', 'manager', 'supervisor'].includes(account.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const knowledge = await eynowaAnalyticalKnowledge(orgId, missionId, d);
  const labBlock = knowledge.lab?.status === 'used'
    ? `\n\nCONNAISSANCE EYNOWA LAB — utilisée comme connaissance méthodologique, jamais comme preuve client :\n${JSON.stringify({ focus: knowledge.focus, knowledge_points: knowledge.knowledge_points, methodology_warnings: knowledge.methodology_warnings, requested_documents: knowledge.requirements }).slice(0, 12000)}`
    : `\n\nEYNOWA LAB : ${knowledge.lab?.status || 'indisponible'}${knowledge.lab?.error ? ' (' + knowledge.lab.error + ')' : ''}. Ne pas inventer sa connaissance.`;
  const focus = `[REVUE_ANALYTIQUE_PRELIMINAIRE]\nManager de mission : ${manager.full_name}.\nEffectue la revue analytique préliminaire AVANT le programme de travail. Analyse les évolutions N/N-1 disponibles, tendances, ratios pertinents, soldes ou mouvements inhabituels, comptes nouveaux/disparus, incohérences et zones significatives. Distingue faits, hypothèses et connaissance méthodologique. Fais ressortir anomalies potentielles, questions client, documents complémentaires et conséquences possibles sur les risques et le futur programme de travail.${labBlock}`;
  return (d.startAuditorReview || startAuditorReview)(orgId, req, { mission_id: missionId, focus, requested_by: account.display_name || account.email }, d);
}
