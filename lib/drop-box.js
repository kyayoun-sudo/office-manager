import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId, homeFolderId } from './memory-runtime.js';
import { runAI } from './ai.js';
import { loadScan } from './mapping-scan.js';
import { proposeMessage } from './agent-mail.js';

// « Déposer des documents » (Rangement page, Paul 2026-10-07: « une place où les gens déposent
// des documents, 40 au plus, s'ils veulent qu'ils soient renommés et envoyés ou mis quelque part »).
// Each file is uploaded to the drop folder of the agents' memory (00_OFFICE_MANAGER/A_RANGER),
// read by the AI, which proposes its clear name and its place in the Drive. The move/rename waits
// in « À valider » (FILE_MOVE, done by the app after approval). If the person asked to send it to
// someone, a message with the Drive link also waits in « À valider ».

const DROP_FOLDER = 'A_RANGER';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_BYTES = 3 * 1024 * 1024; // one file per request (Vercel request limit ~4.5 MB)
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });

const INSTRUCTIONS = `Tu es l'Orpailleur d'un cabinet. Une personne dépose un document à ranger.
On te donne : les dossiers du Drive (id | chemin), le nom du fichier, un extrait de son contenu et le souhait de la personne.
Décide : le nom clair du fichier (garde l'extension) et le dossier où il doit aller (un id de la liste, jamais inventé ; "" si aucun ne convient).
Réponds en JSON STRICT : {"new_name":"","to_folder_id":"","reason":""}`;

function parseJson(text) {
  const t = String(text || ''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw fail('DROP_AI_UNREADABLE', 502);
  return JSON.parse(t.slice(a, b + 1));
}

async function dropFolderId(drive, d) {
  const root = d.home || d.folder || homeFolderId();
  if (!root) throw fail('DRIVE_NOT_CHOSEN', 409);
  const found = (await (d.listChildren || drive.listChildren)(root).catch(() => [])).find(c => c.name === DROP_FOLDER && c.mimeType === FOLDER_MIME);
  if (found) return found.id;
  const created = await (d.createFolder || (async (parent, name) => {
    const { tidyDrive } = await import('./tidy-drive.js'); return tidyDrive.createFolder(parent, name);
  }))(root, DROP_FOLDER);
  return created.id;
}

export async function dropFile(orgId, body = {}, account = null, d = {}) {
  const drive = d.drive || driveAdapter, fetchRows = d.fetchRows || rest;
  const name = String(body.name || '').trim().slice(0, 200);
  if (!name) throw fail('FILE_NAME_REQUIRED');
  const buffer = Buffer.from(String(body.base64 || ''), 'base64');
  if (!buffer.length) throw fail('FILE_EMPTY');
  if (buffer.length > MAX_BYTES) throw fail('FILE_TOO_LARGE');
  const mimeType = String(body.mime || 'application/octet-stream').slice(0, 120);
  const wish = String(body.wish || '').slice(0, 500);
  const sendTo = String(body.send_to || '').trim().toLowerCase();

  // 1. Into the drop folder (a unique name: two people may drop « scan.pdf »). A whole folder
  // dropped (Paul, 2026-10-08) keeps its tree: A_RANGER/<date>_<dossier>/<sous-dossiers>/fichier.
  let parent = await dropFolderId(drive, d);
  const relPath = String(body.rel_path || '').replace(/\\/g, '/').split('/').map(x => x.trim()).filter(Boolean).slice(0, 8);
  const label = String(body.deposit_label || '').trim().slice(0, 100);
  const folderOf = d.findOrCreateFolder || (async (p0, n) => { const { tidyDrive } = await import('./tidy-drive.js'); return tidyDrive.findOrCreateFolder(p0, n); });
  if (label) parent = (await folderOf(parent, label.replace(/[\\/]/g, ' '))).id;
  for (const seg of relPath.slice(label ? 1 : 0, -1)) parent = (await folderOf(parent, seg.slice(0, 120))).id;
  const stamped = label ? name : new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '_' + name;
  const file = await drive.createBinary({ name: stamped, parentId: parent, buffer, mimeType });
  return fileDropped(orgId, { file, name, stamped, parent, relPath, wish, sendTo }, account, d);
}

// Where a dropped file goes, once it is in the Drive (small file sent through the app, or a large
// file the browser sent straight to Google).
async function dropTarget(body, d) {
  const drive = d.drive || driveAdapter;
  let parent = await dropFolderId(drive, d);
  const relPath = String(body.rel_path || '').replace(/\\/g, '/').split('/').map(x => x.trim()).filter(Boolean).slice(0, 8);
  const label = String(body.deposit_label || '').trim().slice(0, 100);
  const folderOf = d.findOrCreateFolder || (async (p0, n) => { const { tidyDrive } = await import('./tidy-drive.js'); return tidyDrive.findOrCreateFolder(p0, n); });
  if (label) parent = (await folderOf(parent, label.replace(/[\\/]/g, ' '))).id;
  for (const seg of relPath.slice(label ? 1 : 0, -1)) parent = (await folderOf(parent, seg.slice(0, 120))).id;
  const name = String(body.name || '').trim().slice(0, 200);
  const stamped = label ? name : new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '_' + name;
  return { parent, relPath, name, stamped };
}

// LARGE FILES (2026-10-08: working papers of several MB, a whole audit file): the app opens a
// Google upload session in the right folder; the browser sends the file STRAIGHT to Google (no
// size limit of the app); then « finish » lets the agents read it as for a small file.
export async function startLargeUpload(orgId, body = {}, account = null, req = null, d = {}) {
  const name = String(body.name || '').trim().slice(0, 200);
  if (!name) throw fail('FILE_NAME_REQUIRED');
  const size = Number(body.size) || 0;
  if (size <= 0) throw fail('FILE_EMPTY');
  if (size > 5 * 1024 * 1024 * 1024) throw fail('FILE_TOO_LARGE');
  const mimeType = String(body.mime || 'application/octet-stream').slice(0, 120);
  const t = await dropTarget(body, d);
  const { googleAccessToken, assertWritableTarget } = await import('./google-drive.js');
  await assertWritableTarget(t.parent);
  const token = await (d.token || googleAccessToken)();
  const origin = String(req?.headers?.origin || (req?.headers?.host ? 'https://' + req.headers.host : '')).slice(0, 200);
  const r = await (d.fetchImpl || fetch)('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(size), ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ name: t.stamped, parents: [t.parent] })
  });
  const url = r.headers?.get?.('location');
  if (!r.ok || !url) throw fail('UPLOAD_SESSION_REFUSED_' + r.status, 502);
  return { upload_url: url, name: t.stamped, parent: t.parent, rel_path: t.relPath.join('/') };
}

export async function finishLargeUpload(orgId, body = {}, account = null, d = {}) {
  const drive = d.drive || driveAdapter;
  const id = String(body.file_id || '');
  if (!/^[\w-]{10,}$/.test(id)) throw fail('FILE_ID_REQUIRED');
  const meta = await drive.getMeta(id);
  if (!meta) throw fail('FILE_NOT_FOUND', 404);
  const relPath = String(body.rel_path || '').split('/').filter(Boolean);
  return fileDropped(orgId, { file: { id, webViewLink: meta.webViewLink || null }, name: String(body.name || meta.name), stamped: meta.name, parent: (meta.parents || [])[0] || null,
    relPath, wish: String(body.wish || '').slice(0, 500), sendTo: String(body.send_to || '').trim().toLowerCase() }, account, d);
}

async function fileDropped(orgId, { file, name, stamped, parent, relPath, wish, sendTo }, account, d) {
  const drive = d.drive || driveAdapter, fetchRows = d.fetchRows || rest;
  // 2. The AI reads it and decides its name and place.
  let excerpt = '';
  try { const t = await drive.readText(file.id, { maxChars: 6000 }); excerpt = String(t?.text ?? t ?? '').slice(0, 6000); } catch { excerpt = ''; }
  const { state: scan } = await loadScan(drive, d.folder || memoryFolderId()).catch(() => ({ state: null }));
  const folders = (scan?.items || []).filter(i => i.mimeType === FOLDER_MIME && !/00_OFFICE_MANAGER/.test(i.path || '')).slice(0, 1500);
  const byId = new Map(folders.map(f => [f.id, f]));
  let decision = { new_name: name, to_folder_id: '', reason: 'Lecture impossible : à ranger à la main.' };
  try {
    const ai = await (d.runAI || runAI)({ agentKey: 'orpailleur', instructions: INSTRUCTIONS, maxTokens: 1500,
      input: 'DOSSIERS (id | chemin) :\n' + folders.map(f => f.id + ' | ' + f.path).join('\n') + '\n\nFICHIER : ' + name + (relPath.length > 1 ? '\nCHEMIN DANS LE DOSSIER DÉPOSÉ : ' + relPath.join('/') : '') + '\nSOUHAIT DE LA PERSONNE : ' + (wish || '(aucun)') + '\n\nEXTRAIT :\n' + excerpt });
    decision = parseJson(ai.text);
  } catch { /* stays to be filed by hand */ }
  const dest = decision.to_folder_id && byId.get(decision.to_folder_id);
  const newName = String(decision.new_name || name).slice(0, 250);
  const now = new Date().toISOString();
  const who = account?.display_name || account?.email || 'quelqu’un';
  const summary = (dest ? 'Ranger « ' + name + ' » (déposé par ' + who + ') dans « ' + dest.path + ' »' : 'Renommer « ' + name + ' » (déposé par ' + who + ', reste dans A_RANGER)') +
    ' sous le nom « ' + newName + ' » — ' + String(decision.reason || '').slice(0, 200);
  await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: orgId, agent_key: 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', work_state: 'requested', requested_at: now,
      idempotency_key: 'drop:' + file.id, summary: summary.slice(0, 500),
      payload: { file_id: file.id, file_name: stamped, from_parent: parent, to_parent: dest ? dest.id : null, to_name: dest ? dest.path : null, new_name: newName, web_url: file.webViewLink || null, dropped_by: who },
      evidence: { reason: String(decision.reason || '').slice(0, 500), wish, source: 'dépôt Rangement' } }]) });

  // 3. To be sent to someone: a message with the link, also waiting for validation.
  let message = null;
  if (sendTo) {
    message = await (d.proposeMessage || proposeMessage)(orgId, { recipients: [sendTo], source: 'agent', requested_by: who,
      subject: 'Document : ' + newName,
      body: 'Bonjour,\n\n' + who + ' te transmet « ' + newName + ' »' + (wish ? ' (' + wish + ')' : '') + '.\n' +
        (file.webViewLink ? 'Le document : ' + file.webViewLink + '\n' : '') + '\nBonne journée.' }, account).catch(e => ({ error: String(e.message || e) }));
  }
  return { file_id: file.id, url: file.webViewLink || null, path: relPath.join('/') || name, proposed_name: newName, destination: dest ? dest.path : null, reason: decision.reason || null,
    message: message ? (message.error ? 'Envoi impossible : ' + message.error : 'Message préparé, en attente de validation') : null };
}
