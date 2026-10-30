import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { canonicalStatus } from './mission-status.js';

// Archiving a finished mission — docs/architecture/01_SPECIFICATION_PRODUIT.md §38-42, 02_ARCHITECTURE_TECHNIQUE.md §66-70.
//   1. Mission Controller: the closing controls (report issued, procedures reviewed and signed, review points cleared, PBC
//      resolved or documented) → MISSION_READY_FOR_ARCHIVE. A blocking control is passed only by a partner, with a reason.
//   2. Orpailleur: the Archive Pass — every file of the mission's folder, read in the Drive (never deleted, never moved):
//      ARCHIVE_MANIFEST (file id, name, version, hash, category, location, last modification, owner) in the mission's
//      own memory folder, plus what is left to look at (temporary, unclassified, still in « pièces reçues »).
//   3. A partner validates the manifest → ARCHIVED: read-only in the application (lib/mission-archive.js assertNotArchived);
//      any later change needs a partner, a reason, and is traced (spec §42).
//   4. A file that changes after archiving → POST_ARCHIVE_CHANGE_DETECTED (spec §70).
// Nothing here moves, renames or deletes a document of the firm.

const q = encodeURIComponent;
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const cut = (v, n) => (v == null ? null : String(v).slice(0, n));
const FOLDER = 'application/vnd.google-apps.folder';
const LEADS = ['owner', 'partner'];
const PREPARERS = ['owner', 'partner', 'manager'];
const OPEN_PBC = ['needed', 'request_pending', 'requested', 'complement_pending', 'complement_requested', 'reply_received', 'reply_without_piece', 'to_confirm'];
export const MANIFEST_PREFIX = 'ARCHIVE_MANIFEST';
export const ARCHIVE_STATE_FILE = 'OFFICE_MANAGER_ARCHIVE_STATE.json';
const MAX_FILES = 3000, MAX_DEPTH = 10;
const nowIso = d => (d.now ? new Date(d.now()) : new Date()).toISOString();

async function missionRow(orgId, missionId, fetchRows) {
  const rows = await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=id,name,client_name,mission_code,status,period_label,drive_folder_id,followups&limit=1`);
  const m = rows?.[0];
  if (!m) throw fail('MISSION_NOT_FOUND', 404);
  return m;
}
const archiveOf = m => m?.followups?.archive || { status: 'none' };
async function saveArchive(orgId, mission, archive, fetchRows, extra = {}) {
  const followups = { ...(mission.followups || {}), archive };
  try {
    await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(mission.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ followups, ...extra }) });
  } catch (e) {
    if (/followups|PGRST204|42703/i.test(String(e?.message || e))) throw fail('MISSION_QUICK_SQL_NOT_INSTALLED', 409);
    throw e;
  }
  mission.followups = followups; Object.assign(mission, extra);
  return archive;
}
async function auditEvent(orgId, ev, d) {
  const fn = d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a));
  await fn(orgId, ev, { fetchRows: d.fetchRows || rest }).catch(() => null);
}
async function emitEvent(orgId, ev, d) {
  const fn = d.emit || (async (...a) => (await import('./event-bus.js')).emit(...a));
  return fn(orgId, ev, { fetchRows: d.fetchRows || rest });
}

// ---- 1. Closing controls (spec §38) ----
export async function archiveReadiness(orgId, missionId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const mission = await missionRow(orgId, missionId, fetchRows);
  const status = canonicalStatus(mission.status);
  const work = await fetchRows(`office_procedure_work?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&select=procedure_code,cycle_code,status,review_points&limit=1000`).catch(e => { throw fail('PROCEDURES_UNREADABLE', 503, { detail: cut(e.message, 120) }); }) || [];
  const pbc = await fetchRows(`office_pbc_requests?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&select=id,document,status&limit=2000`).catch(e => (/PGRST205|42P01|office_pbc_requests/.test(String(e.message)) ? [] : Promise.reject(fail('PBC_UNREADABLE', 503)))) || [];
  const notReviewed = work.filter(w => w.status !== 'reviewed');
  const openPoints = work.flatMap(w => (w.review_points || []).filter(p => p.status !== 'cleared').map(p => ({ procedure: w.procedure_code, text: cut(p.text || p.point, 160) })));
  const openPbc = pbc.filter(r => OPEN_PBC.includes(r.status));
  const checks = [
    { key: 'folder', label: 'Dossier Drive de la mission connu', ok: Boolean(mission.drive_folder_id), overridable: false,
      detail: mission.drive_folder_id ? null : 'Sans dossier, la passe d’archivage ne peut rien lire.' },
    { key: 'report', label: 'Rapport émis', ok: ['report_issued', 'closed', 'archived'].includes(status), overridable: true,
      detail: ['report_issued', 'closed', 'archived'].includes(status) ? null : 'Statut actuel : ' + status },
    { key: 'procedures', label: 'Procédures revues et signées (revues requises)', ok: !notReviewed.length, overridable: true,
      detail: notReviewed.length ? notReviewed.length + ' procédure(s) non signée(s)' : (work.length ? null : 'Aucune procédure enregistrée pour cette mission'),
      items: notReviewed.slice(0, 50).map(w => ({ procedure: w.procedure_code, cycle: w.cycle_code, status: w.status })) },
    { key: 'review_points', label: 'Points de revue levés', ok: !openPoints.length, overridable: true,
      detail: openPoints.length ? openPoints.length + ' point(s) ouvert(s)' : null, items: openPoints.slice(0, 50) },
    { key: 'pbc', label: 'Pièces demandées reçues ou réglées', ok: !openPbc.length, overridable: true,
      detail: openPbc.length ? openPbc.length + ' pièce(s) en attente — à documenter' : null, items: openPbc.slice(0, 50).map(r => ({ document: r.document, status: r.status })) }
  ];
  return { mission: { id: mission.id, name: mission.name, client: mission.client_name, status }, checks, ready: checks.every(c => c.ok), archive: archiveOf(mission) };
}

export async function requestArchive(orgId, missionId, body = {}, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  if (!PREPARERS.includes(account?.role)) throw fail('MANAGER_OR_PARTNER_ONLY', 403);
  const r = await archiveReadiness(orgId, missionId, d);
  const mission = await missionRow(orgId, missionId, fetchRows);
  const cur = archiveOf(mission);
  if (['ready', 'manifest_ready', 'archived'].includes(cur.status)) throw fail('ARCHIVE_ALREADY_' + cur.status.toUpperCase(), 409);
  const reasons = body.overrides && typeof body.overrides === 'object' ? body.overrides : {};
  const failed = r.checks.filter(c => !c.ok);
  const overrides = [];
  for (const c of failed) {
    const reason = String(reasons[c.key] || '').trim();
    if (!c.overridable) throw fail('ARCHIVE_CHECK_BLOCKING', 409, { gaps: [c.key] });
    if (!reason) throw fail('ARCHIVE_CHECKS_NOT_MET', 409, { gaps: failed.map(x => x.key) });
    // Unresolved matters are documented (spec §38): a partner decides, with a reason kept for good.
    if (!LEADS.includes(account.role)) throw fail('PARTNER_REQUIRED_TO_PASS_A_CONTROL', 403, { gaps: [c.key] });
    if (reason.length < 10) throw fail('REASON_TOO_SHORT', 400, { gaps: [c.key] });
    overrides.push({ key: c.key, reason: cut(reason, 600), detail: c.detail });
  }
  const at = nowIso(d), by = account.display_name || account.email;
  const archive = await saveArchive(orgId, mission, { status: 'ready', requested_by: by, requested_at: at, overrides, checks: r.checks.map(c => ({ key: c.key, ok: c.ok, detail: c.detail })) }, fetchRows);
  await emitEvent(orgId, { type: 'MISSION_READY_FOR_ARCHIVE', agent: 'mission-controller', actor: account.email, engagement_id: missionId, object_type: 'mission', object_id: missionId,
    idempotency_key: 'MISSION_READY_FOR_ARCHIVE:' + missionId + ':' + at, payload: { overrides: overrides.length } }, d);
  await auditEvent(orgId, { agent: 'mission-controller', mission_id: missionId, action_type: 'MISSION_READY_FOR_ARCHIVE', status: 'succeeded',
    decision: 'Contrôles de clôture : ' + (overrides.length ? overrides.length + ' passé(s) avec raison : ' + overrides.map(o => o.key).join(', ') : 'tous remplis'), approved_by: cut(by, 120), approved_at: at }, d);
  return { archive };
}

// ---- 2. Archive Pass (spec §40-41, technical §67-68) ----
async function listTree(drive, rootId) {
  const out = [], seenFolders = new Set([rootId]);
  let truncated = false;
  const walk = async (folderId, path, depth) => {
    const kids = await drive.listChildren(folderId);
    for (const f of kids || []) {
      if (out.length >= MAX_FILES) { truncated = true; return; }
      if (f.trashed) continue;
      if (f.mimeType === FOLDER) {
        if (depth < MAX_DEPTH && !seenFolders.has(f.id)) { seenFolders.add(f.id); await walk(f.id, path + '/' + f.name, depth + 1); }
        else if (depth >= MAX_DEPTH) truncated = true;
        continue;
      }
      out.push({ ...f, location: path });
    }
  };
  await walk(rootId, '', 0);
  return { files: out, truncated };
}
const TEMPORARY = /^~\$|^\.~|\.tmp$|\.bak$|^copie de |^copy of |\(\d+\)\.[a-z0-9]+$/i;
export function flagFile(f, known) {
  const flags = [];
  if (TEMPORARY.test(f.name || '')) flags.push('temporaire');
  if (/(^|\/)(PIECES_RECUES|A_RANGER|00_A_REVOIR)/i.test(f.location || '')) flags.push('encore à ranger');
  if (!known) flags.push('non classé');
  return flags;
}
export function manifestRows(mission, files, memoryDocs = []) {
  const byId = new Map((memoryDocs || []).map(doc => [doc.file_id || doc.id, doc]));
  return files.map(f => {
    const doc = byId.get(f.id);
    const owner = f.owners?.[0]?.emailAddress || f.owners?.[0]?.displayName || f.lastModifyingUser?.emailAddress || '';
    return { engagement_id: mission.mission_code || mission.id, client: mission.client_name || '', period: mission.period_label || '',
      file_id: f.id, name: f.name, type: doc?.title || doc?.type || f.mimeType || '', category: doc?.uses?.[0]?.use || doc?.role || doc?.type || '',
      location: f.location || '/', version: f.version != null ? String(f.version) : '', hash: f.md5Checksum || '', modified: f.modifiedTime || '', owner,
      flags: flagFile(f, Boolean(doc)).join(', ') };
  });
}
export async function manifestWorkbook(mission, rows, meta) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('MANIFEST');
  const cols = [['Engagement ID', 'engagement_id'], ['Client', 'client'], ['Période', 'period'], ['File ID', 'file_id'], ['Nom final', 'name'], ['Type de document', 'type'],
    ['Catégorie', 'category'], ['Emplacement', 'location'], ['Version', 'version'], ['Empreinte (MD5 Drive)', 'hash'], ['Dernière modification', 'modified'], ['Propriétaire', 'owner'], ['À regarder', 'flags']];
  ws.addRow(cols.map(c => c[0])).font = { bold: true };
  for (const r of rows) ws.addRow(cols.map(c => r[c[1]]));
  ws.columns.forEach(c => { c.width = 22; });
  const s = wb.addWorksheet('SOURCE');
  for (const [k, v] of Object.entries(meta)) s.addRow([k, v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const digestOf = rows => crypto.createHash('sha256').update(JSON.stringify(rows.map(r => [r.file_id, r.version, r.hash, r.modified]))).digest('hex');

export async function archivePass(orgId, missionId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
  const mission = await missionRow(orgId, missionId, fetchRows);
  const cur = archiveOf(mission);
  if (cur.status !== 'ready') return { ignore: 'archivage non demandé ou déjà passé (' + cur.status + ')' };
  if (!mission.drive_folder_id) throw fail('MISSION_FOLDER_NOT_KNOWN', 409);
  const { files, truncated } = await listTree(drive, mission.drive_folder_id);
  const home = await (d.missionMemoryHome || (await import('./mission-files.js')).missionMemoryHome)(mission, { ...d, fetchRows });
  if (!home) throw fail('MISSION_MEMORY_FOLDER_UNKNOWN', 409);
  // The agents' own files (memory, previous manifests) are not part of the client's record.
  const record = files.filter(f => f.parents?.[0] !== home && !String(f.name || '').startsWith(MANIFEST_PREFIX) && f.name !== ARCHIVE_STATE_FILE);
  const docs = await (d.missionDocuments || (await import('./mission-files.js')).missionDocuments)(missionId, d).catch(() => []);
  const rows = manifestRows(mission, record, docs);
  const at = nowIso(d), stamp = at.replace(/[-:]/g, '').slice(0, 15);
  const counts = { files: rows.length, temporary: rows.filter(r => r.flags.includes('temporaire')).length, to_file: rows.filter(r => r.flags.includes('encore à ranger')).length,
    unclassified: rows.filter(r => r.flags.includes('non classé')).length, without_hash: rows.filter(r => !r.hash).length };
  const buffer = await manifestWorkbook(mission, rows, { mission: mission.name, client: mission.client_name, engagement_id: mission.mission_code || mission.id, period: mission.period_label,
    produit_le: at, par: 'Orpailleur (passe d’archivage)', fichiers: rows.length, liste_incomplete: truncated ? 'oui (plus de ' + MAX_FILES + ' fichiers ou dossiers trop profonds)' : 'non', empreinte_du_manifeste: digestOf(rows) });
  // A new file each pass, never over an earlier manifest.
  const name = `${MANIFEST_PREFIX}_${stamp}.xlsx`;
  const created = await drive.createBinary({ name, parentId: home, buffer, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const check = created?.id ? await drive.getMeta(created.id).catch(() => null) : null;
  if (!check?.id) throw fail('MANIFEST_NOT_VERIFIED', 502);
  // What is frozen: one line per file (id → version, hash, date), kept with the mission's memory, for the post-archive check.
  const frozen = Object.fromEntries(rows.map(r => [r.file_id, { v: r.version, h: r.hash, m: r.modified, n: r.name }]));
  const { saveJsonFile } = d.saveJsonFile ? { saveJsonFile: d.saveJsonFile } : await import('./mapping-scan.js');
  const prev = await (d.findState || (async () => (await drive.findFilesByExactName(ARCHIVE_STATE_FILE, home).catch(() => []))?.[0] || null))();
  await saveJsonFile(ARCHIVE_STATE_FILE, drive, home, prev?.id || null, { mission_id: missionId, produced_at: at, manifest_file_id: created.id, files: frozen, truncated });
  const archive = await saveArchive(orgId, mission, { ...cur, status: 'manifest_ready', manifest: { file_id: created.id, name, url: check.webViewLink || null, at, digest: digestOf(rows), ...counts, truncated } }, fetchRows);
  await auditEvent(orgId, { agent: 'orpailleur', mission_id: missionId, action_type: 'ARCHIVE_MANIFEST_PRODUCED', status: 'succeeded',
    decision: rows.length + ' fichier(s) ; à regarder : ' + counts.temporary + ' temporaire(s), ' + counts.to_file + ' encore à ranger, ' + counts.unclassified + ' non classé(s)' + (truncated ? ' ; liste incomplète' : ''), output_ref: 'drive:' + created.id }, d);
  return { result: 'manifeste ' + name + ' (' + rows.length + ' fichiers)', archive };
}

// ---- 3. Archive Freeze (spec §42, technical §69) ----
export async function freezeArchive(orgId, missionId, body = {}, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  if (!LEADS.includes(account?.role)) throw fail('PARTNER_ONLY', 403);
  const mission = await missionRow(orgId, missionId, fetchRows);
  const cur = archiveOf(mission);
  if (cur.status !== 'manifest_ready') throw fail(cur.status === 'archived' ? 'ALREADY_ARCHIVED' : 'MANIFEST_NOT_READY', 409);
  // The partner validates THIS manifest (the one they saw), not a later one.
  if (String(body.manifest_file_id || '') !== String(cur.manifest?.file_id || '')) throw fail('MANIFEST_CHANGED_RELOAD', 409);
  const at = nowIso(d), by = account.display_name || account.email;
  const archive = await saveArchive(orgId, mission, { ...cur, status: 'archived', archived_by: by, archived_at: at, previous_status: canonicalStatus(mission.status), changes: [] }, fetchRows, { status: 'archived' });
  await emitEvent(orgId, { type: 'MISSION_ARCHIVED', agent: 'mission-controller', actor: account.email, engagement_id: missionId, object_type: 'mission', object_id: missionId,
    idempotency_key: 'MISSION_ARCHIVED:' + missionId + ':' + cur.manifest.file_id, payload: { manifest_file_id: cur.manifest.file_id } }, d);
  await auditEvent(orgId, { agent: 'mission-controller', mission_id: missionId, action_type: 'MISSION_ARCHIVED', status: 'succeeded',
    decision: 'Manifeste validé (' + (cur.manifest.files || 0) + ' fichiers) ; dossier en lecture seule dans l’application', approved_by: cut(by, 120), approved_at: at, output_ref: 'drive:' + cur.manifest.file_id }, d);
  return { archive };
}

// Read-only after archiving (spec §42): a write on an archived mission is refused, unless a partner gives a reason —
// then it is traced (who, why, when). Cached a few seconds: one read per write at most.
const lockCache = new Map();
export async function archivedStatus(orgId, missionId, d = {}) {
  const key = orgId + '|' + missionId, hit = lockCache.get(key);
  if (hit && hit.until > Date.now()) return hit.archived;
  let archived = false;
  try {
    const rows = await (d.fetchRows || rest)(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=status&limit=1`);
    archived = canonicalStatus(rows?.[0]?.status) === 'archived';
  } catch { archived = false; } // the access checks already read the mission; a read failure here does not lock a live mission
  lockCache.set(key, { archived, until: Date.now() + 10_000 });
  if (lockCache.size > 2000) lockCache.delete(lockCache.keys().next().value);
  return archived;
}
export async function assertNotArchived(orgId, missionId, req, d = {}) {
  if (!missionId || !(await archivedStatus(orgId, missionId, d))) return null;
  const reason = String(req?.body?.post_archive_reason || '').trim();
  if (!reason) throw fail('MISSION_ARCHIVED', 423);
  if (!LEADS.includes(req?.account?.role)) throw fail('MISSION_ARCHIVED_PARTNER_ONLY', 423);
  if (reason.length < 10) throw fail('REASON_TOO_SHORT', 400);
  await auditEvent(orgId, { agent: 'mission-controller', mission_id: missionId, action_type: 'POST_ARCHIVE_CHANGE_APPROVED', status: 'succeeded',
    decision: cut(String(req?.query?.route || '') + ' : ' + reason, 300), approved_by: cut(req.account.display_name || req.account.email, 120), approved_at: new Date().toISOString() }, d);
  return { approved_by: req.account.email, reason };
}
export function _resetArchiveLockCache() { lockCache.clear(); }

// ---- 4. Post-archive monitoring (technical §70) ----
export function compareFrozen(frozen, files) {
  const now = new Map(files.map(f => [f.id, f]));
  const changes = [];
  for (const [id, was] of Object.entries(frozen || {})) {
    const f = now.get(id);
    if (!f) changes.push({ kind: 'missing', file_id: id, name: was.n });
    else if ((was.h && f.md5Checksum && was.h !== f.md5Checksum) || (was.m && f.modifiedTime && was.m !== f.modifiedTime)) changes.push({ kind: 'changed', file_id: id, name: f.name, modified: f.modifiedTime, by: f.lastModifyingUser?.emailAddress || null });
  }
  for (const f of files) if (!frozen?.[f.id]) changes.push({ kind: 'added', file_id: f.id, name: f.name, modified: f.modifiedTime });
  return changes;
}
export async function postArchiveCheck(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
  const today = nowIso(d).slice(0, 10);
  const missions = (await fetchRows(`office_missions?org_id=eq.${q(orgId)}&status=eq.archived&select=id,name,client_name,mission_code,status,drive_folder_id,followups&limit=200`).catch(() => [])) || [];
  const out = [];
  for (const mission of missions.filter(m => archiveOf(m).status === 'archived' && archiveOf(m).checked_on !== today).slice(0, 5)) {
    try {
      const home = await (d.missionMemoryHome || (await import('./mission-files.js')).missionMemoryHome)(mission, { ...d, fetchRows });
      const stateFile = home ? (await drive.findFilesByExactName(ARCHIVE_STATE_FILE, home).catch(() => []))?.[0] : null;
      if (!stateFile) { out.push({ mission_id: mission.id, skipped: 'ARCHIVE_STATE_NOT_FOUND' }); continue; }
      const state = JSON.parse(Buffer.from(await drive.downloadBuffer(stateFile.id)).toString('utf8'));
      const { files } = await listTree(drive, mission.drive_folder_id);
      const record = files.filter(f => f.parents?.[0] !== home);
      const changes = compareFrozen(state.files, record);
      for (const c of changes) {
        await emitEvent(orgId, { type: 'POST_ARCHIVE_CHANGE_DETECTED', agent: 'orpailleur', engagement_id: mission.id, object_type: 'file', object_id: c.file_id,
          idempotency_key: 'POST_ARCHIVE_CHANGE_DETECTED:' + mission.id + ':' + c.file_id + ':' + c.kind + ':' + (c.modified || ''), payload: c }, d); // recorded; read in the mission's archive card and the audit log
      }
      if (changes.length) await auditEvent(orgId, { agent: 'orpailleur', mission_id: mission.id, action_type: 'POST_ARCHIVE_CHANGE_DETECTED', status: 'needs_review',
        decision: changes.length + ' changement(s) après archivage : ' + changes.slice(0, 5).map(c => c.kind + ' ' + c.name).join(' ; ') }, d);
      const cur = archiveOf(mission);
      await saveArchive(orgId, mission, { ...cur, checked_on: today, changes: [...(cur.changes || []), ...changes.map(c => ({ ...c, seen_on: today }))].slice(-200) }, fetchRows);
      out.push({ mission_id: mission.id, changes: changes.length });
    } catch (e) { out.push({ mission_id: mission.id, error: cut(e.message || e, 160) }); }
  }
  return { checked: out.length, results: out };
}

// Orpailleur: its events (the archive pass), then the daily post-archive check. Called by the scheduled tick.
export async function handleArchiveEvents(orgId, d = {}) {
  const { dispatch } = d.dispatch ? { dispatch: d.dispatch } : await import('./event-bus.js');
  const events = await dispatch(orgId, 'orpailleur', { MISSION_READY_FOR_ARCHIVE: ev => archivePass(orgId, ev.engagement_id || ev.object_id, d) }, d);
  const monitoring = await postArchiveCheck(orgId, d);
  return { events, monitoring };
}

export async function archiveView(orgId, missionId, d = {}) {
  const r = await archiveReadiness(orgId, missionId, d);
  return { ...r, manifest_prefix: MANIFEST_PREFIX };
}
