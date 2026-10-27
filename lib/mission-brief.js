// LA MÉMOIRE PARTAGÉE D'UNE MISSION (Paul, 2026-10-26 : « mémoire partagée sur les informations dont chacun a besoin dans une mission »).
// Une seule vérité par mission, dans le dossier de la mission (_OFFICE_MANAGER/OFFICE_MANAGER_MISSION_MEMORY.json, avec l'index central) :
//   - les DOCUMENTS (ce que chacun est, où il est, qui l'a demandé, qui s'en sert) — déjà tenus par lib/mission-files.js ;
//   - les NOTES de la mission : ce qu'un agent a compris ou fait (fait), ce qui a été décidé et par qui (décision), ce qui manque
//     (manquant), ce qu'on attend d'une personne (question), et à quels agents c'est utile (« for »).
// Chaque agent écrit ce qu'il comprend et fait ; chaque agent LIT, avant de décider, la vue de la mission faite pour lui (missionBrief).
// Rien n'est supprimé : une note réglée est marquée « closed » avec qui et quand.
import { rest } from './supabase.js';
import { currentOrgId } from './firm-context.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile } from './mapping-scan.js';
import { updateMissionRegister } from './mission-register.js';
import { missionMemoryHome, missionMemory, MISSION_MEMORY_FILE } from './mission-files.js';
import { createHash } from 'node:crypto';

const FILE = 'OFFICE_MANAGER_MISSION_FILES.json';
export const AGENTS = ['firm-manager', 'mission-controller', 'enhanced-auditor', 'orpailleur', 'sika'];
export const KINDS = ['fait', 'decision', 'manquant', 'question', 'action'];
const cut = (v, n) => String(v ?? '').slice(0, n);

// What each agent needs to see of the mission (its part of the shared memory): the documents' fields and the notes' kinds.
export const NEEDS = {
  'orpailleur': { docs: ['name', 'title', 'type', 'period', 'location', 'role', 'uses'], kinds: ['fait', 'decision', 'manquant'] },
  'mission-controller': { docs: ['name', 'title', 'type', 'period', 'location', 'role', 'pbc_ref', 'uses', 'summary'], kinds: KINDS },
  'enhanced-auditor': { docs: ['name', 'title', 'type', 'period', 'location', 'role', 'pbc_ref', 'uses', 'summary', 'profile', 'audit_read'], kinds: KINDS },
  'firm-manager': { docs: ['name', 'title', 'type', 'period', 'role'], kinds: ['decision', 'manquant', 'question', 'fait'] },
  'sika': { docs: ['name', 'title', 'type', 'period', 'role', 'summary'], kinds: ['fait', 'decision', 'manquant'] }
};

const noteId = n => createHash('sha256').update([n.agent, n.kind, n.about || '', n.text].join('|')).digest('hex').slice(0, 16);

async function writeNotes(orgId, missionId, change, d = {}) {
  const drive = d.drive || driveAdapter, org = orgId || currentOrgId();
  const apply = list => { const notes = Array.isArray(list) ? [...list] : []; change(notes); return notes.slice(-400); };
  let out = null;
  // central index (across missions)
  const r = await (d.updateJsonFile || updateMissionRegister)(FILE, prev => { const st = prev || { missions: {} }; const m = (st.missions[missionId] ||= { documents: [] }); m.notes = apply(m.notes); m.updated_at = new Date().toISOString(); out = m.notes; return st; },
    { drive, folder: d.folder || memoryFolderId(), orgId: org, fetchRows: d.fetchRows, acquireLease: d.acquireLease });
  // the mission's own folder (the copy that follows the mission)
  try {
    const home = d.missionHome !== undefined ? d.missionHome : await missionMemoryHome({ id: missionId, org_id: org }, d);
    if (home) await (d.updateJsonFile || updateMissionRegister)(MISSION_MEMORY_FILE, prev => ({ ...(prev || {}), mission_id: missionId, notes: mergeNotes(out, prev?.notes), updated_at: new Date().toISOString() }),
      { drive, folder: home, orgId: org, fetchRows: d.fetchRows, acquireLease: d.acquireLease });
  } catch { /* the central copy keeps it */ }
  return { notes: out, file: r?.fileId || null };
}
export function mergeNotes(...lists) {
  const by = new Map();
  for (const l of lists) for (const n of l || []) if (n?.id) { const o = by.get(n.id); by.set(n.id, !o || String(n.updated_at || n.at) >= String(o.updated_at || o.at) ? n : o); }
  return [...by.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// One or several notes from an agent (or a person). The same note twice is kept once.
export async function noteMission(orgId, missionId, notes, d = {}) {
  if (!missionId) return null;
  const list = (Array.isArray(notes) ? notes : [notes]).map(n => ({
    agent: AGENTS.includes(n.agent) ? n.agent : n.agent ? cut(n.agent, 40) : 'personne', kind: KINDS.includes(n.kind) ? n.kind : 'fait', text: cut(n.text, 600), about: n.about ? cut(n.about, 120) : null,
    for: (Array.isArray(n.for) ? n.for : []).filter(a => AGENTS.includes(a)), by: n.by ? cut(n.by, 120) : null, source: n.source ? cut(n.source, 200) : null })).filter(n => n.text);
  if (!list.length) return null;
  const now = new Date().toISOString();
  return writeNotes(orgId, missionId, all => { for (const n of list) { const id = noteId(n), old = all.find(x => x.id === id); if (old) { old.updated_at = now; old.seen = (old.seen || 1) + 1; } else all.push({ id, ...n, status: 'open', at: now }); } }, d);
}
// A question answered, a missing piece received, a decision replaced: closed (never deleted), with who and why.
export async function closeNote(orgId, missionId, id, { by, why } = {}, d = {}) {
  const now = new Date().toISOString();
  return writeNotes(orgId, missionId, all => { const n = all.find(x => x.id === id); if (n && n.status !== 'closed') Object.assign(n, { status: 'closed', closed_by: by || null, closed_why: why ? cut(why, 300) : null, updated_at: now }); }, d);
}

export async function missionNotes(missionId, d = {}) {
  const central = (await loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null }))).state?.missions?.[missionId]?.notes || [];
  let own = [];
  try { const home = d.missionHome !== undefined ? d.missionHome : await missionMemoryHome({ id: missionId, org_id: d.orgId || null }, d); if (home) own = (await loadJsonFile(MISSION_MEMORY_FILE, d.drive || driveAdapter, home)).state?.notes || []; } catch { /* central answers */ }
  return mergeNotes(central, own);
}

// What ONE agent reads of the mission before deciding: the mission itself, its documents (the fields it needs), and the open notes for it
// (plus the latest closed ones, so it knows what was settled).
export async function missionBrief(orgId, missionId, agent, d = {}) {
  const need = NEEDS[agent] || NEEDS['mission-controller'];
  const mission = (await (d.fetchRows || rest)(`office_missions?org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(missionId)}&select=id,name,client_name,engagement_type,period_label,status,planned_start,planned_end&limit=1`).catch(() => []))?.[0] || { id: missionId };
  const docs = await (d.missionMemory || missionMemory)(missionId, { ...d, orgId }).catch(() => []);
  const notes = await (d.missionNotes || missionNotes)(missionId, { ...d, orgId }).catch(() => []);
  const mine = n => !n.for?.length || n.for.includes(agent) || n.agent === agent;
  const validatedMethods = await (await import('./agent-learning-context.js')).localAgentLessons(agent, { ...d, missionId });
  const pick = x => Object.fromEntries(['id', ...need.docs].map(k => [k, k === 'profile' && x.profile ? { family: x.profile.family, what: x.profile.what, period: x.profile.period, corrected_by: x.profile.corrected_by || null } : k === 'uses' ? (x.uses || []).slice(-6).map(u => u.what + (u.where ? ' ' + u.where : '')) : k === 'summary' ? cut(x.summary, 240) || null : x[k] ?? null]));
  return {
    mission: { id: mission.id, name: mission.name || null, client: mission.client_name || null, type: mission.engagement_type || null, period: mission.period_label || null, status: mission.status || null, start: mission.planned_start || null, end: mission.planned_end || null },
    validated_methods: validatedMethods,
    documents: docs.slice(0, 150).map(pick),
    open: notes.filter(n => n.status !== 'closed' && need.kinds.includes(n.kind) && mine(n)).slice(-60).map(n => ({ id: n.id, kind: n.kind, by_agent: n.agent, text: n.text, about: n.about, at: n.at })),
    settled: notes.filter(n => n.status === 'closed' && mine(n)).slice(-15).map(n => ({ kind: n.kind, text: n.text, closed_by: n.closed_by, why: n.closed_why }))
  };
}
