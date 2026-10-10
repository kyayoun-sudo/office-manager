import { acquireReaderLease, acquireOfflineReaderLease } from './inspection-runtime.js';
import { firmDriveId } from './google-connection.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { tidyDrive } from './tidy-drive.js';

// Each agent's own memory (2026-10-08, extension « mémoire »). ADDED next to what exists:
//   <dossier mémoire 00_OFFICE_MANAGER>/MEMORY/AGENTS/<AGENT>_MEMORY.json
// One writer per file: only the agent itself (through these functions) — or the owner's
// recovery (rebuildAgentMemory), clearly marked. The existing files stay where they are and stay
// the source of truth for what they hold (TIDY_STATE, REGISTER, MAP, the 3 central JSON files…):
// this memory only POINTS to them (sources) and keeps the agent's own state between passes:
// last attempt, last success, checkpoint, heartbeat, last error, retries, what is pending.
// Never the model's internal reasoning, never the content of client documents.

export const AGENT_FILES = Object.freeze({
  orpailleur: 'OFFICE_MANAGER_TIDY_STATE.json (agent_memory)',
  'mission-controller': 'MISSION_CONTROLLER_MEMORY.json',
  'grand-controleur': 'GRAND_CONTROLEUR_MEMORY.json',
  'enhanced-auditor': 'ENHANCED_AUDITOR_MEMORY.json',
  sika: 'SIKA_MEMORY.json'
});

// Where each agent's detailed knowledge already lives (unchanged, read by the agent).
export const AGENT_SOURCES = Object.freeze({
  orpailleur: [
    { file: 'OFFICE_MANAGER_TIDY_STATE.json', role: 'Point de reprise des passages (last_pass_at) et passage en cours' },
    { file: 'OFFICE_MANAGER_REGISTER.xlsx', role: 'Registre des fichiers lus, rangés et renommés' },
    { file: 'OFFICE_MANAGER_MAP.xlsx', role: 'Cartographie validée du Drive et règles de rangement' },
    { file: 'OFFICE_MANAGER_SCAN_STATE.json', role: 'Premier scan complet du Drive' },
    { file: 'OFFICE_MANAGER_MISSION_FILES.json', role: 'Fichiers rattachés à chaque mission (fichier central, laissé tel quel)' },
    { file: 'OFFICE_MANAGER_DEPOSITS.json', role: 'Dépôts de la page Rangement et leur analyse' }
  ],
  'mission-controller': [
    { file: 'OFFICE_MANAGER_ENGAGEMENTS.json', role: 'Préparations de mission (TDR, recherche, compétences, briefing des risques) — fichier central, laissé tel quel' },
    { file: 'OFFICE_MANAGER_CAPABILITIES.json', role: 'Base des compétences du cabinet' },
    { file: 'OFFICE_MANAGER_CAPABILITY_GAPS.json', role: 'Écarts de compétences constatés' },
    { file: 'OFFICE_MANAGER_SUBMISSIONS.json', role: 'Suivi des soumissions et des retards' },
    { file: '<dossier permanent du client>/00_OFFICE_MANAGER/CLIENT_MEMORY.json', role: 'Mémoire permanente de chaque client : partie permanente + une partie par mission (tu en es le seul écrivain)' }
  ],
  'grand-controleur': [
    { file: 'OFFICE_MANAGER_FIRM_KNOWLEDGE.json', role: 'Connaissance du cabinet (missions, équipe, documents)' },
    { file: 'OFFICE_MANAGER_MISSION_FILES.json', role: 'Fichiers rattachés à chaque mission (fichier central, laissé tel quel)' },
    { file: 'OFFICE_MANAGER_ENGAGEMENTS.json', role: 'Évaluation des risques de préparation (fichier central, laissé tel quel)' },
    { file: '<dossier permanent du client>/00_OFFICE_MANAGER/CLIENT_MEMORY.json', role: 'Mémoire permanente du client et de chacune de ses missions' }
  ],
  'enhanced-auditor': [
    { file: 'OFFICE_MANAGER_ENHANCED_AUDITOR.json', role: 'Revues : risques, couverture, preuves, images, schémas (fichier central, laissé tel quel)' },
    { file: 'OFFICE_MANAGER_AUDITOR_WORK.json', role: 'Points du soir, retours d’expérience des anciennes missions, revues de working papers, vue associé' },
    { file: 'OFFICE_MANAGER_ENGAGEMENTS.json', role: 'Évaluation des risques du Grand Contrôleur' },
    { file: '<dossier permanent du client>/00_OFFICE_MANAGER/CLIENT_MEMORY.json', role: 'Mémoire permanente du client et de la mission revue' }
  ],
  sika: [
    { file: 'OFFICE_MANAGER_FIRM_KNOWLEDGE.json', role: 'Connaissance du cabinet' },
    { file: 'office_action_queue (Supabase)', role: 'Relances et actions administratives proposées / validées' }
  ]
});

const AGENTS = Object.keys(AGENT_FILES);
const MAX_LIST = 40;
const cut = (s, n = 300) => s == null ? null : String(s).slice(0, n);
const nowIso = d => (d.now ? d.now() : new Date()).toISOString();
export const RECOVERY_WRITER = 'admin-recovery';

export function emptyMemory(agent) {
  return {
    schema: 'office-manager.agent-memory/1', agent, writer: agent,
    status: 'idle',                     // idle | running | failed | stale
    last_attempted_at: null, last_successful_at: null, heartbeat_at: null,
    checkpoint: null,                   // advances ONLY on a successful pass
    last_error: null, retry_count: 0,
    active_missions: [],                // [{ id, name, status }]
    open_items: [],                     // anomalies / open actions [{ ref, label, since }]
    pending: [],                        // waiting for someone [{ ref, label, waiting_for }]
    next_pass_notes: [],                // what to look at next time [{ at, note }]
    sources: AGENT_SOURCES[agent] || [],
    history: [],                        // last passes [{ at, ok, ref, error }]
    updated_at: null
  };
}

// AGENTS inside the memory folder (MEMORY): found, or created once. If Drive refuses the creation
// (read-only bridge, test Drive), the memory folder itself is used: nothing breaks.
let folderCache = { key: null, id: null };
export async function agentMemoryFolder(d = {}) {
  const root = d.folder || memoryFolderId();
  if (!root) throw new Error('MEMORY_FOLDER_NOT_CONFIGURED');
  if (folderCache.key === root && folderCache.id) return folderCache.id;
  const td = d.tidyDrive || tidyDrive;
  let id = root;
  try {
    // The memory folder IS « MEMORY » (00_TATY_AI_MANAGER/MEMORY): the agents' files go in its AGENTS.
    id = (await td.findOrCreateFolder(root, 'AGENTS')).id;
  } catch { id = root; }
  folderCache = { key: root, id };
  return id;
}
export function resetAgentMemoryFolderCache() { folderCache = { key: null, id: null }; }

function check(agent) {
  if (!AGENTS.includes(agent)) throw Object.assign(new Error('UNKNOWN_AGENT_MEMORY'), { statusCode: 400 });
}

// The Orpailleur has NO extra file (Paul, 2026-10-08: « TIDY, REGISTER et MAP font ça, il ne crée pas
// de nouveaux fichiers ») : its follow-up lives inside its own OFFICE_MANAGER_TIDY_STATE.json (key agent_memory).
export const IN_OWN_FILE = Object.freeze({ orpailleur: 'OFFICE_MANAGER_TIDY_STATE.json' });

export async function loadAgentMemory(agent, d = {}) {
  check(agent);
  const drive = d.drive || driveAdapter;
  if (IN_OWN_FILE[agent]) {
    const folder = d.folder || memoryFolderId();
    const { fileId, modifiedTime, state } = await loadJsonFile(IN_OWN_FILE[agent], drive, folder);
    const m = state?.agent_memory;
    return { fileId, modifiedTime, folder, host: state || {}, memory: m ? { ...emptyMemory(agent), ...m, sources: AGENT_SOURCES[agent] || [] } : emptyMemory(agent) };
  }
  const folder = await agentMemoryFolder(d);
  const { fileId, modifiedTime, state } = await loadJsonFile(AGENT_FILES[agent], drive, folder);
  return { fileId, modifiedTime, folder, memory: state ? { ...emptyMemory(agent), ...state, sources: AGENT_SOURCES[agent] || [] } : emptyMemory(agent) };
}

// The single write path. writer must be the agent itself (or the owner's recovery).
// Real « unchanged since read » check, retried when two invocations of the same agent collide.
export async function writeAgentMemory(agent, mutate, d = {}) {
  if (!IN_OWN_FILE[agent]) return writeAgentMemoryLocked(agent, mutate, d);
  const orgId = d.orgId || process.env.DEFAULT_ORG_ID;
  const scope = { organization_id: orgId, drive_id: d.driveId !== undefined ? d.driveId : firmDriveId(), memory_folder_id: d.folder || memoryFolderId() };
  const lease = d.readerLease ? await d.readerLease(scope) : d.drive ? acquireOfflineReaderLease(scope) : await acquireReaderLease(orgId, scope, { ...(d.fetchRows ? { fetchRows: d.fetchRows } : {}) });
  if (!lease) throw new Error('READER_BUSY: suivi mémoire différé pendant le rangement');
  try { return await writeAgentMemoryLocked(agent, mutate, d); }
  finally { await lease.release(); }
}
async function writeAgentMemoryLocked(agent, mutate, d = {}) {
  check(agent);
  const writer = d.writer || agent;
  if (writer !== agent && writer !== RECOVERY_WRITER) throw Object.assign(new Error('SINGLE_WRITER: ' + writer + ' ne peut pas écrire la mémoire de ' + agent), { statusCode: 403 });
  const drive = d.drive || driveAdapter;
  let last = null;
  for (let i = 0; i < 3; i++) {
    const { fileId, modifiedTime, folder, memory, host } = await loadAgentMemory(agent, d);
    const next = mutate(structuredClone(memory)) || memory;
    next.agent = agent; next.writer = writer; next.updated_at = nowIso(d);
    for (const k of ['active_missions', 'open_items', 'pending', 'next_pass_notes', 'history']) next[k] = (next[k] || []).slice(-MAX_LIST);
    const { sources, ...kept } = next;
    try {
      if (IN_OWN_FILE[agent]) await saveJsonFile(IN_OWN_FILE[agent], drive, folder, fileId, { ...(host || {}), agent_memory: kept }, fileId ? modifiedTime : null);
      else await saveJsonFile(AGENT_FILES[agent], drive, folder, fileId, next, fileId ? modifiedTime : null);
      return next;
    } catch (e) {
      last = e;
      if (!/MEMORY_CONFLICT|FILE_ALREADY_EXISTS/.test(String(e.message || e))) throw e;
    }
  }
  throw last;
}

// Never lets a memory problem break the agent's real work.
async function safe(fn) { try { return await fn(); } catch (e) { return { memory_error: cut(e.message || e, 200) }; } }

export function beginPass(agent, info = {}, d = {}) {
  return safe(() => writeAgentMemory(agent, m => {
    const at = nowIso(d);
    m.status = 'running'; m.last_attempted_at = at; m.heartbeat_at = at;
    m.current = { started_at: at, ref: cut(info.ref, 120), label: cut(info.label, 200) };
    return m;
  }, d));
}

export function heartbeat(agent, d = {}) {
  return safe(() => writeAgentMemory(agent, m => { m.heartbeat_at = nowIso(d); return m; }, d));
}

// ok: the pass really succeeded → last_successful_at and checkpoint advance. Otherwise the
// checkpoint stays where it was (the next pass starts again from the last success).
export function endPass(agent, result = {}, d = {}) {
  return safe(() => writeAgentMemory(agent, m => {
    const at = nowIso(d);
    m.heartbeat_at = at; m.current = null;
    if (result.ok) {
      m.status = 'idle'; m.last_successful_at = result.at || at; m.last_error = null; m.retry_count = 0;
      if (result.checkpoint !== undefined) m.checkpoint = result.checkpoint;
    } else {
      m.status = 'failed'; m.last_error = cut(result.error || 'échec sans détail'); m.retry_count = (m.retry_count || 0) + 1;
    }
    if (Array.isArray(result.active_missions)) m.active_missions = result.active_missions.map(x => ({ id: x.id, name: cut(x.name, 160), status: x.status || null }));
    if (Array.isArray(result.open_items)) m.open_items = result.open_items;
    if (Array.isArray(result.pending)) m.pending = result.pending;
    if (result.note) m.next_pass_notes = [...(m.next_pass_notes || []), { at, note: cut(result.note, 500) }];
    m.history = [...(m.history || []), { at, ok: Boolean(result.ok), ref: cut(result.ref, 120), error: result.ok ? null : cut(result.error, 200) }];
    return m;
  }, d));
}

export function noteForNextPass(agent, note, d = {}) {
  return safe(() => writeAgentMemory(agent, m => { m.next_pass_notes = [...(m.next_pass_notes || []), { at: nowIso(d), note: cut(note, 500) }]; return m; }, d));
}

// A running pass whose heartbeat is older than staleMinutes is « stale » (crash, time-out):
// no pass stays « running » forever.
export function isStale(memory, staleMinutes = 15, now = new Date()) {
  if (!memory || memory.status !== 'running') return false;
  const hb = Date.parse(memory.heartbeat_at || memory.last_attempted_at || 0);
  return !hb || now.getTime() - hb > staleMinutes * 60000;
}

// Owner recovery: the file is unreadable, lost, or wrong. Drive keeps the file's previous
// versions (Fichier › Historique des versions) — and this rebuilds the state from the sources
// of truth (successful passes in Supabase, Orpailleur's TIDY_STATE), marked as a recovery.
export async function rebuildAgentMemory(orgId, agent, by, d = {}) {
  check(agent);
  const fetchRows = d.fetchRows;
  const passKey = agent === 'mission-controller' || agent === 'enhanced-auditor' ? null : agent;
  let lastOk = null, lastTry = null;
  if (passKey && fetchRows) {
    const q = encodeURIComponent;
    lastOk = (await fetchRows('office_agent_passes?org_id=eq.' + q(orgId) + '&agent_key=eq.' + q(passKey) + '&status=eq.done&select=slot,finished_at&order=started_at.desc&limit=1').catch(() => []))?.[0] || null;
    lastTry = (await fetchRows('office_agent_passes?org_id=eq.' + q(orgId) + '&agent_key=eq.' + q(passKey) + '&select=slot,started_at&order=started_at.desc&limit=1').catch(() => []))?.[0] || null;
  }
  let checkpoint = null;
  if (agent === 'orpailleur') {
    const { state } = await loadJsonFile('OFFICE_MANAGER_TIDY_STATE.json', d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null }));
    checkpoint = state?.last_pass_at ? { last_pass_at: state.last_pass_at, source: 'OFFICE_MANAGER_TIDY_STATE.json' } : null;
  }
  return writeAgentMemory(agent, () => {
    const m = emptyMemory(agent);
    m.last_successful_at = lastOk?.finished_at || null;
    m.last_attempted_at = lastTry?.started_at || null;
    m.checkpoint = checkpoint;
    m.recovered_at = nowIso(d); m.recovered_by = cut(by, 120);
    m.history = [{ at: m.recovered_at, ok: true, ref: 'reconstruction', error: null }];
    return m;
  }, { ...d, writer: RECOVERY_WRITER });
}

// Short text given to the agent at the start of its work (where its memories are, where it stopped).
export function memorySummary(agent, memory) {
  const m = memory || emptyMemory(agent);
  const lines = ['TA MÉMOIRE (' + AGENT_FILES[agent] + ', dossier MEMORY/AGENTS de 00_OFFICE_MANAGER) :'];
  lines.push('- Dernier passage réussi : ' + (m.last_successful_at || 'aucun') + ' ; dernière tentative : ' + (m.last_attempted_at || 'aucune') +
    (m.status === 'failed' ? ' (ÉCHEC : ' + (m.last_error || '?') + ', ' + m.retry_count + ' essai(s))' : ''));
  if (m.checkpoint) lines.push('- Point de reprise : ' + JSON.stringify(m.checkpoint).slice(0, 200));
  if ((m.next_pass_notes || []).length) lines.push('- À regarder ce passage : ' + m.next_pass_notes.slice(-5).map(n => n.note).join(' | '));
  if ((m.pending || []).length) lines.push('- En attente : ' + m.pending.slice(-8).map(p => p.label).join(' | '));
  if ((m.open_items || []).length) lines.push('- Points ouverts : ' + m.open_items.slice(-8).map(p => p.label).join(' | '));
  lines.push('- Tes sources détaillées (à lire, ne pas recopier) : ' + (AGENT_SOURCES[agent] || []).map(s => s.file).join(', ') + '.');
  return lines.join('\n');
}
