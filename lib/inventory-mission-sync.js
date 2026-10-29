import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile } from './mapping-scan.js';
import { recordMissionDocuments } from './mission-files.js';

const FILE = 'OFFICE_MANAGER_MISSION_FILES.json';
const q = encodeURIComponent;

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

/**
 * Convert a mission-linked Orpailleur inventory row to the conservative document shape
 * understood by OFFICE_MANAGER_MISSION_FILES.json.
 *
 * Presence is a fact. Semantic classification is not: an UNREVIEWED document is recorded
 * as piece_recue, so Enhanced Auditor knows that the file exists without being told a false
 * audit role. A reviewed/verified Orpailleur classification may carry document_type as role.
 */
export function inventoryRowToMissionDocument(row = {}) {
  const trusted = trustedClassification(row);
  const details = row.details && typeof row.details === 'object' ? row.details : {};
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
    read_status: row.content_verified_at ? 'read' : null,
    confidence: row.confidence ?? null,
    location: row.folder_path || null,
    folder_id: row.parent_id || null,
    event: {
      agent: 'mission-controller',
      what: 'inventory_linked_to_mission_memory',
      detail: trusted
        ? 'Pièce déjà rattachée à la mission par Orpailleur ; classification reprise après contrôle.'
        : 'Pièce physiquement présente et rattachée à la mission ; classification métier encore non confirmée.'
    },
    inventory: {
      classification: row.classification || null,
      decision_status: row.decision_status || null,
      drive_version: row.drive_version || null,
      document_version: row.document_version || null,
      modified_at: row.modified_at || null,
      content_verified_at: row.content_verified_at || null
    }
  };
}

export function missingInventoryDocuments(rows = [], registered = []) {
  const known = new Set((registered || []).map(doc => doc?.id).filter(Boolean));
  const byMission = new Map();
  for (const row of rows || []) {
    if (!row?.office_mission_id || !row?.file_id || row?.is_folder === true || row?.archived_at) continue;
    if (known.has(row.file_id)) continue;
    const list = byMission.get(row.office_mission_id) || [];
    // The inventory primary key is per Drive/file; still protect against duplicated input.
    if (!list.some(item => item.file_id === row.file_id)) list.push(row);
    byMission.set(row.office_mission_id, list);
  }
  return byMission;
}

/**
 * Repair the known visibility gap before Mission Controller rebuilds mission memories:
 * files that Orpailleur has already linked to office_mission_id must not remain invisible
 * merely because OFFICE_MANAGER_MISSION_FILES.json missed the earlier event.
 *
 * The sync is intentionally additive/idempotent. Existing register entries win and are not
 * rewritten here; normal Orpailleur/Mission Controller events remain responsible for later
 * semantic/version updates.
 */
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

  if (!(inventory || []).length) return { inventory: 0, missing: 0, missions: 0, attached: 0 };

  const central = d.central !== undefined
    ? d.central
    : (await loadJsonFile(FILE, drive, folder)).state;
  const registered = Object.values(central?.missions || {}).flatMap(m => m?.documents || []);
  const missing = missingInventoryDocuments(inventory, registered);
  if (!missing.size) return { inventory: inventory.length, missing: 0, missions: 0, attached: 0 };

  const missionIds = [...missing.keys()];
  const missions = await fetchRows(
    'office_missions?org_id=eq.' + q(orgId) + '&id=in.(' + missionIds.map(q).join(',') + ')' +
    '&select=id,name,mission_code,drive_folder_id,org_id&limit=500'
  );
  const byId = new Map((missions || []).map(m => [m.id, m]));

  let attached = 0;
  let missionCount = 0;
  const unresolved = [];
  for (const [missionId, rows] of missing) {
    const mission = byId.get(missionId);
    if (!mission) {
      unresolved.push(missionId);
      continue;
    }
    const docs = rows.map(inventoryRowToMissionDocument);
    await (d.recordMissionDocuments || recordMissionDocuments)(mission, docs, {
      ...d,
      orgId,
      fetchRows,
      drive,
      folder
    });
    attached += docs.length;
    missionCount += 1;
  }

  return {
    inventory: inventory.length,
    missing: [...missing.values()].reduce((n, rows) => n + rows.length, 0),
    missions: missionCount,
    attached,
    unresolved
  };
}
