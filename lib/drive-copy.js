import { googleAccessToken, directGoogleAccess, assertWritableTarget, trustCreatedChild } from './google-drive.js';

// Identical copy of the firm's Shared Drive into a TEST Shared Drive (test run "TATY TEST",
// 2026-10-07). Read-only on the source; writes only in the target.
//
//  - folders are re-created, files copied with files.copy (same name, same place);
//  - not copied: the Orpailleur's two memory files (the test Orpailleur must discover the
//    copy as a new firm), the training folders, temporary files, shortcuts;
//  - every write goes through the test-mode write guard (target must be the test Drive);
//  - resumable: the work list and the source→copy map are saved regularly, a run stops
//    after a time budget and the next run continues where it stopped;
//  - Google rate limits / 5xx are retried, then left for the next run (never marked failed);
//    a folder that cannot be listed is recorded as failed and the copy goes on;
//  - refuses to run if the target is the source, or without the direct Google access.

export const SKIP_NAMES = new Set(['OFFICE_MANAGER_MAP.xlsx', 'OFFICE_MANAGER_REGISTER.xlsx']);
const SKIP_PATTERNS = [/^ENTRAINEMENT_AUDIT_OFFICE_MANAGER/, /^~\$/];
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });

export function skipped(file) {
  if (SKIP_NAMES.has(file.name)) return 'memoire_orpailleur';
  if (SKIP_PATTERNS.some(p => p.test(file.name))) return 'entrainement_ou_temporaire';
  if (file.mimeType === SHORTCUT) return 'raccourci';
  return null;
}

// 429, 5xx and Drive's rate-limit 403s are transient: retry later, never "failed".
export function transient(e) {
  if (e?.transient) return true;
  return /GOOGLE_API_(429|5\d\d)|rateLimitExceeded|userRateLimitExceeded|backendError/.test(String(e?.message || e));
}

// Google Drive v3 with the firm's direct access (service account), all drives.
export function googleDriveApi(fetchImpl = fetch, { sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  async function once(url, options = {}) {
    const token = await googleAccessToken();
    const r = await fetchImpl(url, { ...options, headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}), ...(options.body && !options.headers ? { 'Content-Type': 'application/json' } : {}) } });
    const raw = await r.text();
    let data = raw; try { data = raw ? JSON.parse(raw) : {}; } catch {}
    if (!r.ok) {
      const text = String(typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 300);
      throw fail('GOOGLE_API_' + r.status + ': ' + text, 502, { transient: r.status === 429 || r.status >= 500 || /rateLimitExceeded/.test(text) });
    }
    return data;
  }
  async function call(url, options = {}) {
    for (let i = 0; ; i++) {
      try { return await once(url, options); }
      catch (e) { if (!transient(e) || i >= 2) throw e; await sleep(800 * (i + 1)); }
    }
  }
  const base = 'https://www.googleapis.com/drive/v3';
  return {
    async drive(id) { return call(base + '/drives/' + encodeURIComponent(id) + '?fields=id,name'); },
    async children(parentId) {
      const out = []; let page = null;
      do {
        const p = new URLSearchParams({ q: "'" + parentId.replace(/'/g, "\\'") + "' in parents and trashed = false", supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true', pageSize: '1000', fields: 'nextPageToken,files(id,name,mimeType,size)' });
        if (page) p.set('pageToken', page);
        const d = await call(base + '/files?' + p);
        out.push(...(d.files || [])); page = d.nextPageToken || null;
      } while (page);
      return out;
    },
    async createFolder(parentId, name) {
      await assertWritableTarget(parentId);
      const made = await call(base + '/files?supportsAllDrives=true&fields=id,name', { method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }) });
      trustCreatedChild(parentId, made.id);
      return made;
    },
    // A text uploaded and converted into a Google Doc (readable by the agents like any document).
    async createDoc(parentId, name, text) {
      await assertWritableTarget(parentId);
      const boundary = 'om' + Date.now().toString(36);
      const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify({ name, parents: [parentId], mimeType: 'application/vnd.google-apps.document' }) +
        '\r\n--' + boundary + '\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n' + text + '\r\n--' + boundary + '--';
      return call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink', {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
      });
    },
    async copyFile(fileId, parentId, name) {
      await assertWritableTarget(parentId);
      return call(base + '/files/' + encodeURIComponent(fileId) + '/copy?supportsAllDrives=true&fields=id,name', { method: 'POST', body: JSON.stringify({ name, parents: [parentId] }) });
    }
  };
}

export function newCopyState(sourceDriveId, targetDriveId) {
  if (!sourceDriveId || !targetDriveId) throw fail('COPY_DRIVES_REQUIRED');
  if (sourceDriveId === targetDriveId) throw fail('COPY_TARGET_IS_SOURCE', 409);
  return { source: sourceDriveId, target: targetDriveId, queue: [{ src: sourceDriveId, dst: targetDriveId, path: '' }],
    map: { [sourceDriveId]: targetDriveId }, copied: 0, folders: 0, skipped: [], failed: [], done: false };
}

// Processes the work list until done or until the time budget is spent.
// save(state) is called every few items and at the end of each folder.
export async function copyStep(state, { api, save = async () => {}, budgetMs = 25000, now = () => Date.now(), canWrite = directGoogleAccess, saveEvery = 10 } = {}) {
  if (state.source === state.target) throw fail('COPY_TARGET_IS_SOURCE', 409);
  if (!canWrite()) throw fail('GOOGLE_DIRECT_ACCESS_REQUIRED', 409);
  const start = now();
  let sinceSave = 0;
  const tick = async (force = false) => { sinceSave += 1; if (force || sinceSave >= saveEvery) { sinceSave = 0; await save(state); } };
  while (state.queue.length && now() - start < budgetMs) {
    const job = state.queue[0];
    let kids;
    try { kids = await api.children(job.src); }
    catch (e) {
      if (transient(e)) { await save(state); return { ...summary(state), more: true, waiting: 'GOOGLE_RATE_LIMIT' }; }
      state.failed.push({ path: job.path || '/', error: 'Dossier illisible : ' + String(e.message || e).slice(0, 180) });
      state.queue.shift(); await tick(true); continue;
    }
    for (const f of kids) {
      if (state.map[f.id]) continue; // already copied in an earlier run
      const path = job.path + '/' + f.name;
      const why = skipped(f);
      if (why) { state.skipped.push({ path, why }); state.map[f.id] = 'SKIPPED'; await tick(); continue; }
      try {
        if (f.mimeType === FOLDER) {
          const made = await api.createFolder(job.dst, f.name);
          state.map[f.id] = made.id; state.folders += 1;
          state.queue.push({ src: f.id, dst: made.id, path });
        } else {
          const made = await api.copyFile(f.id, job.dst, f.name);
          state.map[f.id] = made.id; state.copied += 1;
        }
      } catch (e) {
        if (transient(e)) { await save(state); return { ...summary(state), more: true, waiting: 'GOOGLE_RATE_LIMIT' }; }
        state.map[f.id] = 'FAILED';
        state.failed.push({ path, error: String(e.message || e).slice(0, 200) });
      }
      await tick();
      if (now() - start >= budgetMs) { await save(state); return { ...summary(state), more: true }; }
    }
    state.queue.shift();
    await tick(true);
  }
  state.done = state.queue.length === 0;
  await save(state);
  return { ...summary(state), more: !state.done };
}

export function summary(s) {
  return { done: s.done, folders: s.folders, copied: s.copied, skipped: s.skipped.length, failed: s.failed.length, waiting_folders: s.queue.length };
}
