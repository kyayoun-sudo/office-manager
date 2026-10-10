import { rest } from './supabase.js';
import { loadFirmDrive, connectionAccessToken, loadGoogleConnection, connectedGoogle, firmDriveId, firmDriveKind, firmMemoryId, firmHomeId, resetFirmDriveCache } from './google-connection.js';

// THE AGENTS' ONE HOME (Paul, 2026-10-08: « on avait dit qu'il devrait mettre à jour ses fichiers
// mémoire dans 00 TATY AI MANAGER, dans Atelier mémoire, où il allait garder toute sa mémoire. Je
// veux que tous les agents fassent comme ça. Ils ne créent pas de nouveaux Excel, ils mettent à jour »).
// - The home is the firm's « … AI MANAGER » folder (e.g. 00 TATY AI MANAGER) and, inside it, its
//   « Atelier mémoire » folder (created there only if missing). Every agent file lives there.
// - Files an earlier version left elsewhere (00_OFFICE_MANAGER folders, OFFICE_MANAGER_* files at
//   the root, client memories in client folders) are MOVED into the home; a duplicate keeps the
//   most recent copy (the other goes to the bin, recoverable 30 days); a 00_OFFICE_MANAGER folder
//   left empty goes to the bin. Nothing of the firm's own files is touched.

const FOLDER = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3/files';
const q = encodeURIComponent;
export const ATELIER_NAME = 'MEMORY';
export const CLIENTS_SUBFOLDER = 'CLIENTS';
const MANAGER_RE = /(^|[\s_\-])(ai|ia)([\s_\-]|$).*manager|manager.*(^|[\s_\-])(ai|ia)([\s_\-]|$)/i;
// The memory folder inside the AI MANAGER folder: « MEMORY » (or an « Atelier mémoire » already there).
const ATELIER_RE = /atelier|^memory$|^m[ée]moire$/i;
const OLD_SYSTEM = '00_OFFICE_MANAGER';

async function call(fetchImpl, url, H, init = {}) {
  const r = await fetchImpl(url, { ...init, headers: { ...H.headers, ...(init.headers || {}) } });
  if (!r.ok) return null;
  return r.status === 204 ? {} : r.json().catch(() => ({}));
}
function scope(kind, driveId) {
  const p = { includeItemsFromAllDrives: 'true', supportsAllDrives: 'true', pageSize: '200' };
  if (kind === 'drive' && driveId) Object.assign(p, { corpora: 'drive', driveId });
  else Object.assign(p, { corpora: 'allDrives' });
  return p;
}
async function search(fetchImpl, H, query, kind, driveId, fields = 'files(id,name,parents,modifiedTime,mimeType)') {
  const out = []; let token = null, guard = 0;
  do {
    const p = new URLSearchParams({ q: query + ' and trashed = false', fields: 'nextPageToken,' + fields, ...scope(kind, driveId) });
    if (token) p.set('pageToken', token);
    const r = await call(fetchImpl, API + '?' + p, H);
    out.push(...(r?.files || [])); token = r?.nextPageToken || null;
  } while (token && ++guard < 20);
  return out;
}
const children = (fetchImpl, H, parent) => search(fetchImpl, H, "'" + parent + "' in parents", 'all', null);

// The « … AI MANAGER » folder, then its « Atelier mémoire » (found, else created inside it).
export async function findAtelier(H, { kind, driveId, fetchImpl = fetch } = {}) {
  // The drive's top folders first (Drive's word search misses « 00_TATY_AI_MANAGER »), then a search.
  const top = driveId ? (await children(fetchImpl, H, driveId)).filter(f => f.mimeType === FOLDER && MANAGER_RE.test(String(f.name).replace(/_/g, ' '))) : [];
  const found = top.length ? top : (await search(fetchImpl, H, "mimeType = '" + FOLDER + "' and name contains 'manager'", kind, driveId)).filter(f => MANAGER_RE.test(String(f.name).replace(/_/g, ' ')));
  const managers = found;
  // Prefer one at the top of the drive (its parent is the drive itself).
  managers.sort((a, b) => ((b.parents || []).includes(driveId) ? 1 : 0) - ((a.parents || []).includes(driveId) ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
  const manager = managers[0];
  if (!manager) return null;
  const kids = await children(fetchImpl, H, manager.id);
  let atelier = kids.find(c => c.mimeType === FOLDER && ATELIER_RE.test(c.name));
  if (!atelier) {
    atelier = await call(fetchImpl, API + '?supportsAllDrives=true&fields=id,name', H, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ATELIER_NAME, mimeType: FOLDER, parents: [manager.id] }) });
    if (!atelier?.id) return null;
    atelier.created = true;
  }
  return { id: atelier.id, name: atelier.name, created: Boolean(atelier.created), manager: { id: manager.id, name: manager.name } };
}

async function move(fetchImpl, H, file, from, to) {
  return call(fetchImpl, API + '/' + q(file) + '?supportsAllDrives=true&addParents=' + q(to) + (from ? '&removeParents=' + q(from) : '') + '&fields=id', H,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}
async function bin(fetchImpl, H, file) {
  return call(fetchImpl, API + '/' + q(file) + '?supportsAllDrives=true', H, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
}
async function rename(fetchImpl, H, file, name) {
  return call(fetchImpl, API + '/' + q(file) + '?supportsAllDrives=true', H, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}
async function subfolder(fetchImpl, H, parent, name) {
  const kids = await children(fetchImpl, H, parent);
  const f = kids.find(c => c.mimeType === FOLDER && c.name === name);
  if (f) return f.id;
  return (await call(fetchImpl, API + '?supportsAllDrives=true&fields=id', H, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) }))?.id || null;
}

// Moves the content of `fromFolder` into `toFolder` (files and sub-folders, merged by name).
async function mergeInto(fetchImpl, H, fromFolder, toFolder, report, depth = 0) {
  if (!fromFolder || fromFolder === toFolder || depth > 4) return;
  const there = await children(fetchImpl, H, toFolder);
  for (const c of await children(fetchImpl, H, fromFolder)) {
    const same = there.find(t => t.name === c.name && (t.mimeType === FOLDER) === (c.mimeType === FOLDER));
    if (c.mimeType === FOLDER && same) { await mergeInto(fetchImpl, H, c.id, same.id, report, depth + 1); await binIfEmpty(fetchImpl, H, c.id, report); continue; }
    if (same) {
      // Same file twice: the most recent copy stays (moved in if needed), the other goes to the bin.
      if (String(c.modifiedTime) > String(same.modifiedTime)) { await bin(fetchImpl, H, same.id); await move(fetchImpl, H, c.id, fromFolder, toFolder); report.moved.push(c.name); }
      else await bin(fetchImpl, H, c.id);
      report.binned.push(c.name);
      continue;
    }
    if (await move(fetchImpl, H, c.id, fromFolder, toFolder)) report.moved.push(c.name);
  }
}
async function binIfEmpty(fetchImpl, H, folder, report) {
  const left = await children(fetchImpl, H, folder);
  if (!left.length && await bin(fetchImpl, H, folder)) report.emptied.push(folder);
}

// Brings every agent file into the home. Returns what was moved / binned.
// The agents' own folders (reports, audit log, drop folder, trainings): they live in the HOME,
// beside MEMORY (Paul, 2026-10-08: « un dossier MEMORY, capacités du cabinet, un audit log, dans TATY AI MANAGER »).
export const AGENT_FOLDERS = ['A_RANGER', 'AUDIT LOGS', 'AUDIT LOG', 'EVALUATION_DES_RISQUES', 'PREPARATION_DES_MISSIONS', 'ENHANCED_AUDITOR', 'SUIVI_DES_SOUMISSIONS', 'CAPACITES_DU_CABINET', 'ANALYSES_DES_DEPOTS'];
const TRAINING_RE = /^ENTRAINEMENT_AUDIT_OFFICE_MANAGER/;

export async function gatherInto(atelierId, H, { kind, driveId, oldMemory = null, homeId = null, fetchImpl = fetch } = {}) {
  const report = { moved: [], binned: [], emptied: [], clients: [] };
  // 0. Where an earlier version worked (the drive root, the old memory folder): its folders go home.
  if (homeId) {
    for (const place of [...new Set([driveId, oldMemory].filter(x => x && x !== homeId && x !== atelierId))]) {
      for (const c of await children(fetchImpl, H, place)) {
        if (c.mimeType !== FOLDER) continue;
        if (c.name === 'MEMORY' && c.id !== atelierId) { await mergeInto(fetchImpl, H, c.id, atelierId, report); await binIfEmpty(fetchImpl, H, c.id, report); continue; }
        if (TRAINING_RE.test(c.name)) { const t = await subfolder(fetchImpl, H, homeId, 'ENTRAINEMENT'); if (t && await move(fetchImpl, H, c.id, place, t)) report.moved.push(c.name); continue; }
        if (!AGENT_FOLDERS.includes(c.name)) continue;
        const there = (await children(fetchImpl, H, homeId)).find(t => t.mimeType === FOLDER && t.name === c.name);
        if (there) { await mergeInto(fetchImpl, H, c.id, there.id, report); await binIfEmpty(fetchImpl, H, c.id, report); }
        else if (await move(fetchImpl, H, c.id, place, homeId)) report.moved.push(c.name);
      }
    }
    // The old per-agent file of the Orpailleur: its follow-up now lives in TIDY_STATE.
    for (const f of await search(fetchImpl, H, "name = 'ORPAILLEUR_MEMORY.json'", kind, driveId)) { await bin(fetchImpl, H, f.id); report.binned.push(f.name); }
  }
  // 1. The previous memory folder (00_OFFICE_MANAGER, or the drive root used as memory).
  if (oldMemory && oldMemory !== atelierId) {
    const meta = await call(fetchImpl, API + '/' + q(oldMemory) + '?supportsAllDrives=true&fields=id,name,mimeType', H);
    if (meta?.name === OLD_SYSTEM) { await mergeInto(fetchImpl, H, oldMemory, atelierId, report); await binIfEmpty(fetchImpl, H, oldMemory, report); }
  }
  // 2. Agent files left anywhere (OFFICE_MANAGER_* at the root or elsewhere).
  for (const f of await search(fetchImpl, H, "name contains 'OFFICE_MANAGER_'", kind, driveId)) {
    if (f.mimeType === FOLDER || (f.parents || []).includes(atelierId) || !/^OFFICE_MANAGER_/.test(f.name)) continue;
    const there = (await children(fetchImpl, H, atelierId)).find(t => t.name === f.name);
    if (there) { if (String(f.modifiedTime) > String(there.modifiedTime)) { await bin(fetchImpl, H, there.id); await move(fetchImpl, H, f.id, (f.parents || [])[0], atelierId); report.moved.push(f.name); } else await bin(fetchImpl, H, f.id); report.binned.push(f.name); }
    else if (await move(fetchImpl, H, f.id, (f.parents || [])[0], atelierId)) report.moved.push(f.name);
  }
  // 3. Other 00_OFFICE_MANAGER folders (e.g. in a client's folder): a client memory goes to
  //    ATELIER MÉMOIRE/CLIENTS under the client's name; the rest is merged into the home.
  const olds = (await search(fetchImpl, H, "mimeType = '" + FOLDER + "' and name = '" + OLD_SYSTEM + "'", kind, driveId)).filter(f => f.id !== atelierId);
  for (const o of olds) {
    const kids = await children(fetchImpl, H, o.id);
    const client = kids.find(k => k.name === 'CLIENT_MEMORY.json');
    if (client) {
      const parent = (o.parents || [])[0];
      const pm = parent ? await call(fetchImpl, API + '/' + q(parent) + '?supportsAllDrives=true&fields=id,name,parents', H) : null;
      // The client's name: the permanent-file folder's parent when the folder is « Dossier permanent ».
      let name = pm?.name || 'Client';
      if (/permanent|(^|[^a-z])dp([^a-z]|$)/i.test(name) && pm?.parents?.[0]) name = (await call(fetchImpl, API + '/' + q(pm.parents[0]) + '?supportsAllDrives=true&fields=name', H))?.name || name;
      const dest = await subfolder(fetchImpl, H, atelierId, CLIENTS_SUBFOLDER);
      if (dest && await move(fetchImpl, H, client.id, o.id, dest)) { await rename(fetchImpl, H, client.id, clientMemoryName(name)); report.clients.push(name); }
    }
    await mergeInto(fetchImpl, H, o.id, atelierId, report);
    await binIfEmpty(fetchImpl, H, o.id, report);
  }
  return report;
}

export const clientMemoryName = name => String(name || 'Client').replace(/[\\/]/g, ' ').trim().slice(0, 120) + ' — mémoire client.json';

// Owner action, and once at each tick until done: the memory moves home if it is not there yet.
let lastCheck = { orgId: null, at: 0 };
export async function ensureMemoryHome(orgId, { force = false, fetchRows = rest, fetchImpl = fetch } = {}) {
  if (!force && lastCheck.orgId === orgId && Date.now() - lastCheck.at < 3600 * 1000) return { skipped: true };
  lastCheck = { orgId, at: Date.now() };
  await loadFirmDrive(orgId, { fetchRows });
  if (!connectedGoogle()) await loadGoogleConnection(orgId, { fetchRows }).catch(() => null);
  if (!connectedGoogle() || !firmDriveId()) return { done: false, reason: 'DRIVE_NOT_CONNECTED' };
  const token = await connectionAccessToken({ fetchImpl });
  const H = { headers: { Authorization: 'Bearer ' + token } };
  const kind = firmDriveKind(), driveId = firmDriveId();
  const current = firmMemoryId();
  if (current && firmHomeId() && !force) {
    const meta = await call(fetchImpl, API + '/' + q(current) + '?supportsAllDrives=true&fields=id,name', H);
    if (meta && ATELIER_RE.test(meta.name || '')) return { done: true, already: true, memory: { id: meta.id, name: meta.name } };
  }
  const atelier = await findAtelier(H, { kind, driveId, fetchImpl });
  if (!atelier) return { done: false, reason: 'AI_MANAGER_FOLDER_NOT_FOUND' };
  const report = await gatherInto(atelier.id, H, { kind, driveId, oldMemory: current || driveId, homeId: atelier.manager.id, fetchImpl });
  // The firm's Drive keeps its root; the memory and the home change ("<root>|m:<memory>|h:<home>").
  const row = (await fetchRows('office_firm_drive?org_id=eq.' + q(orgId) + '&select=drive_id&limit=1'))?.[0];
  if (row?.drive_id) {
    const v = String(row.drive_id);
    const next = (v.startsWith('all:') ? 'all:' + atelier.id : v.split('|')[0] + '|m:' + atelier.id) + '|h:' + atelier.manager.id;
    await fetchRows('office_firm_drive?org_id=eq.' + q(orgId), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ drive_id: next }) });
    resetFirmDriveCache();
    await loadFirmDrive(orgId, { fetchRows });
  }
  return { done: true, memory: { id: atelier.id, name: atelier.name, in: atelier.manager.name, created: atelier.created }, report };
}
