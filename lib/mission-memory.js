import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, saveJsonFile, loadScan } from './mapping-scan.js';
import { tidyDrive } from './tidy-drive.js';
import { LABELS, canonicalStatus, canMove, isLive, ENDED_VALUES } from './mission-status.js';
import { audit } from './audit-log.js';

// MISSION MEMORY (2026-10-08, extension « mémoire »). ADDED next to what exists:
//   <dossier de la mission>/00_OFFICE_MANAGER/MISSION_MEMORY.json
// - The firm's tree is never reorganised: the mission folder is the one that already exists.
//   Found for sure (index, or one single folder matching the mission) → its system folder is reused
//   (any folder named « …OFFICE MANAGER… » already there) or 00_OFFICE_MANAGER is created inside it.
//   Not sure → nothing is created: a proposal « MISSION_FOLDER_LINK » goes to « À valider ».
// - One writer: Mission Controller. Built from the SOURCES (mission row, team, open actions,
//   documents attached, engagement preparation, Enhanced Auditor review) — never a summary of a
//   summary. Tables have columns/rows so the memory opens as a spreadsheet (one sheet per table).
// - Supabase keeps only the index (drive_folder_id, memory_file_id, client_name, dates of status).
// - Closed mission: final memory, cross-mission learnings PROPOSED (office_learnings, observed →
//   confirmed at 2 missions or by a partner), out of the active context. Archived: only after a
//   validation; the memory stays with the archived mission folder.

export const MEMORY_NAME = 'MISSION_MEMORY.json';
export const SYSTEM_FOLDER = '00_OFFICE_MANAGER';
export const MEMORY_WRITER = 'mission-controller';
const FOLDER = 'application/vnd.google-apps.folder';
const SYSTEM_RE = /office[\s_.-]*manager/i;
const q = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cut = (s, n = 300) => s == null ? null : String(s).slice(0, n);
const STOP = new Set(['de', 'du', 'la', 'le', 'les', 'des', 'et', 'the', 'of', 'and', 'mission', 'missions', 'client', 'clients', 'sa', 'sarl', 'sas', 'ltd', 'inc', 'l', 'd', 'a', 'en', 'pour', 'au', 'aux']);

export const tokens = s => [...new Set(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t) && (t.length > 1 || /\d/.test(t))))];
const YEAR = /^(19|20)\d\d$/;

// ---------- 1. The mission folder: sure, or a proposal ----------

async function folderList(orgId, d) {
  const fetchRows = d.fetchRows || rest;
  const inv = await fetchRows('orpailleur_inventory?org_id=eq.' + q(orgId) + '&is_folder=eq.true&select=file_id,name,folder_path,parent_id&limit=5000').catch(() => []) || [];
  if (inv.length) return inv.map(f => ({ id: f.file_id, name: f.name, parent: f.parent_id, path: String(f.folder_path || '').endsWith(f.name) ? f.folder_path : (f.folder_path || '') + '/' + f.name }));
  const { state } = await (d.loadScan || loadScan)(d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null }));
  return (state?.items || []).filter(i => i.mimeType === FOLDER).map(i => ({ id: i.id, name: i.name, parent: i.parents?.[0] || null, path: i.path || i.name }));
}

// Every word of the mission's name is in the folder's path, and no shallower folder already
// has them all: exactly one such folder = sure. Documents of the mission (inventory) confirm it.
export function matchMissionFolder(mission, folders, docParents = []) {
  const want = tokens(mission.name);
  if (want.length < 2) return { certain: false, candidates: [] };
  const byId = new Map(folders.map(f => [f.id, f]));
  const full = folders.filter(f => !SYSTEM_RE.test(f.name)).filter(f => { const have = new Set(tokens(f.path)); return want.every(t => have.has(t)); });
  const fullIds = new Set(full.map(f => f.id));
  const hasFullAncestor = f => { let p = byId.get(f.parent), guard = 0; while (p && guard++ < 40) { if (fullIds.has(p.id)) return true; p = byId.get(p.parent); } return false; };
  const minimal = full.filter(f => !hasFullAncestor(f));
  const isUnder = (id, root) => { let p = byId.get(id), guard = 0; while (p && guard++ < 40) { if (p.id === root) return true; p = byId.get(p.parent); } return false; };
  if (minimal.length === 1) return { certain: true, folder: minimal[0], source: 'nom' };
  // Several folders carry the name: the one holding the mission's own documents (all of them).
  if (minimal.length > 1 && docParents.length) {
    const holding = minimal.filter(f => docParents.every(p => p === f.id || isUnder(p, f.id)));
    if (holding.length === 1) return { certain: true, folder: holding[0], source: 'documents' };
  }
  // Candidates for the person: the closest names first.
  const scored = (minimal.length ? minimal : folders.filter(f => !SYSTEM_RE.test(f.name)).map(f => ({ ...f, score: want.filter(t => tokens(f.path).includes(t)).length })).filter(f => f.score >= Math.max(2, want.length - 1)).sort((a, b) => b.score - a.score));
  return { certain: false, candidates: scored.slice(0, 5).map(f => ({ id: f.id, name: f.name, path: f.path })) };
}

export async function resolveMissionFolder(orgId, mission, d = {}) {
  if (mission.drive_folder_id) return { certain: true, folder: { id: mission.drive_folder_id }, source: 'index' };
  const fetchRows = d.fetchRows || rest;
  const folders = await folderList(orgId, d);
  const docs = await fetchRows('orpailleur_inventory?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(mission.id) + '&is_folder=eq.false&select=parent_id&limit=200').catch(() => []) || [];
  return matchMissionFolder(mission, folders, [...new Set(docs.map(x => x.parent_id).filter(Boolean))]);
}

async function proposeFolderLink(orgId, mission, match, d) {
  const best = match.candidates?.[0];
  const now = new Date().toISOString();
  await (d.fetchRows || rest)('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: orgId, status: 'proposed', work_state: 'requested', requested_at: now, agent_key: 'grand-controleur', action_type: 'MISSION_FOLDER_LINK',
      office_mission_id: mission.id, idempotency_key: 'mission-folder:' + mission.id + ':' + (best?.id || 'none'),
      summary: (best ? 'Mission Controller : le dossier Drive de « ' + mission.name + ' » est-il « ' + best.path + ' » ? Validez pour y garder la mémoire de la mission (sous-dossier ' + SYSTEM_FOLDER + ').'
        : 'Mission Controller : dossier Drive de « ' + mission.name + ' » introuvable avec certitude. Indiquez-le pour que la mémoire de la mission y soit gardée.').slice(0, 500),
      payload: { mission_id: mission.id, folder_id: best?.id || null, folder_path: best?.path || null, candidates: match.candidates || [], for_agent: 'mission-controller' },
      evidence: { source: 'mémoire de mission', rule: 'aucun dossier créé sans certitude' } }]) }).catch(() => null);
}

// The system folder inside the mission folder: an existing one is reused, else 00_OFFICE_MANAGER.
export async function missionSystemFolder(folderId, d = {}) {
  const drive = d.drive || driveAdapter;
  const children = await drive.listChildren(folderId).catch(() => []) || [];
  const existing = children.find(c => c.mimeType === FOLDER && SYSTEM_RE.test(c.name || ''));
  if (existing) return { id: existing.id, name: existing.name, reused: true };
  const created = await (d.tidyDrive || tidyDrive).findOrCreateFolder(folderId, SYSTEM_FOLDER);
  return { id: created.id, name: SYSTEM_FOLDER, reused: false };
}

// ---------- 2. Building the memory from the sources ----------

const table = (columns, rows) => ({ columns, rows: rows.map(r => columns.map(c => r[c] ?? null)) });

export async function gatherSources(orgId, mission, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const filter = 'org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(mission.id);
  const [assignments, actions] = await Promise.all([
    fetchRows('office_mission_assignments?' + filter + '&select=staff_profile_id,mission_role,planned_start,planned_end,allocation_pct,status&limit=100').catch(() => []),
    fetchRows('office_action_queue?' + filter + '&action_type=neq.PEOPLE_INTELLIGENCE_RECOMMENDATION&select=id,agent_key,action_type,summary,status,work_state,due_at,executed_at,created_at&order=created_at.desc&limit=100').catch(() => [])
  ]);
  const ids = [...new Set((assignments || []).map(a => a.staff_profile_id).filter(Boolean))];
  const staff = ids.length ? await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=in.(' + ids.join(',') + ')&select=id,full_name,title&limit=100').catch(() => []) : [];
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const central = d.central || {};
  const load = async name => central[name] !== undefined ? central[name] : (central[name] = (await loadJsonFile(name, drive, folder).catch(() => ({ state: null }))).state);
  const [files, engagements, auditor] = await Promise.all([load('OFFICE_MANAGER_MISSION_FILES.json'), load('OFFICE_MANAGER_ENGAGEMENTS.json'), load('OFFICE_MANAGER_ENHANCED_AUDITOR.json')]);
  return { assignments: assignments || [], actions: actions || [], staff: staff || [], documents: files?.missions?.[mission.id]?.documents || [],
    engagement: engagements?.engagements?.[mission.id] || null, review: auditor?.reviews?.[mission.id] || null };
}

export function buildMissionMemory(mission, src, previous = null, now = new Date()) {
  const at = now.toISOString();
  const status = canonicalStatus(mission.status);
  const names = new Map((src.staff || []).map(s => [s.id, s]));
  const tdr = src.engagement?.tdr || {};
  const history = [...(previous?.status_history || [])];
  if (!history.length || history[history.length - 1].status !== status) history.push({ status, label: LABELS[status], at: mission.status_changed_at || at });
  const open = (src.actions || []).filter(a => ['proposed', 'awaiting_approval'].includes(a.status) || (a.status === 'approved' && !a.executed_at));
  return {
    schema: 'office-manager.mission-memory/1', writer: MEMORY_WRITER, updated_at: at,
    mission: { id: mission.id, code: mission.mission_code || null, name: mission.name, client: mission.client_name || tdr.client || null,
      status, status_label: LABELS[status], planned_start: mission.planned_start || null, planned_end: mission.planned_end || null,
      closed_at: mission.closed_at || null, archived_at: mission.archived_at || null, industry: tdr.industry || null, engagement_type: tdr.engagement_type || null,
      framework: tdr.reporting_framework || null, country: tdr.country || null },
    status_history: history.slice(-30),
    // Tables: one sheet each when exported to Excel.
    tables: {
      team: table(['person', 'title', 'role', 'start', 'end', 'allocation_pct', 'status'], (src.assignments || []).map(a => ({ person: names.get(a.staff_profile_id)?.full_name || a.staff_profile_id, title: names.get(a.staff_profile_id)?.title || null, role: a.mission_role, start: a.planned_start, end: a.planned_end, allocation_pct: a.allocation_pct, status: a.status }))),
      documents: table(['name', 'role', 'period', 'summary', 'by', 'at', 'url'], (src.documents || []).slice(0, 150).map(x => ({ ...x, summary: cut(x.summary, 400) }))),
      open_actions: table(['ref', 'agent', 'type', 'summary', 'status', 'due_at'], open.slice(0, 60).map(a => ({ ref: a.id, agent: a.agent_key, type: a.action_type, summary: cut(a.summary, 300), status: a.status, due_at: a.due_at }))),
      required_capabilities: table(['capability', 'level', 'available', 'people', 'gap'], (src.engagement?.match?.requirements || []).map(r => ({ capability: r.capability, level: r.level || null, available: r.internal ?? null, people: (r.people || []).map(p => p.name || p).join(', ') || null, gap: r.gap ? 'oui' : 'non' }))),
      risks: table(['risk_id', 'risk', 'level', 'source', 'verdict', 'missing_procedures'], (src.review?.coverage || []).map(c => ({ ...c, missing_procedures: (c.missing_procedures || []).join(' ; ') || null }))),
      workfiles: table(['name', 'role', 'at', 'url'], (src.documents || []).filter(x => /xls|sheet|feuille|workfile|travail/i.test((x.type || '') + ' ' + (x.name || '') + ' ' + (x.role || ''))).map(x => ({ name: x.name, role: x.role, at: x.at, url: x.url })))
    },
    preparation: src.engagement ? { status: src.engagement.status, finished_at: src.engagement.finished_at || null, scope: cut(tdr.scope, 1500), risk_doc: src.engagement.risk_doc?.url || null, report_doc: src.engagement.report_doc?.url || null } : null,
    review: src.review ? { status: src.review.status, finished_at: src.review.finished_at || null, summary: src.review.summary || null, overall: cut(src.review.overall, 1500), priority_actions: (src.review.priority_actions || []).slice(0, 12), report: src.review.report?.url || null } : null,
    notes: previous?.notes || [],
    learnings_proposed: previous?.learnings_proposed || [],
    sources: ['office_missions:' + mission.id, 'office_mission_assignments', 'office_action_queue', 'OFFICE_MANAGER_MISSION_FILES.json', 'OFFICE_MANAGER_ENGAGEMENTS.json', 'OFFICE_MANAGER_ENHANCED_AUDITOR.json']
  };
}

// Tolerant PATCH of the index (the columns exist only after db/memory.sql).
async function patchIndex(orgId, missionId, fields, d) {
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null));
  if (!Object.keys(clean).length) return false;
  try {
    await (d.fetchRows || rest)('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(clean) });
    return true;
  } catch { return false; }
}

// Writes (or refreshes) one mission's memory. Only Mission Controller writes it.
export async function writeMissionMemory(orgId, mission, d = {}) {
  if ((d.writer || MEMORY_WRITER) !== MEMORY_WRITER) throw Object.assign(new Error('SINGLE_WRITER'), { statusCode: 403 });
  const match = await resolveMissionFolder(orgId, mission, d);
  if (!match.certain) { await proposeFolderLink(orgId, mission, match, d); return { mission_id: mission.id, status: 'folder_unknown', candidates: match.candidates || [] }; }
  const drive = d.drive || driveAdapter;
  const sys = await missionSystemFolder(match.folder.id, d);
  const src = await gatherSources(orgId, mission, d);
  let last = null;
  for (let i = 0; i < 3; i++) {
    const cur = await loadJsonFile(MEMORY_NAME, drive, sys.id);
    const memory = buildMissionMemory(mission, src, cur.state, d.now ? d.now() : new Date());
    if (d.extend) d.extend(memory);
    try {
      const fileId = await saveJsonFile(MEMORY_NAME, drive, sys.id, cur.fileId, memory, cur.fileId ? cur.modifiedTime : null);
      await patchIndex(orgId, mission.id, { drive_folder_id: match.source === 'index' ? null : match.folder.id, memory_file_id: fileId !== mission.memory_file_id ? fileId : null, client_name: !mission.client_name ? memory.mission.client : null }, d);
      return { mission_id: mission.id, status: 'written', file_id: fileId, folder: sys, memory };
    } catch (e) { last = e; if (!/MEMORY_CONFLICT|FILE_ALREADY_EXISTS/.test(String(e.message || e))) throw e; }
  }
  throw last;
}

export async function readMissionMemory(orgId, missionId, d = {}) {
  if (!UUID.test(String(missionId || ''))) throw Object.assign(new Error('VALID_MISSION_ID_REQUIRED'), { statusCode: 400 });
  const fetchRows = d.fetchRows || rest;
  let mission = (await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) + '&select=id,name,mission_code,status,memory_file_id,drive_folder_id&limit=1').catch(() => null))?.[0];
  if (!mission) mission = (await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) + '&select=id,name,mission_code,status&limit=1'))?.[0];
  if (!mission) throw Object.assign(new Error('MISSION_NOT_FOUND'), { statusCode: 404 });
  if (!mission.memory_file_id) return { mission_id: missionId, memory: null, reason: mission.drive_folder_id ? 'pas encore écrite' : 'dossier de la mission pas encore identifié' };
  const buf = await (d.drive || driveAdapter).downloadBuffer(mission.memory_file_id);
  try { return { mission_id: missionId, memory: JSON.parse(Buffer.from(buf).toString('utf8')) }; } catch { return { mission_id: missionId, memory: null, reason: 'fichier illisible' }; }
}

// Compact view for an agent's context (never the whole file).
export function compactMemory(m) {
  if (!m) return null;
  const rows = t => (m.tables?.[t]?.rows || []).map(r => Object.fromEntries(m.tables[t].columns.map((c, i) => [c, r[i]])));
  return { mission: m.mission, status_history: (m.status_history || []).slice(-5), team: rows('team').slice(0, 15).map(t => t.person + ' (' + (t.role || '?') + ')'),
    open_actions: rows('open_actions').slice(0, 10).map(a => a.summary), uncovered_risks: rows('risks').filter(r => r.verdict && r.verdict !== 'couvert').slice(0, 10).map(r => r.risk + ' — ' + r.verdict),
    gaps: rows('required_capabilities').filter(r => r.gap === 'oui').map(r => r.capability), documents: rows('documents').length, review: m.review?.summary || null, learnings: (m.learnings_proposed || []).slice(0, 10), updated_at: m.updated_at };
}

// ---------- 3. Refresh (Mission Controller, at each tick, a few missions at a time) ----------

export async function refreshMissionMemories(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const limit = d.limit || 3;
  let rows = await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&status=not.in.(' + ENDED_VALUES.join(',') + ')&select=id,name,mission_code,status,planned_start,planned_end,client_name,drive_folder_id,memory_file_id,status_changed_at&limit=300').catch(() => null);
  if (!rows) rows = await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&status=not.in.(' + ENDED_VALUES.join(',') + ')&select=id,name,mission_code,status,planned_start,planned_end&limit=300') || [];
  rows = rows.filter(m => !/entra[iî]nement|training/i.test(m.name || ''));
  const seen = d.seen || {};
  rows.sort((a, b) => String(seen[a.id] || '').localeCompare(String(seen[b.id] || '')));
  const central = {};
  const out = [];
  for (const m of rows.slice(0, limit)) {
    try { const r = await writeMissionMemory(orgId, m, { ...d, central }); out.push({ mission_id: m.id, status: r.status }); }
    catch (e) { out.push({ mission_id: m.id, status: 'failed', error: cut(e.message || e, 160) }); }
  }
  return { missions: out, total: rows.length };
}

// ---------- 4. Status changes, closure, learnings, archive ----------

// A status change is PROPOSED (À valider); executed by lib/action-executor.js (MISSION_UPDATE).
export async function proposeStatusChange(orgId, mission, to, why, d = {}) {
  if (!canMove(mission.status, to)) throw Object.assign(new Error('STATUS_MOVE_NOT_ALLOWED'), { statusCode: 400 });
  const now = new Date().toISOString();
  await (d.fetchRows || rest)('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: orgId, status: 'proposed', work_state: 'requested', requested_at: now, agent_key: 'grand-controleur', action_type: 'MISSION_UPDATE',
      office_mission_id: mission.id, idempotency_key: 'mission-status:' + mission.id + ':' + to + ':' + now.slice(0, 10),
      summary: ('Passer « ' + mission.name + ' » de « ' + LABELS[canonicalStatus(mission.status)] + ' » à « ' + LABELS[to] + ' »' + (why ? ' : ' + why : '')).slice(0, 500),
      payload: { kind: 'status_change', mission_id: mission.id, status: to, previous_status: mission.status || null, why: cut(why, 300) },
      evidence: { source: 'cycle de vie de la mission' } }]) });
  return { proposed: true, to };
}

// What a closed mission teaches (deterministic, from its own memory; no model reasoning stored).
export function learningsFrom(memory) {
  const out = [];
  const m = memory?.mission || {};
  const type = String(m.engagement_type || '').trim() || 'mission';
  if (m.planned_end && m.closed_at) {
    const late = Math.round((Date.parse(m.closed_at) - Date.parse(m.planned_end)) / 86400000);
    if (late > 7) out.push({ category: 'cycle_duration', key: 'depassement:' + tokens(type).join('-'), statement: 'Les missions « ' + type + ' » se terminent après leur fin prévue (ici ' + late + ' jours de dépassement).' });
  }
  const rows = t => (memory?.tables?.[t]?.rows || []).map(r => Object.fromEntries(memory.tables[t].columns.map((c, i) => [c, r[i]])));
  for (const r of rows('risks').filter(r => r.verdict === 'non couvert').slice(0, 5)) out.push({ category: 'risk', key: 'non-couvert:' + tokens(r.risk).slice(0, 6).join('-'), statement: 'Risque souvent mal couvert : ' + cut(r.risk, 200) + (r.missing_procedures ? ' (procédures manquantes : ' + cut(r.missing_procedures, 200) + ')' : '') + '.' });
  for (const r of rows('required_capabilities').filter(r => r.gap === 'oui').slice(0, 5)) out.push({ category: 'training_need', key: 'manque:' + tokens(r.capability).slice(0, 6).join('-'), statement: 'Compétence manquante en interne : ' + cut(r.capability, 200) + '.' });
  const pbc = rows('open_actions').filter(a => /PBC/i.test(a.type || '')).length;
  if (pbc >= 3) out.push({ category: 'pbc_difficulty', key: 'pbc:' + tokens(type).join('-'), statement: pbc + ' relances PBC encore ouvertes à la clôture d’une mission « ' + type + ' ».' });
  return out.filter(l => l.key.split(':')[1]);
}

// Observed once → « observed ». Seen on 2 missions or more → « confirmed ». A rejected one stays rejected.
export async function recordLearnings(orgId, missionId, items, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const now = new Date().toISOString();
  const done = [];
  for (const l of items) {
    try {
      const cur = (await fetchRows('office_learnings?org_id=eq.' + q(orgId) + '&category=eq.' + q(l.category) + '&key=eq.' + q(l.key) + '&select=id,source_mission_ids,occurrences,status&limit=1'))?.[0];
      if (!cur) {
        await fetchRows('office_learnings', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ org_id: orgId, category: l.category, key: l.key, statement: l.statement, source_mission_ids: [missionId], occurrences: 1, status: 'observed', first_seen_at: now, last_seen_at: now }]) });
        done.push({ ...l, status: 'observed' });
      } else if (!(cur.source_mission_ids || []).includes(missionId)) {
        const ids = [...(cur.source_mission_ids || []), missionId];
        const status = cur.status === 'rejected' ? 'rejected' : ids.length >= 2 ? 'confirmed' : 'observed';
        await fetchRows('office_learnings?org_id=eq.' + q(orgId) + '&id=eq.' + q(cur.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ source_mission_ids: ids, occurrences: (cur.occurrences || 1) + 1, status, statement: l.statement, last_seen_at: now }) });
        done.push({ ...l, status });
      }
    } catch (e) { return { recorded: done, migration_missing: /office_learnings|PGRST|42P01|relation/i.test(String(e.message || e)), error: cut(e.message || e, 160) }; }
  }
  return { recorded: done };
}

export async function listLearnings(orgId, { category, status } = {}, fetchRows = rest) {
  let path = 'office_learnings?org_id=eq.' + q(orgId);
  if (category) path += '&category=eq.' + q(category);
  if (status) path += '&status=eq.' + q(status); else path += '&status=neq.rejected';
  try { return { learnings: await fetchRows(path + '&select=id,category,statement,occurrences,status,confirmed_by,last_seen_at,source_mission_ids&order=status.asc,occurrences.desc&limit=100') || [] }; }
  catch { return { learnings: [], migration_missing: true }; }
}

export async function confirmLearning(orgId, id, by, decision = 'confirmed', fetchRows = rest) {
  if (!UUID.test(String(id || ''))) throw Object.assign(new Error('VALID_ID_REQUIRED'), { statusCode: 400 });
  if (!['confirmed', 'rejected'].includes(decision)) throw Object.assign(new Error('INVALID_DECISION'), { statusCode: 400 });
  await fetchRows('office_learnings?org_id=eq.' + q(orgId) + '&id=eq.' + q(id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: decision, confirmed_by: cut(by, 120) }) });
  return { id, status: decision };
}

// After a validated closure: final memory, learnings proposed. (The mission already leaves the
// active context: LIVE_FILTER excludes closed missions.)
export async function closeMission(orgId, missionId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const mission = (await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) + '&select=id,name,mission_code,status,planned_start,planned_end,client_name,drive_folder_id,memory_file_id,closed_at,status_changed_at&limit=1').catch(() => null))?.[0]
    || (await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) + '&select=id,name,mission_code,status,planned_start,planned_end&limit=1'))?.[0];
  if (!mission) return { closed: false, reason: 'MISSION_NOT_FOUND' };
  if (!mission.closed_at && canonicalStatus(mission.status) === 'closed') mission.closed_at = new Date().toISOString();
  let learnings = [];
  const r = await writeMissionMemory(orgId, mission, { ...d, extend: mem => { learnings = learningsFrom(mem); mem.learnings_proposed = learnings.map(l => l.statement); mem.final = true; } });
  const rec = learnings.length ? await recordLearnings(orgId, missionId, learnings, d) : { recorded: [] };
  await (d.audit || audit)(orgId, { agent: MEMORY_WRITER, mission_id: missionId, action_type: 'MISSION_CLOSED_MEMORY', status: r.status === 'written' ? 'succeeded' : 'skipped', output_ref: r.file_id ? 'drive:' + r.file_id : r.status, decision: learnings.length + ' apprentissage(s)' }, { fetchRows }).catch(() => null);
  return { closed: true, memory: r.status, learnings: rec };
}

// Same client, earlier missions (closed or archived): their memory, compact, for a new engagement.
export async function priorMissionMemories(orgId, mission, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const want = tokens(mission.client_name || mission.client || mission.name).filter(t => !YEAR.test(t));
  if (!want.length) return [];
  const rows = await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&status=in.(' + ENDED_VALUES.filter(s => !/cancel|annul|merged/.test(s)).join(',') + ')&select=id,name,status,client_name,memory_file_id,planned_end&order=planned_end.desc.nullslast&limit=300').catch(() => []) || [];
  const same = rows.filter(r => r.id !== mission.id && r.memory_file_id).filter(r => {
    if (mission.client_name && r.client_name) return tokens(r.client_name).join(' ') === tokens(mission.client_name).join(' ');
    const have = new Set(tokens(r.client_name || r.name)); return want.every(t => have.has(t));
  }).slice(0, d.max || 3);
  const out = [];
  for (const r of same) {
    try { const buf = await (d.drive || driveAdapter).downloadBuffer(r.memory_file_id); out.push(compactMemory(JSON.parse(Buffer.from(buf).toString('utf8')))); } catch { /* unreadable: skipped */ }
  }
  return out.filter(Boolean);
}

export { isLive };
