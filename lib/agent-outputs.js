import ExcelJS from 'exceljs';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { tidyDrive } from './tidy-drive.js';
import { getDriveFileMetadata, downloadFileBuffer, readDriveFileText } from './google-drive.js';

// What the agents produce for the firm — risk briefings, engagement preparations, Enhanced Auditor
// reviews, tables read from pictures — is saved in their own folder in the Drive (the agents'
// memory, e.g. TATY_AI_office manager), in one sub-folder per kind, as real Google Docs and Excel
// files the team can open, comment and share. Nothing is overwritten: each version is a new file
// dated in its name.

export const OUTPUT_FOLDERS = {
  risks: 'EVALUATION_DES_RISQUES',
  engagements: 'PREPARATION_DES_MISSIONS',
  auditor: 'ENHANCED_AUDITOR',
  submissions: 'SUIVI_DES_SOUMISSIONS',
  capabilities: 'CAPACITES_DU_CABINET',
  deposits: 'ANALYSES_DES_DEPOTS'
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(t) {
  return esc(t)
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (m, a, b) => '<b>' + (a || b) + '</b>')
    .replace(/\+\+(.+?)\+\+/g, '<u>$1</u>')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*/g, '');
}

// Markdown (as the agents write it) → HTML that Google Docs converts into a formatted document.
export function markdownToHtml(md, title = '') {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null, para = [];
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const close = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    let m;
    if (!t) { flush(); close(); continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(t))) { flush(); close(); const n = Math.min(4, m[1].length + 1); out.push('<h' + n + '>' + inline(m[2]) + '</h' + n + '>'); continue; }
    if (/^\|.*\|$/.test(t) && /^\|?\s*:?-{2,}/.test((lines[i + 1] || '').trim())) {
      flush(); close();
      out.push('<table border="1" cellpadding="5" style="border-collapse:collapse"><tr>' + cells(t).map(c => '<th style="background:#E3EFEC">' + inline(c) + '</th>').join('') + '</tr>');
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { out.push('<tr>' + cells(lines[i]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>'); i++; }
      i--; out.push('</table>'); continue;
    }
    if ((m = /^([-*•]|\d+[.)])\s+(.*)$/.exec(t))) {
      flush(); const kind = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (list !== kind) { close(); out.push('<' + kind + '>'); list = kind; }
      out.push('<li>' + inline(m[2]) + '</li>'); continue;
    }
    close(); para.push(t);
  }
  flush(); close();
  return '<html><head><meta charset="utf-8"><title>' + esc(title) + '</title></head><body style="font-family:Arial;font-size:11pt">' +
    (title ? '<h1>' + esc(title) + '</h1>' : '') + out.join('\n') + '</body></html>';
}

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h');

export async function outputFolder(kind, d = {}) {
  const root = d.folder || memoryFolderId();
  if (!root) throw Object.assign(new Error('AGENTS_FOLDER_NOT_SET'), { statusCode: 409 });
  const name = OUTPUT_FOLDERS[kind] || kind;
  return (await (d.tidyDrive || tidyDrive).findOrCreateFolder(root, name)).id;
}

// One file per subject, UPDATED at each pass (Paul, 2026-10-08: « ils ne créent pas de nouveaux
// Excel, ils mettent à jour leur dernier passage »): the same name finds the same file, whose
// content is replaced; the date of the update is written inside. Not found → created once.
async function updateExisting(drive, name, parentId, buffer, mimeType) {
  const found = (await drive.findFilesByExactName(name, parentId).catch(() => []))?.[0];
  if (!found) return null;
  try {
    const meta = await drive.getMeta(found.id);
    await drive.updateBinary(found.id, { buffer, mimeType, expectedModifiedTime: meta?.modifiedTime });
    return { id: found.id, webViewLink: meta?.webViewLink || found.webViewLink || null };
  } catch { return null; }
}

// A Google Doc in the agents' folder (sub-folder « kind »).
export async function saveReport(kind, title, markdown, d = {}) {
  const parentId = d.parentId || await outputFolder(kind, d);
  const name = String(title).replace(/[\\/]/g, ' ').slice(0, 150).trim();
  const html = markdownToHtml('*Mis à jour le ' + stamp() + '*\n\n' + markdown, title);
  const drive = d.drive || driveAdapter;
  const f = await updateExisting(drive, name, parentId, Buffer.from(html, 'utf8'), 'text/html')
    || await drive.createBinary({ name, parentId, buffer: Buffer.from(html, 'utf8'), mimeType: 'text/html', targetMimeType: 'application/vnd.google-apps.document' });
  return { id: f?.id || null, name, url: f?.webViewLink || (f?.id ? 'https://docs.google.com/document/d/' + f.id + '/edit' : null), folder_id: parentId };
}

// An Excel file (one sheet per table) in the agents' folder.
export async function saveWorkbook(kind, title, sheets, d = {}) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets || []) {
    const ws = wb.addWorksheet(String(s.name || 'Feuille').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    (s.rows || []).forEach((r, i) => { const row = ws.addRow(r); if (i === 0) row.font = { bold: true }; });
    ws.columns.forEach(c => { c.width = 18; });
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const parentId = d.parentId || await outputFolder(kind, d);
  const name = (String(title).replace(/[\\/]/g, ' ').slice(0, 150) + '.xlsx').trim();
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const drive = d.drive || driveAdapter;
  const f = await updateExisting(drive, name, parentId, buffer, XLSX) || await drive.createBinary({ name, parentId, buffer, mimeType: XLSX });
  return { id: f?.id || null, name, url: f?.webViewLink || null };
}

const VISUAL = /^(image\/(png|jpe?g|webp|gif)|application\/pdf)$/i;
// A Drive file prepared for the AI: pictures and PDFs as they are (the models look at them),
// everything else as extracted text (Word, Excel, Google Docs/Sheets…).
export async function fileForAI(fileId, d = {}) {
  const meta = await (d.getMeta || getDriveFileMetadata)(fileId);
  if (!meta) throw Object.assign(new Error('FILE_NOT_FOUND'), { statusCode: 404 });
  const size = Number(meta.size || 0);
  if (VISUAL.test(meta.mimeType || '') && size <= 15 * 1024 * 1024) {
    const buf = await (d.download || downloadFileBuffer)(fileId);
    return { id: fileId, name: meta.name, mimeType: meta.mimeType, base64: Buffer.from(buf).toString('base64'), url: meta.webViewLink || null, visual: true };
  }
  const t = await (d.readText || ((id, o) => readDriveFileText(id, o)))(fileId, { maxChars: d.maxChars || 60000 });
  return { id: fileId, name: meta.name, mimeType: meta.mimeType, text: String(t?.text ?? t ?? ''), url: meta.webViewLink || null, visual: false };
}
