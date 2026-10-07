import { googleAccessToken, directGoogleAccess, configuredDriveId } from './google-drive.js';

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

  // Moves one file from one folder to another inside the firm's Shared Drive.
  async move(fileId, fromParentId, toParentId) {
    requireDirect();
    const meta = await this.getFile(fileId);
    if (!meta || meta.trashed) throw new Error('FILE_GONE');
    if (configuredDriveId() && meta.driveId && meta.driveId !== configuredDriveId()) throw new Error('OUTSIDE_FIRM_DRIVE');
    if (fromParentId && !(meta.parents || []).includes(fromParentId)) throw new Error('MOVED_MEANWHILE');
    const params = new URLSearchParams({ addParents: toParentId, supportsAllDrives: 'true', fields: 'id,parents' });
    if (fromParentId) params.set('removeParents', fromParentId);
    return call(API + '/' + encodeURIComponent(fileId) + '?' + params.toString(), { method: 'PATCH', body: '{}' });
  },

  async createFolder(parentId, name) {
    requireDirect();
    return call(API + '?supportsAllDrives=true&fields=id,name,parents', {
      method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] })
    });
  }
};
