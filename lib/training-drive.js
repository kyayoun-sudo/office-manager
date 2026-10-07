import { createBinaryFile, listDriveChildren, readDriveFileText, googleAccessToken, directGoogleAccess, configuredDriveId } from './google-drive.js';

// Drive access for the training of the agents. The training folder lives on the firm's
// Drive (audit area): fake missions are created there, and the team may add real
// missions next to them so that the agent trains on both.
//
// SAFETY RULES (enforced here, not only in the screens):
//  - folders and files are created only inside the training folder;
//  - removal is a move to the Drive trash (recoverable 30 days), never a permanent delete;
//  - removal is refused for anything that is not in the training registry
//    (office_training_items, written when WE created it), not a direct child of the
//    training folder, or not marked as a training folder. A real mission is never touched.

const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const fail = (code, statusCode = 409) => Object.assign(new Error(code), { statusCode });

async function google(url, options = {}) {
  const token = await googleAccessToken();
  const r = await fetch(url, { ...options, headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  const raw = await r.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!r.ok) throw new Error('GOOGLE_API_' + r.status);
  return data;
}

// Same Supabase bridge as lib/google-drive.js (used when there is no direct Google access).
async function bridge(action, payload) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY, secret = process.env.ORPAILLEUR_JOB_SECRET;
  if (!base || !key || !secret) throw fail('GOOGLE_CONNECTION_REQUIRED', 503);
  const r = await fetch(base + '/functions/v1/taty-google-bridge', {
    method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'x-orpailleur-secret': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) throw new Error('GOOGLE_BRIDGE_' + r.status);
  return data;
}

export const trainingDrive = {
  canTrash: () => directGoogleAccess(),
  defaultParent: () => configuredDriveId() || null,

  async createFolder(parentId, name) {
    if (!parentId) throw fail('TRAINING_PARENT_REQUIRED', 400);
    if (directGoogleAccess()) {
      return google(API + '?supportsAllDrives=true&fields=id,name,parents,webViewLink', {
        method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId], description: 'Office Manager — entraînement des agents' })
      });
    }
    return bridge('create_folder', { parent_id: parentId, name });
  },

  createTextFile(parentId, name, text) {
    return createBinaryFile({ name, parentId, buffer: Buffer.from(String(text), 'utf8'), mimeType: 'text/plain' });
  },

  list: (folderId) => listDriveChildren(folderId),
  read: (fileId, maxChars = 6000) => readDriveFileText(fileId, { maxChars }),

  // Moves ONE registered training folder to the trash, after every check.
  async trashTrainingFolder(fileId, { rootId, registered }) {
    if (!directGoogleAccess()) throw fail('DRIVE_WRITE_REQUIRES_DIRECT_ACCESS');
    if (!registered) throw fail('NOT_A_TRAINING_ITEM', 403);
    const meta = await google(API + '/' + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=id,name,parents,trashed,mimeType');
    if (!meta) throw fail('FILE_GONE');
    if (meta.trashed) return { id: fileId, already: true };
    if (!(meta.parents || []).includes(rootId)) throw fail('OUTSIDE_TRAINING_FOLDER', 403);
    if (meta.mimeType !== FOLDER || !String(meta.name || '').startsWith('[ENTRAINEMENT]')) throw fail('NOT_A_TRAINING_FOLDER', 403);
    await google(API + '/' + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=id,trashed', { method: 'PATCH', body: JSON.stringify({ trashed: true }) });
    return { id: fileId, name: meta.name, trashed: true };
  }
};

// Reads a mission folder (two levels, bounded) into one text for the agent.
export async function readMissionFolder(folderId, drive = trainingDrive, { maxFiles = 14, maxTotal = 22000 } = {}) {
  const out = []; let total = 0, count = 0;
  async function walk(id, prefix, depth) {
    const children = await drive.list(id);
    for (const f of children.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      if (count >= maxFiles || total >= maxTotal) return;
      const path = prefix + f.name;
      if (f.mimeType === FOLDER) { out.push('[dossier] ' + path + '/'); if (depth < 2) await walk(f.id, path + '/', depth + 1); continue; }
      count++;
      let text = '';
      try { const r = await drive.read(f.id, 5000); text = r?.supported === false ? '(contenu non lisible : ' + (r.reason || 'format') + ')' : String(r?.text || ''); }
      catch (e) { text = '(lecture impossible : ' + String(e.message || e).slice(0, 80) + ')'; }
      text = text.slice(0, Math.max(0, maxTotal - total));
      total += text.length;
      out.push('--- fichier : ' + path + ' ---\n' + text);
    }
  }
  await walk(folderId, '', 1);
  return out.join('\n');
}
