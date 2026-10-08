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

// Small JSON files kept in the agents' memory folder (no database table needed).
export async function loadJsonFile(name, drive = driveAdapter, folder = memoryFolderId()) {
  const found = await drive.findFilesByExactName(name, folder).catch(() => []);
  const f = found?.[0];
  if (!f) return { fileId: null, state: null };
  const buf = await drive.downloadBuffer(f.id);
  // modifiedTime read WITH the content (added 2026-10-08): a writer that passes it back to
  // saveJsonFile gets a real « unchanged since I read it » check (MEMORY_CONFLICT otherwise).
  try { return { fileId: f.id, modifiedTime: f.modifiedTime || null, state: JSON.parse(Buffer.from(buf).toString('utf8')) }; } catch { return { fileId: f.id, modifiedTime: f.modifiedTime || null, state: null }; }
}
// expectedModifiedTime (optional, added): the modifiedTime returned by loadJsonFile. Without it,
// the behaviour stays as before (fresh metadata, last writer wins).
export async function saveJsonFile(name, drive, folder, fileId, state, expectedModifiedTime = null) {
  const buffer = Buffer.from(JSON.stringify(state));
  if (fileId) {
    const meta = expectedModifiedTime ? { modifiedTime: expectedModifiedTime } : await drive.getMeta(fileId);
    await drive.updateBinary(fileId, { buffer, mimeType: 'application/json', expectedModifiedTime: meta?.modifiedTime });
    return fileId;
  }
  const c = await drive.createBinary({ name, parentId: folder, buffer, mimeType: 'application/json' });
  return c?.id || null;
}

// Read → change → write with a real conflict check, retried (up to 3 times) when someone else
// wrote the file in between. mutate(state) returns the new state (or null: nothing to write).
export async function updateJsonFile(name, mutate, { drive = driveAdapter, folder = memoryFolderId(), retries = 3 } = {}) {
  let lastError = null;
  for (let i = 0; i < retries; i++) {
    const { fileId, modifiedTime, state } = await loadJsonFile(name, drive, folder);
    const next = await mutate(state ? structuredClone(state) : null);
    if (next == null) return { fileId, state, written: false };
    try {
      const id = await saveJsonFile(name, drive, folder, fileId, next, fileId ? modifiedTime : null);
      return { fileId: id, state: next, written: true };
    } catch (e) {
      lastError = e;
      if (!/MEMORY_CONFLICT|FILE_ALREADY_EXISTS/.test(String(e.message || e))) throw e;
    }
  }
  throw lastError || new Error('MEMORY_CONFLICT');
}

export async function loadScan(drive = driveAdapter, folder = memoryFolderId()) {
  return loadJsonFile(STATE_NAME, drive, folder);
}

async function saveScan(drive, folder, fileId, state) {
  return saveJsonFile(STATE_NAME, drive, folder, fileId, state);
}


const publicView = s => s ? ({
  status: s.status, started_at: s.started_at, updated_at: s.updated_at, finished_at: s.finished_at || null,
  folders_left: s.queue?.length || 0, files_seen: s.items?.filter(i => i.mimeType !== FOLDER).length || 0,
  folders_seen: s.items?.filter(i => i.mimeType === FOLDER).length || 0, current: s.current || null,
  errors: (s.errors || []).slice(-5), summary: s.summary || null, delta: s.delta || null
}) : null;

export async function scanStatus(d = {}) {
  const { state } = await loadScan(d.drive, d.folder);
  return publicView(state);
}

export async function startScan(orgId, req, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  if (!folder) throw Object.assign(new Error('DRIVE_NOT_CHOSEN'), { statusCode: 409 });
  const { fileId, state: old } = await loadScan(drive, folder);
  // A walk in progress is never restarted: it continues where it stopped (« il s'est arrêté en route »).
  if (old?.status === 'walking' && (old.queue || []).length) {
    old.updated_at = new Date().toISOString();
    await saveScan(drive, folder, fileId, old);
    await (d.fire || fireInternal)(req, '/api/app?route=mapping-step', {});
    return { already_running: true, resumed: true, ...publicView(old) };
  }
  const now = new Date().toISOString();
  // Its memory: what it saw last time (id → date of modification), to tell what is new or changed.
  const previous = old?.items?.length ? { at: old.finished_at || old.updated_at || null, seen: Object.fromEntries(old.items.filter(i => i.mimeType !== FOLDER).map(i => [i.id, i.modifiedTime || ''])) } : (old?.previous || null);
  const state = { status: 'walking', org: orgId, started_at: now, updated_at: now, queue: [rootOf()], items: [], errors: [], previous };
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
  // Walk finished. Compared with its memory: what is new, modified, gone since the last mapping.
  if (state.previous?.seen) {
    const prevSeen = state.previous.seen, now2 = new Set();
    let added = 0, modified = 0;
    for (const i of state.items) { if (i.mimeType === FOLDER) continue; now2.add(i.id); if (!(i.id in prevSeen)) added++; else if (String(i.modifiedTime || '') > String(prevSeen[i.id] || '')) modified++; }
    state.delta = { since: state.previous.at, added, modified, gone: Object.keys(prevSeen).filter(id => !now2.has(id)).length };
    delete state.previous;
  }
  // The Orpailleur's mapping pass on the complete listing.
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
    // Then the Orpailleur learns the firm (team, clients, missions) from what it found.
    await (d.fire || fireInternal)(req, '/api/app?route=firm-learn', {}).catch(() => null);
  } catch (e) {
    state.status = 'failed'; state.errors.push({ path: 'mapping', error: String(e.message || e).slice(0, 200) });
  }
  state.finished_at = state.updated_at = new Date().toISOString();
  await saveScan(drive, folder, fileId, state);
  return publicView(state);
}
