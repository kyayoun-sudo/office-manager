import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, updateJsonFile } from './mapping-scan.js';

// WHAT THE AGENTS READ IN EACH FILE (2026-10-08), for the search: when the Orpailleur reads a file
// (excerpt of its content) it keeps here what the file is — type, client, period, one-sentence
// summary, the first words of its content — so the search finds a document by what it CONTAINS,
// not only by its name. Added next to TIDY_STATE / REGISTER / MAP, which are unchanged.

export const FILE_INDEX = 'OFFICE_MANAGER_FILE_INDEX.json';
const MAX = 6000;
const cut = (s, n) => s == null || s === '' ? null : String(s).slice(0, n);

export async function recordFiles(entries, d = {}) {
  const list = (entries || []).filter(e => e && e.id);
  if (!list.length) return 0;
  await (d.updateJsonFile || updateJsonFile)(FILE_INDEX, st => {
    const s = st || { files: {} };
    const now = new Date().toISOString();
    for (const e of list) {
      const prev = s.files[e.id] || {};
      s.files[e.id] = { id: e.id, name: cut(e.name, 250) || prev.name || null, path: cut(e.path, 600) || prev.path || null, url: e.url || prev.url || null,
        parent: e.parent || prev.parent || null, doc_type: cut(e.doc_type, 80) || prev.doc_type || null, client: cut(e.client, 160) || prev.client || null,
        period: cut(e.period, 40) || prev.period || null, summary: cut(e.summary, 400) || prev.summary || null, excerpt: cut(e.excerpt, 600) || prev.excerpt || null,
        mission_id: e.mission_id || prev.mission_id || null, read_by: e.read_by || prev.read_by || 'orpailleur', read_at: now };
    }
    const keys = Object.keys(s.files);
    if (keys.length > MAX) for (const k of keys.sort((a, b) => String(s.files[a].read_at).localeCompare(String(s.files[b].read_at))).slice(0, keys.length - MAX)) delete s.files[k];
    s.updated_at = now;
    return s;
  }, { drive: d.drive || driveAdapter, folder: d.folder || memoryFolderId() });
  return list.length;
}

export async function loadFileIndex(d = {}) {
  return (await loadJsonFile(FILE_INDEX, d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null }))).state?.files || {};
}
