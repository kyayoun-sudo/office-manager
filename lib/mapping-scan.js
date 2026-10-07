import { driveAdapter } from './drive-adapter.js';
import { listDriveChildren, ALL_DRIVES_ROOT } from './google-drive.js';
import { firmDriveKind, firmDriveId } from './google-connection.js';
import { memoryFolderId } from './memory-runtime.js';
import { runMappingPass } from './orpailleur-memory.js';
import { fireInternal } from './agent-passes.js';

// Drive mapping that survives Vercel's time limit (2026-10-07, Paul: « je n'arrive pas à lancer
// la cartographie »). A whole Google Drive cannot be walked in one 300 s call, so the walk runs in
// short steps (~40 s each), each one saving where it is in a JSON file of the agents' memory
// folder, then calling the next step. When the walk is complete, the Orpailleur's mapping pass
// runs on the full listing (memory files OFFICE_MANAGER_MAP / REGISTER written, business files
// only read). Mise en service shows the progress.

const STATE_NAME = 'OFFICE_MANAGER_SCAN_STATE.json';
const FOLDER = 'application/vnd.google-apps.folder';
const STEP_MS = 40000;
const MAX_ITEMS = 50000;

function rootOf() {
  if (firmDriveKind() === 'all') return { id: ALL_DRIVES_ROOT, path: '', driveId: undefined };
  return { id: firmDriveId(), path: '', driveId: undefined };
}

export async function loadScan(drive = driveAdapter, folder = memoryFolderId()) {
  const found = await drive.findFilesByExactName(STATE_NAME, folder).catch(() => []);
  const f = found?.[0];
  if (!f) return { fileId: null, state: null };
  const buf = await drive.downloadBuffer(f.id);
  try { return { fileId: f.id, state: JSON.parse(Buffer.from(buf).toString('utf8')) }; } catch { return { fileId: f.id, state: null }; }
}

async function saveScan(drive, folder, fileId, state) {
  const buffer = Buffer.from(JSON.stringify(state));
  if (fileId) {
    // The Drive update needs the file's current version (protection against overwriting).
    const meta = await drive.getMeta(fileId);
    await drive.updateBinary(fileId, { buffer, mimeType: 'application/json', expectedModifiedTime: meta?.modifiedTime });
    return fileId;
  }
  const c = await drive.createBinary({ name: STATE_NAME, parentId: folder, buffer, mimeType: 'application/json' });
  return c?.id || null;
}

const publicView = s => s ? ({
  status: s.status, started_at: s.started_at, updated_at: s.updated_at, finished_at: s.finished_at || null,
  folders_left: s.queue?.length || 0, files_seen: s.items?.filter(i => i.mimeType !== FOLDER).length || 0,
  folders_seen: s.items?.filter(i => i.mimeType === FOLDER).length || 0, current: s.current || null,
  errors: (s.errors || []).slice(-5), summary: s.summary || null
}) : null;

export async function scanStatus(d = {}) {
  const { state } = await loadScan(d.drive, d.folder);
  return publicView(state);
}

export async function startScan(orgId, req, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  if (!folder) throw Object.assign(new Error('DRIVE_NOT_CHOSEN'), { statusCode: 409 });
  const { fileId, state: old } = await loadScan(drive, folder);
  // A walk in progress (updated in the last 3 minutes) is not restarted: it is only nudged.
  if (old?.status === 'walking' && Date.now() - Date.parse(old.updated_at || 0) < 180000) {
    await (d.fire || fireInternal)(req, '/api/app?route=mapping-step', {});
    return { already_running: true, ...publicView(old) };
  }
  const now = new Date().toISOString();
  const state = { status: 'walking', org: orgId, started_at: now, updated_at: now, queue: [rootOf()], items: [], errors: [] };
  await saveScan(drive, folder, fileId, state);
  await (d.fire || fireInternal)(req, '/api/app?route=mapping-step', {});
  return { started: true, ...publicView(state) };
}

export async function scanStep(orgId, req, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const list = d.list || listDriveChildren;
  const budget = d.budgetMs ?? STEP_MS, t0 = Date.now();
  const { fileId, state } = await loadScan(drive, folder);
  if (!state || state.status !== 'walking') return publicView(state);
  while (state.queue.length && Date.now() - t0 < budget && state.items.length < MAX_ITEMS) {
    const node = state.queue.shift();
    state.current = node.path || '/';
    let children = [];
    try { children = await list(node.id, node.driveId === undefined ? {} : { driveId: node.driveId }); }
    catch (e) { state.errors.push({ path: node.path || '/', error: String(e.message || e).slice(0, 120) }); continue; }
    for (const c of children) {
      if (c.name === STATE_NAME) continue;
      const path = (node.path || '') + '/' + c.name;
      const driveId = c.driveId !== undefined ? c.driveId : node.driveId;
      state.items.push({ id: c.id, name: c.name, mimeType: c.mimeType, parents: c.parents?.length ? c.parents : [node.id],
        modifiedTime: c.modifiedTime || '', size: c.size || '', webViewLink: c.webViewLink || '', md5Checksum: c.md5Checksum || '', path });
      if (c.mimeType === FOLDER) state.queue.push({ id: c.id, path, driveId });
    }
  }
  state.updated_at = new Date().toISOString();
  if (state.queue.length && state.items.length < MAX_ITEMS) {
    await saveScan(drive, folder, fileId, state);
    await (d.fire || fireInternal)(req, '/api/app?route=mapping-step', {});
    return publicView(state);
  }
  // Walk finished: the Orpailleur's mapping pass on the complete listing.
  state.status = 'mapping'; state.current = null;
  await saveScan(drive, folder, fileId, state);
  try {
    const items = state.items.filter(i => i.id !== ALL_DRIVES_ROOT);
    const { summary } = await (d.runPass || runMappingPass)(drive, {
      memoryFolderId: folder, rootFolderId: rootOf().id,
      listing: { source: 'DRIVE_WALK', items, complete: !state.queue.length && !state.errors.length },
      maxReads: d.maxReads ?? 10, org: orgId
    });
    state.summary = summary; state.status = 'done';
  } catch (e) {
    state.status = 'failed'; state.errors.push({ path: 'mapping', error: String(e.message || e).slice(0, 200) });
  }
  state.finished_at = state.updated_at = new Date().toISOString();
  await saveScan(drive, folder, fileId, state);
  return publicView(state);
}
