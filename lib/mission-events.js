import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadScan } from './mapping-scan.js';
import { NOT_ARCHIVED_FILTER } from './mission-status.js';
import { dispatch } from './event-bus.js';

// MISSION CONTROLLER RECEIVES THE ORPAILLEUR'S EVENTS (architecture §15 « Route A », §34, §57).
//   DOCUMENT_CLASSIFIED  — a file was filed AND verified in Drive: the Mission Controller finds the
//     mission it belongs to (the mission's Drive folder, or one of its parents), attaches it to the
//     mission's documentary memory with its PBC reference and role, and gives it a PBC status.
//     « A received file does not automatically mean a PBC item is complete »: EXACT/COMPONENT/SUPPORT
//     → RECEIVED_REVIEW_REQUIRED, PARTIEL → PARTIAL, no PBC reference → UNMATCHED. The checklist
//     itself is updated by the PBC Service (next brick), never silently here.
//   NEEDS_HUMAN_CLASSIFICATION — a mission document waits for a person's answer: noted as pending.
//   POSSIBLE_DUPLICATE — nothing was created: noted as an open item to review.
// Not sure of the mission → nothing is attached (the event says why; the file stays listed for review).

const q = encodeURIComponent;
const FOLDER = 'application/vnd.google-apps.folder';
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function pbcStatusFor(role, ref) {
  if (!ref) return 'UNMATCHED';
  return String(role || '').toUpperCase() === 'PARTIEL' ? 'PARTIAL' : 'RECEIVED_REVIEW_REQUIRED';
}

// The folder and all its parents (from the Drive map), nearest first.
export function ancestorsOf(folderId, items) {
  const byId = new Map((items || []).map(i => [i.id, i]));
  const out = [];
  let cur = folderId;
  for (let i = 0; cur && i < 30 && !out.includes(cur); i++) { out.push(cur); cur = (byId.get(cur)?.parents || [])[0] || null; }
  return out;
}

// The mission a folder belongs to: its own folder (index drive_folder_id) or a parent's; else, when
// the folder's path names exactly one mission (all the words of its client and its year), that one.
export function missionForFolder(folderId, folderPath, missions, items) {
  const chain = ancestorsOf(folderId, items);
  const byFolder = missions.filter(m => m.drive_folder_id && chain.includes(m.drive_folder_id));
  if (byFolder.length) return { mission: byFolder.sort((a, b) => chain.indexOf(a.drive_folder_id) - chain.indexOf(b.drive_folder_id))[0], how: 'dossier de la mission' };
  const path = ' ' + norm(folderPath) + ' ';
  const hits = missions.filter(m => {
    const words = norm(m.client_name || m.name).split(' ').filter(w => w.length > 2 && !['audit', 'mission', 'cac', 'sarl'].includes(w));
    const years = String(m.name || '').match(/(?:19|20)\d\d/g) || [];
    return words.length && words.every(w => path.includes(' ' + w + ' ')) && (!years.length || years.some(y => path.includes(y)));
  });
  return hits.length === 1 ? { mission: hits[0], how: 'chemin du dossier' } : { mission: null, candidates: hits.map(m => m.name).slice(0, 5) };
}

export async function handleMissionEvents(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  let ctx = null;
  const context = async () => ctx || (ctx = {
    missions: await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&' + NOT_ARCHIVED_FILTER + '&select=id,name,client_name,drive_folder_id,status&limit=500').catch(() => []) || [],
    items: ((await (d.loadScan || loadScan)(drive, folder).catch(() => ({ state: null }))).state?.items || []).filter(i => i.mimeType === FOLDER)
  });
  const remember = d.writeAgentMemory || (await import('./agent-memory.js')).writeAgentMemory;
  const record = d.recordMissionDocuments || (await import('./mission-files.js')).recordMissionDocuments;
  const setEngagement = (id, missionId) => fetchRows('office_events?org_id=eq.' + q(orgId) + '&id=eq.' + q(id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ engagement_id: missionId }) }).catch(() => null);

  return dispatch(orgId, 'mission-controller', {
    async DOCUMENT_CLASSIFIED(ev) {
      const p = ev.small_payload || {};
      const { missions, items } = await context();
      const found = ev.engagement_id ? { mission: missions.find(m => m.id === ev.engagement_id), how: 'indiqué' } : missionForFolder(p.folder_id, p.folder_path, missions, items);
      if (!found.mission) {
        await remember('mission-controller', m => { m.open_items = [...(m.open_items || []), { ref: 'file:' + ev.object_id, label: 'Document classé sans mission identifiée : « ' + (p.name || ev.object_id) + ' » (' + (p.folder_path || '') + ')' + (found.candidates?.length ? ' — candidates : ' + found.candidates.join(', ') : ''), since: ev.occurred_at }]; return m; }, d).catch(() => null);
        return { ignore: 'mission non identifiée' + (found.candidates?.length ? ' (plusieurs possibles : ' + found.candidates.join(', ') + ')' : '') + ' — noté pour revue' };
      }
      const status = pbcStatusFor(p.pbc_role, p.pbc_ref);
      await record(found.mission, [{ id: ev.object_id, name: p.name, path: p.folder_path ? p.folder_path + '/' + p.name : null, url: p.url || null, type: p.doc_type || null,
        role: p.pbc_ref ? 'piece_pbc' : 'autre', period: p.period || null, summary: p.summary || null, by: 'Orpailleur', source: 'orpailleur', event_id: ev.id,
        pbc_ref: p.pbc_ref || null, pbc_role: p.pbc_role || null, pbc_status: status, read_method: p.read_method || null, confidence: p.confidence || null }], { drive, folder });
      await setEngagement(ev.id, found.mission.id);
      return 'rattaché à « ' + found.mission.name + ' » (' + found.how + ')' + (p.pbc_ref ? ', ' + p.pbc_ref + ' → ' + status : ', sans référence PBC');
    },
    async NEEDS_HUMAN_CLASSIFICATION(ev) {
      const p = ev.small_payload || {};
      await remember('mission-controller', m => { m.pending = [...(m.pending || []).filter(x => x.ref !== 'file:' + ev.object_id), { ref: 'file:' + ev.object_id, label: 'Document en attente d’une réponse (Orpailleur) : « ' + (p.name || '') + ' » — manque : ' + (p.missing || '?'), waiting_for: p.asked || 'une personne du cabinet' }]; return m; }, d);
      return 'noté en attente (question à ' + (p.asked || '?') + ')';
    },
    async POSSIBLE_DUPLICATE(ev) {
      const p = ev.small_payload || {};
      await remember('mission-controller', m => { m.open_items = [...(m.open_items || []).filter(x => x.ref !== 'dup:' + ev.object_id), { ref: 'dup:' + ev.object_id, label: 'POSSIBLE DUPLICATE — REVIEW REQUIRED : « ' + (p.name || '') + ' » — ' + (p.why || ''), since: ev.occurred_at }]; return m; }, d);
      return 'doublon possible noté pour revue';
    }
  }, d);
}
