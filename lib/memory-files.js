// ONE FILE PER MEMORY, UPDATED IN PLACE (2026-10-19, Paul : « la mémoire disparaît à tout moment ; je suis allé dans sa mémoire, il
// recrée de nouveaux documents au lieu de mettre à jour les anciens ; même la cartographie se refait quand elle est valide »).
//
// Cause, for every agent: a memory file is found by a Drive SEARCH by name (findFilesByExactName). That search can miss a file that
// exists — Drive search is eventually consistent (a file just written may not be listed yet), and a failed search was read as
// « no file ». Then the agent started from an EMPTY state and CREATED a second file with the same name. The next search returned the
// copies in any order, so the memory flapped between the full one and the empty one (map redone, lessons gone, methodology gone…).
//
// Rules, applied at the single Drive adapter so that every agent gets them:
//  1. A memory file that was created is remembered BY ITS ID (in the firm's settings, per Drive): when the search finds nothing, the
//     id is checked directly (strongly consistent); the file is found again instead of being recreated.
//  2. Creating a memory file is refused when one already exists (remembered id alive, or found by a second search), or when the search
//     cannot be done — the agent stops this time (MEMORY_FILE_EXISTS / MEMORY_LOOKUP_FAILED) rather than starting from nothing.
//  3. Several copies with the same name: the richest recent one comes first (never an almost empty restart), always the same one.
// Nothing is deleted.
import { rest } from './supabase.js';
import { firmOrgId, firmDriveId } from './google-connection.js';
// Firm settings: strict read, change applied on the current row (audit 2026-10-30).
const changeSettings = async (...a) => (await import('./firm-settings-store.js')).changeFirmSettings(...a);

export const MEMORY_NAME = /^(OFFICE_MANAGER_[\w.-]+\.(json|xlsx)|SHADOW_LAB\.json|ORPAILLEUR_JOURNAL\.xlsx|[A-Z_]+_MEMORY\.json|.+ — mémoire client\.json)$/;
export const isMemoryName = name => MEMORY_NAME.test(String(name || '')) && !/_ANCIENNE_COPIE_/.test(String(name || ''));

const cache = new Map();   // `${drive}|${parent}|${name}` -> id (this process)
const keyOf = (parent, name) => String(parent) + '|' + String(name);
const timeout = (promise, ms, code) => Promise.race([
  Promise.resolve(promise),
  new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(code), { code })), ms))
]);

async function settingsRow(orgId, fetchRows) {
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + encodeURIComponent(orgId) + '&select=settings&limit=1');
  return rows?.[0]?.settings || {};
}
export async function rememberedId(parent, name, d = {}) {
  const drive = d.driveId ?? firmDriveId() ?? 'drive', k = drive + '|' + keyOf(parent, name);
  if (cache.has(k)) return cache.get(k);
  const orgId = d.orgId ?? firmOrgId(); if (!orgId) return null;
  const s = await settingsRow(orgId, d.fetchRows || rest).catch(() => null);
  const id = s?.memory_files?.[drive]?.[keyOf(parent, name)] || null;
  if (id) cache.set(k, id);
  return id;
}
export async function rememberId(parent, name, id, d = {}) {
  const drive = d.driveId ?? firmDriveId() ?? 'drive';
  cache.set(drive + '|' + keyOf(parent, name), id);
  const orgId = d.orgId ?? firmOrgId(); if (!orgId) return;
  const fetchRows = d.fetchRows || rest;
  // Several memory files are remembered at once (two agents, one pass): each pointer is added to the row as it is
  // when written, never over another one written meanwhile (audit 2026-10-30).
  await changeSettings(orgId, s => {
    const mf = { ...(s.memory_files || {}) }; mf[drive] = { ...(mf[drive] || {}), [keyOf(parent, name)]: id };
    return { ...s, memory_files: mf };
  }, { fetchRows }).catch(() => null);
}

// The richest recent copy first: most recent among those at least 30 % of the biggest; then the others.
export function orderCopies(files) {
  const size = f => Number(f?.size) || 0;
  const max = Math.max(0, ...files.map(size));
  const big = f => !max || size(f) >= max * 0.3;
  return [...files].sort((a, b) => (big(b) - big(a)) || String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')) || size(b) - size(a));
}

// Wraps a Drive adapter's lookup and creation (see rules above).
export function guardMemory(adapter, d = {}) {
  return {
    ...adapter,
    async findFilesByExactName(name, parentId) {
      if (!isMemoryName(name)) return adapter.findFilesByExactName(name, parentId);

      // Fast path: a remembered file id is strongly consistent and avoids a Drive-wide search.
      // Supabase is only an index here, never allowed to keep an Office Manager screen waiting.
      const remembered = await timeout(rememberedId(parentId, name, d), 1500, 'MEMORY_INDEX_TIMEOUT').catch(() => null);
      if (remembered) {
        const meta = await timeout(adapter.getMeta(remembered), 5000, 'MEMORY_METADATA_TIMEOUT').catch(() => null);
        if (meta && !meta.trashed && (meta.parents || []).includes(parentId)) return [{ ...meta, id: meta.id || remembered, name: meta.name || name }];
      }

      // Search remains the recovery path, but a transient Google stall must not consume Vercel's
      // whole 300 s invocation. The caller gets a clear retryable error instead of « Chargement… » forever.
      let found;
      try { found = await timeout(adapter.findFilesByExactName(name, parentId), 10000, 'MEMORY_LOOKUP_TIMEOUT'); }
      catch (e) { throw Object.assign(new Error('MEMORY_LOOKUP_FAILED: ' + name + ' — ' + String(e.code || e.message || e)), { statusCode: 503, code: 'MEMORY_LOOKUP_FAILED' }); }
      if (!found?.length) return [];

      const ordered = orderCopies(found);
      // Remembering the id is an optimisation only. Never block the actual read on this bookkeeping.
      void timeout(rememberId(parentId, name, ordered[0].id, d), 1500, 'MEMORY_INDEX_WRITE_TIMEOUT').catch(() => null);
      return ordered;
    },
    async createBinary(args) {
      if (args?.parentId && isMemoryName(args.name)) {
        const id = await timeout(rememberedId(args.parentId, args.name, d), 1500, 'MEMORY_INDEX_TIMEOUT').catch(() => null);
        if (id) {
          const meta = await timeout(adapter.getMeta(id), 5000, 'MEMORY_METADATA_TIMEOUT').catch(() => null);
          if (meta && !meta.trashed && (meta.parents || []).includes(args.parentId)) throw Object.assign(new Error('MEMORY_FILE_EXISTS: ' + args.name + ' existe déjà — mise à jour en place, jamais un second fichier'), { statusCode: 409, code: 'MEMORY_FILE_EXISTS', file_id: id });
        }
        let again;
        try { again = await timeout(adapter.findFilesByExactName(args.name, args.parentId), 10000, 'MEMORY_LOOKUP_TIMEOUT'); }
        catch { throw Object.assign(new Error('MEMORY_LOOKUP_FAILED: ' + args.name + ' — recherche impossible, rien n’est créé'), { statusCode: 503, code: 'MEMORY_LOOKUP_FAILED' }); }
        if (again?.length) throw Object.assign(new Error('MEMORY_FILE_EXISTS: ' + args.name), { statusCode: 409, code: 'MEMORY_FILE_EXISTS', file_id: again[0].id });
      }
      const created = await adapter.createBinary(args);
      if (created?.id && isMemoryName(args?.name)) void timeout(rememberId(args.parentId, args.name, created.id, d), 1500, 'MEMORY_INDEX_WRITE_TIMEOUT').catch(() => null);
      return created;
    }
  };
}
