import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile } from './mapping-scan.js';
import { recordMissionDocuments } from './mission-files.js';

const FILE = 'OFFICE_MANAGER_MISSION_FILES.json';
const q = encodeURIComponent;
const GENERIC_ROLES = new Set(['piece_recue', 'piece_pbc', 'preuve', 'autre']);

function trustedClassification(row = {}) {
  const classification = String(row.classification || '').toUpperCase();
  const decision = String(row.decision_status || '').toUpperCase();
  return Boolean(row.document_type) && classification !== 'UNREVIEWED' && (decision === 'VERIFIED' || ['EXACT', 'COMPONENT', 'SUPPORT', 'PARTIEL', 'CONFORME'].includes(classification));
}

function inventoryPath(row = {}) {
  const folder = String(row.folder_path || '').replace(/\/+$/, '');
  const name = String(row.name || '').replace(/^\/+/, '');
  if (!folder) return name || null;
  if (!name || folder.endsWith('/' + name) || folder === name) return folder;
  return folder + '/' + name;
}

export function inventoryRowToMissionDocument(row = {}) {
  const trusted = trustedClassification(row);
  const details = row.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {};
  const version = row.drive_version || row.document_version || row.modified_at || null;
  return {
    id: row.file_id,
    name: row.name || row.file_id,
    path: inventoryPath(row),
    url: row.web_url || null,
    type: trusted ? row.document_type : null,
    role: trusted ? row.document_type : 'piece_recue',
    period: row.document_period || null,
    summary: details.summary || details.description || row.filing_reason || null,
    by: row.source_channel || 'orpailleur_inventory',
    source: 'orpailleur_inventory',
    event_id: version ? String(version) : null,
    read_status: row.content_verified_at ? 'read' : null,
    read_method: row.content_verified_at ? 'orpailleur_inventory_verified' : null,
    confidence: row.confidence ?? null,
    location: inventoryPath(row),
    folder_id: row.parent_id || null,
    pbc_ref: details.pbc_ref || null,
    pbc_role: details.pbc_role || null,
    pbc_status: details.pbc_status || null,
    event: {
      agent: 'mission-controller',
      what: 'inventory_linked_to_mission_memory',
      detail: trusted
        ? 'Pièce rattachée à la mission par Orpailleur ; classification reprise après contrôle.'
        : 'Pièce physiquement présente et rattachée à la mission ; classification métier encore non confirmée.'
    }
  };
}

function sameValue(key, current, incoming) {
  if (incoming == null || incoming === '') return true;
  if (key === 'role' && GENERIC_ROLES.has(String(incoming)) && current && !GENERIC_ROLES.has(String(current))) return true;
  if (key === 'confidence') {
    const a = Number(current), b = Number(incoming);
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) < 1e-9;
  }
  return String(current ?? '') === String(incoming ?? '');
}

export function needsInventorySync(current, incoming) {
  if (!current) return true;
  const fields = ['name', 'path', 'url', 'type', 'role', 'period', 'summary', 'source', 'event_id', 'read_status', 'read_method', 'confidence', 'location', 'folder_id', 'pbc_ref', 'pbc_role', 'pbc_status'];
  return fields.some(key => !sameValue(key, current[key], incoming[key]));
}

function registeredForMission(registeredByMission, missionId) {
  return registeredByMission instanceof Map
    ? (registeredByMission.get(missionId) || [])
    : (registeredByMission?.[missionId] || []);
}

// Kept for compatibility with the first repair tests: this reports only physically missing IDs.
export function missingInventoryDocuments(rows = [], registeredByMission = {}) {
  const byMission = new Map();
  for (const row of rows || []) {
    if (!row?.office_mission_id || !row?.file_id || row?.is_folder === true || row?.archived_at) continue;
    const known = new Set(registeredForMission(registeredByMission, row.office_mission_id).map(doc => doc?.id).filter(Boolean));
    if (known.has(row.file_id)) continue;
    const list = byMission.get(row.office_mission_id) || [];
    if (!list.some(item => item.file_id === row.file_id)) list.push(row);
    byMission.set(row.office_mission_id, list);
  }
  return byMission;
}

// Differential reconciliation: a known file is also rewritten when Orpailleur has a newer
// version, location, verified read state or trusted classification. Unchanged rows are a no-op.
export function inventoryDocumentsNeedingSync(rows = [], registeredByMission = {}) {
  const byMission = new Map();
  for (const row of rows || []) {
    if (!row?.office_mission_id || !row?.file_id || row?.is_folder === true || row?.archived_at) continue;
    const existing = registeredForMission(registeredByMission, row.office_mission_id).find(doc => doc?.id === row.file_id);
    const incoming = inventoryRowToMissionDocument(row);
    if (!needsInventorySync(existing, incoming)) continue;
    const list = byMission.get(row.office_mission_id) || [];
    if (!list.some(item => item.file_id === row.file_id)) list.push(row);
    byMission.set(row.office_mission_id, list);
  }
  return byMission;
}

export async function syncInventoryMissionDocuments(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const drive = d.drive || driveAdapter;
  const folder = d.folder || memoryFolderId();

  const inventory = await fetchRows(
    'orpailleur_inventory?org_id=eq.' + q(orgId) +
    '&office_mission_id=not.is.null&is_folder=eq.false&archived_at=is.null' +
    '&select=file_id,parent_id,folder_path,name,web_url,mime_type,modified_at,drive_version,content_verified_at,classification,decision_status,details,office_mission_id,document_type,document_period,document_version,source_channel,filing_reason,confidence,archived_at,is_folder' +
    '&limit=5000'
  );

  if (!(inventory || []).length) return { status: 'ok', inventory: 0, missing: 0, changed: 0, missions: 0, attached: 0, unchanged: 0, unresolved: [], errors: [] };

  const central = d.central !== undefined ? d.central : (await loadJsonFile(FILE, drive, folder)).state;
  const registeredByMission = Object.fromEntries(
    Object.entries(central?.missions || {}).map(([missionId, value]) => [missionId, value?.documents || []])
  );
  const missing = missingInventoryDocuments(inventory, registeredByMission);
  const needing = inventoryDocumentsNeedingSync(inventory, registeredByMission);
  const totalNeeding = [...needing.values()].reduce((n, rows) => n + rows.length, 0);
  const missingCount = [...missing.values()].reduce((n, rows) => n + rows.length, 0);
  if (!needing.size) return { status: 'ok', inventory: inventory.length, missing: 0, changed: 0, missions: 0, attached: 0, unchanged: inventory.length, unresolved: [], errors: [] };

  const missionIds = [...needing.keys()];
  const missions = await fetchRows(
    'office_missions?org_id=eq.' + q(orgId) + '&id=in.(' + missionIds.map(q).join(',') + ')' +
    '&select=id,name,mission_code,drive_folder_id,org_id&limit=500'
  );
  const byId = new Map((missions || []).map(m => [m.id, m]));

  let attached = 0, missionCount = 0;
  const unresolved = [], errors = [];
  for (const [missionId, rows] of needing) {
    const mission = byId.get(missionId);
    if (!mission) {
      unresolved.push(missionId);
      continue;
    }
    try {
      const docs = rows.map(inventoryRowToMissionDocument);
      await (d.recordMissionDocuments || recordMissionDocuments)(mission, docs, { ...d, orgId, fetchRows, drive, folder });
      attached += docs.length;
      missionCount += 1;
    } catch (error) {
      errors.push({ mission_id: missionId, error: String(error?.message || error) });
    }
  }

  const status = unresolved.length || errors.length ? (attached ? 'partial' : 'failed') : 'ok';
  return {
    status,
    inventory: inventory.length,
    missing: missingCount,
    changed: Math.max(0, totalNeeding - missingCount),
    missions: missionCount,
    attached,
    unchanged: Math.max(0, inventory.length - totalNeeding),
    unresolved,
    errors
  };
}
