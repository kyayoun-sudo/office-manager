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
    return call(API + '/' + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=id,name,parents,driveId,trashed,mimeType');
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

  // The folder « name » directly under parentId: found, or created (never twice).
  async findOrCreateFolder(parentId, name) {
    requireDirect();
    const clean = String(name || '').trim().slice(0, 200);
    if (!clean) throw new Error('FOLDER_NAME_REQUIRED');
    const qy = new URLSearchParams({ q: "name = '" + clean.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' and '" + parentId + "' in parents and mimeType = '" + FOLDER + "' and trashed = false",
      fields: 'files(id,name)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' });
    const found = await call(API + '?' + qy.toString());
    if (found?.files?.[0]) return found.files[0];
    return this.createFolder(parentId, clean);
  },

  async createFolder(parentId, name) {
    requireDirect();
    await assertWritableTarget(parentId);
    return call(API + '?supportsAllDrives=true&fields=id,name,parents', {
      method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] })
    });
  }
};
