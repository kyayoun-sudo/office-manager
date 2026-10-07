import { googleAccessToken, directGoogleAccess, configuredDriveId, googleConnectionConfigured, moveTidyFileThroughBridge, createDriveFolder } from './google-drive.js';

// Drive writes for the Orpailleur "Rangement": move a file, create a folder.
// Never deletes, never renames. Uses the direct Google access already supported
// by lib/google-drive.js (GOOGLE_SERVICE_ACCOUNT_JSON or OAuth refresh credentials
// in Vercel) or the authenticated Supabase bridge. Bridge moves resolve file and
// destination from a claimed, approved internal item and verify the final parents.

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
  canWrite: () => googleConnectionConfigured(),

  async getFile(fileId) {
    requireDirect();
    return call(API + '/' + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=id,name,parents,driveId,trashed,mimeType');
  },

  // Moves one file from one folder to another inside the firm's Shared Drive.
  async move(fileId, fromParentId, toParentId, context) {
    if (!directGoogleAccess()) {
      if (!context) throw new Error('TIDY_SCOPE_INVALID');
      return moveTidyFileThroughBridge(context);
    }
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
    if (!directGoogleAccess()) return createDriveFolder(name, parentId);
    requireDirect();
    return call(API + '?supportsAllDrives=true&fields=id,name,parents', {
      method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] })
    });
  }
};
