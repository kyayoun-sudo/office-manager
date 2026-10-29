import { createHash } from 'node:crypto';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile } from './mapping-scan.js';
import { updateMissionRegister } from './mission-register.js';
import { missionMemoryHome, MISSION_MEMORY_FILE, mergeDocuments } from './mission-files.js';

const CENTRAL_FILE = 'OFFICE_MANAGER_MISSION_FILES.json';
const q = encodeURIComponent;
const canonicalDocuments = docs => (docs || []).map(doc => {
  const copy = { ...doc };
  // mergeDocuments() materialises empty history/use arrays when the same document exists
  // in both registers. They carry no knowledge, so they must not turn an unchanged
  // mission memory into a permanent rewrite loop.
  if (!copy.uses?.length) delete copy.uses;
  if (!copy.history?.length) delete copy.history;
  return copy;
});
const digest = docs => createHash('sha256').update(JSON.stringify(canonicalDocuments(docs))).digest('hex');

async function missionRows(orgId, ids, fetchRows) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    if (!batch.length) continue;
    const rows = await fetchRows(
      'office_missions?org_id=eq.' + q(orgId) +
      '&id=in.(' + batch.map(q).join(',') + ')' +
      '&select=id,name,drive_folder_id,org_id&limit=100'
    );
    out.push(...(rows || []));
  }
  return out;
}

// The central mission register is the cross-mission index; each mission must also
// carry the same document knowledge in <mission>/_OFFICE_MANAGER/OFFICE_MANAGER_MISSION_MEMORY.json.
// This copies METADATA ONLY. It never re-reads client files and preserves local notes/history.
export async function reconcileMissionMemoryCopies(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const drive = d.drive || driveAdapter;
  const folder = d.folder || memoryFolderId();
  const load = d.loadJsonFile || loadJsonFile;
  const centralState = d.central !== undefined
    ? d.central
    : (await load(CENTRAL_FILE, drive, folder).catch(() => ({ state: null }))).state;
  const entries = Object.entries(centralState?.missions || {}).filter(([, value]) => (value?.documents || []).length);
  if (!entries.length) return { status: 'ok', missions: 0, synced: 0, unchanged: 0, documents: 0, errors: [] };

  const rows = await missionRows(orgId, entries.map(([id]) => id), fetchRows);
  const byId = new Map(rows.map(row => [row.id, row]));
  let synced = 0, unchanged = 0, documents = 0;
  const errors = [];

  for (const [missionId, value] of entries) {
    const mission = byId.get(missionId);
    if (!mission?.drive_folder_id) {
      errors.push({ mission_id: missionId, error: 'MISSION_DRIVE_FOLDER_UNKNOWN' });
      continue;
    }
    try {
      const home = await (d.missionMemoryHome || missionMemoryHome)(mission, { ...d, drive, fetchRows });
      if (!home) throw new Error('MISSION_MEMORY_FOLDER_UNKNOWN');
      const localState = (await load(MISSION_MEMORY_FILE, drive, home).catch(() => ({ state: null }))).state || {};
      const localDocs = localState.documents || [];
      const merged = mergeDocuments(localDocs, value.documents || []);
      documents += merged.length;
      if (digest(localDocs) === digest(merged)) {
        unchanged += 1;
        continue;
      }
      await (d.updateJsonFile || updateMissionRegister)(MISSION_MEMORY_FILE, previous => ({
        ...(previous || {}),
        mission_id: missionId,
        name: mission.name || value.name || previous?.name || null,
        documents: mergeDocuments(previous?.documents || [], value.documents || []),
        updated_at: new Date().toISOString()
      }), { drive, folder: home, orgId, fetchRows, acquireLease: d.acquireLease });
      synced += 1;
    } catch (error) {
      errors.push({ mission_id: missionId, error: String(error?.message || error) });
    }
  }

  return {
    status: errors.length ? (synced || unchanged ? 'partial' : 'failed') : 'ok',
    missions: entries.length,
    synced,
    unchanged,
    documents,
    errors
  };
}
