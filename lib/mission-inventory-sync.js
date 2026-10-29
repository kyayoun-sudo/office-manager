const q = encodeURIComponent;
const GENERIC_ROLES = new Set(['piece_recue', 'piece_pbc', 'preuve', 'autre']);
const scalar = value => value == null ? null : String(value);

function inventoryPath(row) {
  const folder = String(row?.folder_path || '').replace(/\/+$/, '');
  const name = String(row?.name || '').trim();
  if (!folder) return name || null;
  if (!name || folder === name || folder.endsWith('/' + name)) return folder;
  return folder + '/' + name;
}

export function inventoryRowToMissionDocument(row = {}) {
  const details = row.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {};
  const path = inventoryPath(row);
  const version = row.drive_version || row.document_version || row.modified_at || null;
  const confidence = row.confidence == null ? null : Number(row.confidence);
  return {
    id: row.file_id,
    name: row.name || null,
    path,
    url: row.web_url || null,
    type: row.document_type || null,
    role: row.document_type || details.role || 'preuve',
    period: row.document_period || null,
    read_status: row.content_verified_at ? 'READ' : null,
    source: 'orpailleur_inventory',
    event_id: version ? String(version) : null,
    read_method: row.content_verified_at ? 'orpailleur_inventory_verified' : null,
    confidence: Number.isFinite(confidence) ? confidence : null,
    location: path,
    folder_id: row.parent_id || null,
    pbc_ref: details.pbc_ref || null,
    pbc_role: details.pbc_role || null,
    pbc_status: details.pbc_status || null
  };
}

function equalField(key, current, incoming) {
  if (incoming == null || incoming === '') return true;
  if (key === 'role' && GENERIC_ROLES.has(String(incoming)) && current && !GENERIC_ROLES.has(String(current))) return true;
  if (key === 'confidence') {
    const a = current == null ? null : Number(current), b = Number(incoming);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) < 1e-9 : scalar(current) === scalar(incoming);
  }
  return scalar(current) === scalar(incoming);
}

export function needsInventorySync(current, incoming) {
  if (!current) return true;
  const owned = ['name', 'path', 'url', 'type', 'role', 'period', 'read_status', 'source', 'event_id', 'read_method', 'confidence', 'location', 'folder_id', 'pbc_ref', 'pbc_role', 'pbc_status'];
  return owned.some(key => !equalField(key, current[key], incoming[key]));
}

export async function syncOrpailleurInventory(orgId, d = {}) {
  const fetchRows = d.fetchRows || (await import('./supabase.js')).rest;
  const missionFiles = d.missionFiles || await import('./mission-files.js');
  const readMissionDocuments = d.missionDocuments || missionFiles.missionDocuments;
  const recordMissionDocuments = d.recordMissionDocuments || missionFiles.recordMissionDocuments;

  const rows = await fetchRows(
    'orpailleur_inventory?org_id=eq.' + q(orgId) +
    '&office_mission_id=not.is.null&is_folder=eq.false&archive_id=is.null' +
    '&select=file_id,parent_id,folder_path,name,modified_at,drive_version,web_url,content_verified_at,details,office_mission_id,document_type,document_period,document_version,confidence' +
    '&limit=2000'
  );

  const grouped = new Map();
  for (const row of rows || []) {
    if (!row?.office_mission_id || !row?.file_id) continue;
    const list = grouped.get(row.office_mission_id) || [];
    list.push(row);
    grouped.set(row.office_mission_id, list);
  }
  if (!grouped.size) return { status: 'ok', scanned: (rows || []).length, missions: 0, synced: 0, unchanged: 0, errors: [] };

  const ids = [...grouped.keys()];
  const missions = await fetchRows(
    'office_missions?org_id=eq.' + q(orgId) + '&id=in.(' + ids.join(',') + ')' +
    '&select=id,org_id,name,mission_code,client_name,drive_folder_id,status&limit=500'
  );
  const missionById = new Map((missions || []).map(m => [m.id, m]));

  let synced = 0, unchanged = 0;
  const errors = [];
  for (const [missionId, inventoryRows] of grouped) {
    const mission = missionById.get(missionId);
    if (!mission) {
      errors.push({ mission_id: missionId, error: 'MISSION_NOT_FOUND_FOR_LINKED_INVENTORY' });
      continue;
    }
    try {
      const current = await readMissionDocuments(mission.id, { ...d, orgId, fetchRows });
      const byId = new Map((current || []).map(doc => [doc.id, doc]));
      const changed = inventoryRows.map(inventoryRowToMissionDocument).filter(doc => doc.id && needsInventorySync(byId.get(doc.id), doc));
      unchanged += inventoryRows.length - changed.length;
      if (!changed.length) continue;
      await recordMissionDocuments(mission, changed.map(doc => ({
        ...doc,
        event: { agent: 'orpailleur', what: 'inventory_sync', detail: 'Pièce synchronisée depuis l’inventaire Orpailleur vers la mémoire canonique de la mission.' }
      })), { ...d, orgId, fetchRows });
      synced += changed.length;
    } catch (error) {
      errors.push({ mission_id: missionId, error: String(error?.message || error) });
    }
  }

  return {
    status: errors.length ? (synced || unchanged ? 'partial' : 'failed') : 'ok',
    scanned: (rows || []).length,
    missions: grouped.size,
    synced,
    unchanged,
    errors
  };
}
