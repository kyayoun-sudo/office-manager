// Les archives .zip déposées sont ouvertes (Paul, 2026-10-25 : « l'application et tous les agents doivent pouvoir unzipper »).
// Chaque fichier de l'archive devient une pièce à côté du .zip (même dossier), lue ensuite comme les autres. Le .zip est gardé (rien n'est
// supprimé). Idempotent : un fichier déjà extrait (même nom, même taille, même dossier) est réutilisé, jamais recréé. Garde-fous : archive
// ≤ 100 Mo, ≤ 300 fichiers, ≤ 300 Mo décompressés, chemins ramenés à un nom simple (jamais de « ../ »), dossiers système ignorés, une archive
// dans l'archive ouverte une fois de plus (pas au-delà).
import JSZip from 'jszip';

const MAX_ZIP = 100 * 1024 * 1024, MAX_ENTRIES = 300, MAX_TOTAL = 300 * 1024 * 1024;
const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  txt: 'text/plain', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip' };
export const isZip = f => /\.zip$/i.test(f?.name || '') || /zip/i.test(f?.mimeType || '');
const safeName = (path, zipName) => {
  const parts = String(path).replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..');
  const base = parts.join('_').replace(/[<>:"|?*\u0000-\u001f]/g, '_').slice(-180);
  return base || (String(zipName || 'archive').replace(/\.zip$/i, '') + '_fichier');
};

export async function unzipToFolder(zipFile, drive, { depth = 0 } = {}) {
  const meta = await drive.getMeta(zipFile.id);
  if (!meta || meta.trashed) return { zip: zipFile, extracted: [], error: 'ZIP_NOT_FOUND' };
  if (Number(meta.size || 0) > MAX_ZIP) return { zip: zipFile, extracted: [], error: 'ZIP_TOO_LARGE' };
  const parent = (meta.parents || [])[0]; if (!parent) return { zip: zipFile, extracted: [], error: 'ZIP_FOLDER_UNKNOWN' };
  const zip = await JSZip.loadAsync(Buffer.from(await drive.downloadBuffer(zipFile.id)));
  const entries = Object.values(zip.files).filter(e => !e.dir && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/i.test(e.name));
  if (entries.length > MAX_ENTRIES) return { zip: zipFile, extracted: [], error: 'ZIP_TOO_MANY_FILES' };
  const out = []; let total = 0;
  for (const e of entries) {
    const buffer = Buffer.from(await e.async('nodebuffer'));
    total += buffer.length; if (total > MAX_TOTAL) return { zip: zipFile, extracted: out, error: 'ZIP_TOO_LARGE_UNCOMPRESSED' };
    const name = safeName(e.name, meta.name), ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
    const same = (await drive.findFilesByExactName(name, parent).catch(() => [])).find(f => !f.trashed && Number(f.size || -1) === buffer.length);
    const f = same || await drive.createBinary({ name, parentId: parent, buffer, mimeType: MIME[ext] || 'application/octet-stream' });
    const item = { id: f.id, name, path: (zipFile.path ? zipFile.path.replace(/[^/]*$/, '') : '') + name, url: f.webViewLink || null, from_zip: zipFile.name || meta.name, reused: Boolean(same) };
    if (ext === 'zip' && depth < 1) { const inner = await unzipToFolder({ id: f.id, name, path: item.path }, drive, { depth: depth + 1 }); out.push(...inner.extracted); continue; }
    out.push(item);
  }
  return { zip: zipFile, extracted: out };
}

// Replace each .zip of a list of pieces by the files it contains (kept in order); errors are said, never hidden.
export async function expandZips(files, drive) {
  const list = [], notes = [];
  for (const f of files) {
    if (!isZip(f)) { list.push(f); continue; }
    try { const r = await unzipToFolder(f, drive); list.push(...r.extracted); notes.push({ zip: f.name, extracted: r.extracted.length, error: r.error || null }); if (!r.extracted.length) list.push(f); }
    catch (e) { notes.push({ zip: f.name, extracted: 0, error: String(e.message || e).slice(0, 80) }); list.push(f); }
  }
  return { files: list, notes };
}
