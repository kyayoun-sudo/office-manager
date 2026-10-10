import { googleAccessToken, directGoogleAccess, configuredDriveId, assertWritableTarget } from './google-drive.js';
import { firmDriveKind } from './google-connection.js';

// Drive writes for the Orpailleur "Rangement": move a file, create a folder.
// Never deletes, never renames. Uses the direct Google access already supported
// by lib/google-drive.js (GOOGLE_SERVICE_ACCOUNT_JSON or OAuth refresh credentials
// in Vercel). The Supabase bridge has no "move" action: in bridge-only mode the
// plan is prepared but execution reports DRIVE_WRITE_REQUIRES_DIRECT_ACCESS.

const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';

function requireDirect() {
  if (!directGoogleAccess()) throw Object.assign(new Error('DRIVE_WRITE_REQUIRES_DIRECT_ACCESS'), { statusCode: 409 });
}

async function call(url, options = {}) {
  const token = await googleAccessToken();
  const r = await fetch(url, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  const raw = await r.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!r.ok) throw new Error('GOOGLE_API_' + r.status);
  return data;
}

export const tidyDrive = {
  canWrite: () => directGoogleAccess(),

  async getFile(fileId) {
    requireDirect();
    return call(API + '/' + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=id,name,parents,driveId,trashed,mimeType,md5Checksum,version');
  },

  // Compare actual binary content, independently of names. Never delete either copy.
  async findContentDuplicate(fileId, parentId) {
    await assertWritableTarget(fileId);
    if (parentId) await assertWritableTarget(parentId);
    const source = await this.getFile(fileId);
    if (!source || source.trashed) throw new Error('FILE_GONE');
    if (!source.md5Checksum || !parentId) return null; // Native Google files have no binary checksum.
    const params = new URLSearchParams({ q: "'" + String(parentId).replace(/'/g, "\\'") + "' in parents and trashed = false",
      fields: 'files(id,name,md5Checksum),nextPageToken,incompleteSearch', pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'user' });
    if (source.driveId) { params.set('corpora', 'drive'); params.set('driveId', source.driveId); }
    for (let page = 0; page < 100; page++) {
      const result = await call(API + '?' + params.toString());
      if (!result || result.incompleteSearch) throw new Error('DUPLICATE_CHECK_INCOMPLETE');
      const twin = (result.files || []).find(f => f.id !== fileId && f.md5Checksum === source.md5Checksum);
      if (twin) return { id: twin.id, name: twin.name, checksum: source.md5Checksum };
      if (!result.nextPageToken) return null;
      params.set('pageToken', result.nextPageToken);
    }
    throw new Error('DUPLICATE_CHECK_INCOMPLETE');
  },

  // Moves one file (and/or renames it) inside the firm's Shared Drive.
  // Same folder + new name = rename only. Never deletes.
  async move(fileId, fromParentId, toParentId, newName = null) {
    requireDirect();
    const meta = await this.getFile(fileId);
    if (!meta || meta.trashed) throw new Error('FILE_GONE');
    if ((firmDriveKind() || 'drive') === 'drive' && configuredDriveId() && meta.driveId && meta.driveId !== configuredDriveId()) throw new Error('OUTSIDE_FIRM_DRIVE');
    if (fromParentId && !(meta.parents || []).includes(fromParentId)) throw new Error('MOVED_MEANWHILE');
    // Test mode: the file AND its destination must be in the test Drive.
    await assertWritableTarget(fileId);
    if (toParentId) await assertWritableTarget(toParentId);
    const params = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id,name,parents' });
    if (toParentId && toParentId !== fromParentId) {
      params.set('addParents', toParentId);
      if (fromParentId) params.set('removeParents', fromParentId);
    }
    const body = newName ? { name: String(newName).slice(0, 250) } : {};
    return call(API + '/' + encodeURIComponent(fileId) + '?' + params.toString(), { method: 'PATCH', body: JSON.stringify(body) });
  },

  // Another file already carrying this name in the folder (same name ≠ duplicate: never overwritten).
  async nameTaken(parentId, name, exceptId = null) {
    requireDirect();
    const qy = new URLSearchParams({ q: "name = '" + String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' and '" + parentId + "' in parents and trashed = false",
      fields: 'files(id,name)', pageSize: '5', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' });
    const found = await call(API + '?' + qy.toString());
    return (found?.files || []).some(f => f.id !== exceptId);
  },

  // The folder « name » directly under parentId: found, or created (never twice).
  async findOrCreateFolder(parentId, name) {
    requireDirect();
    const clean = String(name || '').trim().slice(0, 200);
    if (!clean) throw new Error('FOLDER_NAME_REQUIRED');
    const qy = new URLSearchParams({ q: "name = '" + clean.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' and '" + parentId + "' in parents and mimeType = '" + FOLDER + "' and trashed = false",
      fields: 'files(id,name),nextPageToken,incompleteSearch', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' });
    const found = await call(API + '?' + qy.toString());
    if (!found || found.incompleteSearch || found.nextPageToken) throw new Error('FOLDER_LOOKUP_INCOMPLETE');
    if (found.files?.length > 1) throw new Error('AMBIGUOUS_EXISTING_FOLDERS');
    if (found?.files?.[0]) return found.files[0];
    return this.createFolder(parentId, clean);
  },

  // An EMPTY folder the agents emptied (Paul, 2026-10-08: « quand le dossier est vide, l'Orpailleur
  // doit pouvoir le supprimer ; le but c'est aussi l'esthétique »). Bin only (recoverable 30 days),
  // never a folder at the top of the drive, never one that still holds anything.
  async binEmptyFolder(folderId, { protect = [] } = {}) {
    requireDirect();
    if (!folderId || protect.includes(folderId)) return { binned: false, reason: 'PROTECTED' };
    const meta = await call(API + '/' + encodeURIComponent(folderId) + '?supportsAllDrives=true&fields=id,name,parents,driveId,trashed,mimeType');
    if (!meta || meta.trashed || meta.mimeType !== FOLDER) return { binned: false, reason: 'NOT_A_FOLDER' };
    const parent = (meta.parents || [])[0];
    if (!parent || parent === meta.driveId || protect.includes(parent)) return { binned: false, reason: 'TOP_FOLDER' };
    const qy = new URLSearchParams({ q: "'" + folderId + "' in parents and trashed = false", fields: 'files(id)', pageSize: '1', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' });
    const left = await call(API + '?' + qy.toString());
    if ((left?.files || []).length) return { binned: false, reason: 'NOT_EMPTY' };
    await assertWritableTarget(folderId);
    await call(API + '/' + encodeURIComponent(folderId) + '?supportsAllDrives=true', { method: 'PATCH', body: JSON.stringify({ trashed: true }) });
    return { binned: true, name: meta.name };
  },

  async createFolder(parentId, name) {
    requireDirect();
    await assertWritableTarget(parentId);
    return call(API + '?supportsAllDrives=true&fields=id,name,parents', {
      method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] })
    });
  }
};
