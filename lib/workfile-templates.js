// THE FIRM'S OWN WORKING FILES, WHATEVER THEIR FORM (Paul, 2026-10-19 : « il doit me demander où se trouve le dossier pour
// partir faire son travail » ; « n'importe quelle compagnie doit pouvoir l'utiliser, sans reconfiguration »).
//   1. Where: the Enhanced Auditor ASKS once where the firm's Working File models are (a folder of its Drive), through the
//      existing « document location » question (pop-up for owner / partners / managers). The answer is kept by Drive ID in
//      the shared document index; « we have none » is a valid answer (then the generic working paper is used).
//   2. Which: the model of a cycle is chosen by its CONTENT, by code: the procedure codes of the validated programme (they
//      come from the firm's own SOP) that the file actually contains. Names never decide. Several equally good files or none
//      → nothing is guessed (the cycle gets the generic working paper and the reason is shown).
//   3. Copy: the chosen model is COPIED into the mission's working-papers folder (never overwritten, checked in the Drive).
// Understanding each part of a model (which cells the auditor fills, which the agent can fill) is the next brick.

import { driveAdapter } from './drive-adapter.js';

export const TEMPLATES_REF = Object.freeze({ document_type: 'workfile_templates', document_role: 'template' });
const FOLDER = 'application/vnd.google-apps.folder';
const XLSX = /spreadsheetml|ms-excel|google-apps\.spreadsheet|\.xlsx?$|\.xlsm$/i;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// Where the models are: the confirmed reference, « none », or a question asked once (and shown in the pop-up).
export async function templatesFolder(orgId, d = {}) {
  const index = d.index || await import('./file-index.js');
  const refs = await (d.documentReferences || index.documentReferences)(orgId, d).catch(() => []);
  const ref = refs.find(r => r.document_type === TEMPLATES_REF.document_type && r.document_role === TEMPLATES_REF.document_role && !r.mission_id);
  if (ref?.availability === 'CONFIRMED_NOT_AVAILABLE') return { status: 'NONE' };
  if (ref?.file_id) return { status: 'KNOWN', folder_id: ref.file_id, name: ref.name || null };
  await (d.askLocation || askTemplatesFolder)(orgId, d).catch(() => null);
  return { status: 'ASKED', question: QUESTION };
}
const QUESTION = 'Où se trouve le dossier des Working Files modèles du cabinet ? Collez le lien du dossier Drive (ou dites que le cabinet n’en a pas).';
export async function askTemplatesFolder(orgId, d = {}) {
  const { FILE_INDEX } = await import('./file-index.js');
  const update = d.updateJsonFile || (await import('./mapping-scan.js')).updateJsonFile;
  const folder = d.folder || (await import('./memory-runtime.js')).memoryFolderId();
  const key = JSON.stringify([orgId, null, null, null, TEMPLATES_REF.document_role, TEMPLATES_REF.document_type]);
  await update(FILE_INDEX, st => {
    const s = st || { files: {} }; s.requests ||= {};
    const old = s.requests[key] || {};
    if (old.status === 'open') return null; // asked once: never a second question
    s.requests[key] = { org_id: orgId, ...TEMPLATES_REF, mission_id: null, cycle: null, period: null, status: 'open', first_requested_at: old.first_requested_at || new Date().toISOString(),
      agents: ['enhanced-auditor'], question: QUESTION, configuration_href: '/secretariat.html?document_type=workfile_templates&document_role=template#ref-card' };
    return s;
  }, { drive: d.drive || driveAdapter, folder });
}

// The spreadsheets of the models folder (and one level of sub-folders).
export async function listTemplateFiles(folderId, drive = driveAdapter) {
  const out = [];
  const kids = await drive.listChildren(folderId).catch(() => []);
  for (const f of kids) {
    if (f.mimeType === FOLDER) { for (const g of await drive.listChildren(f.id).catch(() => [])) if (g.mimeType !== FOLDER && XLSX.test((g.mimeType || '') + ' ' + (g.name || ''))) out.push(g); }
    else if (XLSX.test((f.mimeType || '') + ' ' + (f.name || ''))) out.push(f);
  }
  return out.slice(0, 120);
}

// How well a model's CONTENT covers a cycle of the programme: the cycle's active procedure codes found in the file.
export function scoreTemplate(text, cycle) {
  const t = norm(text);
  const codes = (cycle.procedures || []).filter(p => p.active !== false).map(p => norm(p.code)).filter(Boolean);
  const found = codes.filter(c => new RegExp('(^|[^A-Z0-9])' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Z0-9]|$)').test(t));
  return { found, total: codes.length, score: codes.length ? found.length / codes.length : 0 };
}

// The model for a cycle: the file that contains the most of the cycle's procedures; ties or nothing → no guess.
export async function pickTemplate(cycle, files, read, d = {}) {
  const scored = [];
  for (const f of files) {
    let text = d.texts?.get?.(f.id);
    if (text == null) { try { const r = await read(f.id, { maxChars: d.templateChars || 60000 }); text = typeof r === 'string' ? r : r?.text || ''; } catch { text = ''; } d.texts?.set?.(f.id, text); }
    const s = scoreTemplate(text, cycle);
    if (s.found.length) scored.push({ file: f, ...s });
  }
  scored.sort((a, b) => b.score - a.score || b.found.length - a.found.length);
  const [best, second] = scored;
  if (!best) return { status: 'NO_MODEL_FOR_CYCLE', candidates: [] };
  if (second && second.score === best.score && second.found.length === best.found.length) return { status: 'AMBIGUOUS', candidates: scored.slice(0, 4).map(s => ({ id: s.file.id, name: s.file.name, found: s.found.length })) };
  return { status: 'FOUND', file: best.file, found: best.found, total: best.total, score: best.score };
}

// Copies the chosen model into the mission's working-papers folder, never over an existing file; checked afterwards.
export async function copyTemplate(template, name, folderId, drive = driveAdapter) {
  const existing = await drive.findFilesByExactName(name, folderId).catch(() => []);
  if (existing?.length) return { file_id: existing[0].id, name, status: 'ALREADY_EXISTS', note: 'gardé tel quel (jamais écrasé)' };
  const copy = await drive.copyFile(template.id, name, folderId);
  const meta = copy?.id ? await drive.getMeta(copy.id).catch(() => null) : null;
  const verified = Boolean(meta && (!meta.parents || meta.parents.includes(folderId)));
  return { file_id: copy?.id || null, name, url: meta?.webViewLink || null, status: verified ? 'CREATED_FROM_MODEL' : 'CREATED_NOT_VERIFIED', model: { id: template.id, name: template.name } };
}
