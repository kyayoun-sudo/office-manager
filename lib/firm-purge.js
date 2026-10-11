// ERASING A FIRM'S SPACE (Paul, 2026-10-11: « quand je ferme mon compte, je veux que toutes les données du
// cabinet partent ; quand je recrée un compte, je recommence une configuration nouvelle et je remplis ce qu'il
// y a à remplir »). Called when the LAST owner closes the firm's space (explicit confirmation), or when the
// former owner of a space closed before this rule restarts it (explicit confirmation too).
//
// What goes:
//   1. Office Manager's database rows of this firm — every office_* / orpailleur_* / taty_* table with an
//      org_id (missions, people, opportunities, decisions, audit log, Google connection, Drive choice,
//      settings, accounts…), through ONE SQL function (db/purge.sql): the backend itself cannot delete.
//   2. The agents' memory files in the firm's Drive (OFFICE_MANAGER_*.json / .xlsx, SHADOW_LAB.json, the
//      Orpailleur's journal, MEMORY / AGENTS / CLIENTS folders): put in the Drive's bin (recoverable 30 days),
//      so the same Drive chosen again starts with a blank memory.
//   3. The firm's login accounts (Supabase Auth), unless the same person also belongs to another firm.
// What stays: the firm's own documents in its Drive (client files, working papers, reports…) — they belong
// to the firm, never to Office Manager — and the firm's identity row (office_organizations).
// Order: a dry run first (the SQL function must be installed: otherwise NOTHING is erased), then the Drive
// memory, then the database, then the accounts. One audit line records the erasure in the new, empty space.

import { rest } from './supabase.js';

const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const q = encodeURIComponent;
const cut = (s, n) => String(s ?? '').slice(0, n);
const FOLDER = 'application/vnd.google-apps.folder';
// Files and folders the agents create in their memory folder (and only those).
export const AGENT_MEMORY_NAME = /^(OFFICE_MANAGER_[\w.-]+|SHADOW_LAB\.json|ORPAILLEUR_[\w.-]+|[A-Z_]+_MEMORY\.json|PIPELINE_APPELS_OFFRES\.xlsx|MEMORY|AGENTS|CLIENTS)$/;

async function rpcPurge(orgId, dryRun, fetchRows) {
  try {
    return await fetchRows('rpc/office_purge_firm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_org: orgId, p_confirm: 'EFFACER ' + orgId, p_dry_run: dryRun }) });
  } catch (e) {
    if (/PGRST202|office_purge_firm|could not find the function|404/i.test(String(e?.message || e))) throw fail('PURGE_SQL_NOT_INSTALLED', 409);
    throw e;
  }
}

// The agents' memory files in the Drive → bin. Never a file the agents did not create, never the Drive root.
export async function binAgentMemory(orgId, d = {}) {
  const g = d.google || await import('./google-connection.js');
  try { await g.loadGoogleConnection(orgId, d); await g.loadFirmDrive(orgId, d); } catch { /* reported below */ }
  if (!g.connectedGoogle()) return { binned: [], skipped: 'GOOGLE_NOT_CONNECTED' };
  const memId = g.firmMemoryId();
  const root = g.firmDriveId();
  if (!memId || memId === root) return { binned: [], skipped: 'NO_SEPARATE_MEMORY_FOLDER' };
  const token = await g.connectionAccessToken(d);
  const fetchImpl = d.fetchImpl || fetch;
  const H = { Authorization: 'Bearer ' + token };
  const list = await fetchImpl('https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q: "'" + memId + "' in parents and trashed = false",
    fields: 'files(id,name,mimeType)', pageSize: '200', corpora: 'allDrives', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' }), { headers: H }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!list) return { binned: [], skipped: 'MEMORY_FOLDER_NOT_READABLE' };
  const binned = [], failed = [];
  for (const f of list.files || []) {
    if (!AGENT_MEMORY_NAME.test(f.name || '')) continue;
    if (f.mimeType === FOLDER && !/^(MEMORY|AGENTS|CLIENTS)$/.test(f.name)) continue;
    const r = await fetchImpl('https://www.googleapis.com/drive/v3/files/' + q(f.id) + '?supportsAllDrives=true&fields=id,trashed', { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }).catch(() => null);
    (r?.ok ? binned : failed).push(f.name);
  }
  return { binned, failed, folder: memId };
}

export async function purgeFirm(orgId, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  if (!orgId) throw fail('ORG_REQUIRED', 400);
  // 0. Nothing is erased unless the SQL function is there (dry run = counts only).
  const dry = await rpcPurge(orgId, true, fetchRows);
  const users = await fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&select=auth_user_id,email&limit=1000').catch(() => []) || [];
  // 1. The agents' memory in the Drive (needs the Google connection, erased in step 2).
  let drive;
  try { drive = await (d.binAgentMemory || binAgentMemory)(orgId, d); } catch (e) { drive = { binned: [], error: cut(e.message, 120) }; }
  try { await (d.disconnectGoogle || (await import('./google-connection.js')).disconnectGoogle)(orgId, d); } catch { /* the row is erased below */ }
  // 2. The database.
  const done = await rpcPurge(orgId, false, fetchRows);
  // 3. Login accounts that belong to no other firm.
  const call = d.authCall || (await import('./accounts.js')).authCall;
  const accounts = { deleted: 0, kept_other_firm: 0, failed: 0 };
  for (const u of users) {
    if (!u.auth_user_id) continue;
    // The person restarting the space keeps their login (they become the owner of the blank space).
    if (d.keepAuthUser && u.auth_user_id === d.keepAuthUser) { accounts.kept_restarting = (accounts.kept_restarting || 0) + 1; continue; }
    const elsewhere = await fetchRows('office_app_users?auth_user_id=eq.' + q(u.auth_user_id) + '&select=org_id&limit=1').catch(() => [{}]) || [];
    if (elsewhere.length) { accounts.kept_other_firm++; continue; }
    const r = await call('admin/users/' + q(u.auth_user_id), { method: 'DELETE', admin: true }).catch(() => ({ status: 0 }));
    if ([200, 204, 404].includes(r.status)) accounts.deleted++; else accounts.failed++;
  }
  // In-process caches of this firm (Google, Drive choice).
  try { const g = await import('./google-connection.js'); g.resetGoogleConnectionCache(); } catch { /* none */ }
  const report = { erased: true, rows: done?.rows || dry?.rows || {}, not_erased: done?.not_erased || [], drive, accounts, by: account?.email || null, at: new Date().toISOString() };
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'office-manager', action_type: 'FIRM_SPACE_ERASED', source_ref: 'firm-space',
    decision: 'Espace du cabinet effacé par ' + (account?.email || '?') + ' : ' + Object.values(report.rows).reduce((s, n) => s + Number(n || 0), 0) + ' ligne(s) de données, ' + (drive?.binned?.length || 0) + ' fichier(s) de mémoire des agents mis à la corbeille du Drive, ' + accounts.deleted + ' compte(s) supprimé(s). Les documents du cabinet dans le Drive sont intacts.', status: 'done' }).catch(() => null);
  return report;
}
