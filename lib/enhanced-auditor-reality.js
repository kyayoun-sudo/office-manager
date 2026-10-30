import { rest } from './supabase.js';
import { searchDriveFiles } from './google-drive.js';
import { missionDocuments, recordMissionDocuments } from './mission-files.js';
import { syncInventoryMissionDocuments } from './inventory-mission-sync.js';
import { reconcileMissionMemoryCopies } from './mission-memory-copy-sync.js';

const q = encodeURIComponent;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const INTERNAL_FOLDERS = new Set(['_OFFICE_MANAGER', '00_OFFICE_MANAGER']);

function problem(status) {
  return ['partial', 'failed'].includes(String(status || '').toLowerCase());
}

function auditReadMatchesModifiedTime(doc, modifiedTime) {
  if (!modifiedTime || !doc?.audit_read?.revision) return false;
  return String(doc.audit_read.revision).startsWith(String(modifiedTime) + '|');
}

export async function scanMissionDrive(rootId, d = {}) {
  const search = d.searchDriveFiles || searchDriveFiles;
  const queue = [{ id: rootId, path: '' }];
  const files = [];
  const seenFolders = new Set();
  let possiblyTruncated = false;

  while (queue.length) {
    const current = queue.shift();
    if (!current?.id || seenFolders.has(current.id)) continue;
    seenFolders.add(current.id);
    if (seenFolders.size > 2000) throw new Error('MISSION_REALITY_SCAN_TOO_LARGE');

    const children = await search({ parentId: current.id, limit: 100 });
    if ((children || []).length >= 100) possiblyTruncated = true;

    for (const child of children || []) {
      if (!child?.id) continue;
      const name = String(child.name || child.id);
      const path = current.path ? current.path + '/' + name : name;
      if (child.mimeType === FOLDER_MIME) {
        if (INTERNAL_FOLDERS.has(name)) continue;
        queue.push({ id: child.id, path });
        continue;
      }
      files.push({
        id: child.id,
        name,
        path,
        parent_id: current.id,
        mimeType: child.mimeType || null,
        modifiedTime: child.modifiedTime || null,
        webViewLink: child.webViewLink || null,
        size: child.size == null ? null : Number(child.size)
      });
      if (files.length > 10000) throw new Error('MISSION_REALITY_SCAN_TOO_LARGE');
    }
  }

  return { files, folders: seenFolders.size, possibly_truncated: possiblyTruncated };
}

export async function hydrateEnhancedAuditorReality(orgId, missionId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const readMissionDocuments = d.missionDocuments || missionDocuments;
  const record = d.recordMissionDocuments || recordMissionDocuments;
  const syncInventory = d.syncInventoryMissionDocuments || syncInventoryMissionDocuments;
  const syncCopies = d.reconcileMissionMemoryCopies || reconcileMissionMemoryCopies;
  const scan = d.scanMissionDrive || scanMissionDrive;

  const [mission] = await fetchRows(
    'office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) +
    '&select=id,name,mission_code,drive_folder_id,org_id&limit=1'
  ) || [];

  if (!mission) return { ok: false, reason: 'MISSION_NOT_FOUND', mission_id: missionId };
  if (!mission.drive_folder_id) return { ok: false, reason: 'MISSION_DRIVE_FOLDER_UNKNOWN', mission_id: missionId };

  const before = await readMissionDocuments(missionId, { ...d, orgId }).catch(() => []);
  const beforeById = new Map((before || []).filter(x => x?.id).map(x => [String(x.id), x]));

  let driveScan;
  try {
    driveScan = await scan(mission.drive_folder_id, d.driveScanDeps || d);
  } catch (error) {
    return {
      ok: false,
      reason: 'MISSION_REALITY_DRIVE_SCAN_FAILED',
      mission_id: missionId,
      error: String(error?.message || error).slice(0, 300)
    };
  }

  const repair = [];
  let contentChanged = false;
  for (const file of driveScan.files || []) {
    const existing = beforeById.get(String(file.id));
    const moved = Boolean(existing?.folder_id && file.parent_id && String(existing.folder_id) !== String(file.parent_id));
    const locationUnknown = Boolean(existing && !existing.folder_id && !existing.path && !existing.location);
    const needsRepair = !existing || existing.name !== file.name || moved || locationUnknown;

    if (needsRepair) {
      repair.push({
        id: file.id,
        name: file.name,
        // Do not replace a trusted Orpailleur full path with our relative scan path unless
        // the file is new or we have proof that its parent changed.
        path: !existing || moved ? file.path : (existing.path || file.path),
        url: file.webViewLink || existing?.url || null,
        role: existing?.role || 'piece_recue',
        location: !existing || moved ? file.path : (existing.location || file.path),
        folder_id: file.parent_id,
        source: 'enhanced_auditor_reality_scan',
        event_id: file.modifiedTime || existing?.event_id || null,
        event: {
          agent: 'enhanced-auditor',
          what: existing ? 'mission_reality_location_refreshed' : 'mission_reality_file_discovered',
          detail: existing
            ? 'La réalité Drive de la mission a été réconciliée avant le raisonnement.'
            : 'Fichier présent dans le dossier de mission découvert avant le raisonnement.'
        }
      });
    }

    // A known physical file without a reading receipt, or whose Drive modification time no
    // longer matches the receipt, forces the review back through knowledge. Unchanged files
    // are then reused by learnAuditDocument() without another AI read.
    if (existing && !existing.audit_read) contentChanged = true;
    else if (existing?.audit_read && file.modifiedTime && !auditReadMatchesModifiedTime(existing, file.modifiedTime)) contentChanged = true;
  }

  if (repair.length) {
    try {
      await record(mission, repair, { ...d, orgId, fetchRows });
    } catch (error) {
      return {
        ok: false,
        reason: 'MISSION_REALITY_REGISTER_REPAIR_FAILED',
        mission_id: missionId,
        error: String(error?.message || error).slice(0, 300)
      };
    }
  }

  const inventorySync = await syncInventory(orgId, { ...(d.inventorySyncDeps || {}), missionId });
  if (problem(inventorySync?.status)) {
    return {
      ok: false,
      reason: 'MISSION_REALITY_INVENTORY_SYNC_' + String(inventorySync.status || 'UNKNOWN').toUpperCase(),
      mission_id: missionId,
      inventory_sync: inventorySync
    };
  }

  const memoryCopySync = await syncCopies(orgId, { ...(d.memoryCopySyncDeps || {}), missionId });
  if (problem(memoryCopySync?.status)) {
    return {
      ok: false,
      reason: 'MISSION_REALITY_MEMORY_COPY_' + String(memoryCopySync.status || 'UNKNOWN').toUpperCase(),
      mission_id: missionId,
      memory_copy_sync: memoryCopySync
    };
  }

  const documents = await readMissionDocuments(missionId, { ...d, orgId }).catch(() => []);
  const registered = new Set((documents || []).map(x => String(x?.id || '')).filter(Boolean));
  const physical = new Set((driveScan.files || []).map(x => String(x.id)));
  const missingFromMemory = [...physical].filter(id => !registered.has(id));

  if (missingFromMemory.length) {
    return {
      ok: false,
      reason: 'MISSION_REALITY_MEMORY_MISMATCH',
      mission_id: missionId,
      missing_file_ids: missingFromMemory.slice(0, 50),
      physical_files: physical.size,
      remembered_files: registered.size
    };
  }

  return {
    ok: true,
    mission,
    documents,
    drive_scan: {
      files: physical.size,
      folders: driveScan.folders || 0,
      possibly_truncated: Boolean(driveScan.possibly_truncated)
    },
    inventory_sync: inventorySync,
    memory_copy_sync: memoryCopySync,
    changed: Boolean(
      repair.length ||
      contentChanged ||
      Number(inventorySync?.missing || 0) ||
      Number(inventorySync?.changed || 0) ||
      Number(memoryCopySync?.synced || 0)
    ),
    repaired_files: repair.length,
    content_changed: contentChanged
  };
}
