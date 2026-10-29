import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inventoryRowToMissionDocument,
  missingInventoryDocuments,
  inventoryDocumentsNeedingSync,
  needsInventorySync,
  syncInventoryMissionDocuments
} from '../lib/inventory-mission-sync.js';
import { runMissionControllerWork } from '../lib/mission-controller-worker.js';

test('unreviewed inventory file is visible but not promoted to a false audit role', () => {
  const doc = inventoryRowToMissionDocument({
    file_id: 'F1', name: 'balance.xlsx', folder_path: 'Clients/ABC/2026',
    classification: 'UNREVIEWED', decision_status: 'INVENTORIED',
    document_type: 'balance_generale', office_mission_id: 'M1', drive_version: '7'
  });
  assert.equal(doc.id, 'F1');
  assert.equal(doc.role, 'piece_recue');
  assert.equal(doc.type, null);
  assert.equal(doc.path, 'Clients/ABC/2026/balance.xlsx');
  assert.equal(doc.source, 'orpailleur_inventory');
  assert.equal(doc.event_id, '7');
});

test('reviewed inventory classification can carry its document type into mission memory', () => {
  const doc = inventoryRowToMissionDocument({
    file_id: 'F2', name: 'GL.xlsx', classification: 'EXACT', decision_status: 'VERIFIED',
    document_type: 'grand_livre', document_period: '2026', content_verified_at: '2026-10-29T10:00:00Z'
  });
  assert.equal(doc.role, 'grand_livre');
  assert.equal(doc.type, 'grand_livre');
  assert.equal(doc.period, '2026');
  assert.equal(doc.read_status, 'read');
});

test('deduplication is mission + file, not file globally', () => {
  const rows = [
    { office_mission_id: 'M1', file_id: 'F1', name: 'A' },
    { office_mission_id: 'M2', file_id: 'F1', name: 'A' },
    { office_mission_id: 'M1', file_id: 'F2', name: 'B' }
  ];
  const missing = missingInventoryDocuments(rows, { M1: [{ id: 'F1' }], M2: [] });
  assert.deepEqual(missing.get('M1').map(x => x.file_id), ['F2']);
  assert.deepEqual(missing.get('M2').map(x => x.file_id), ['F1']);
});

test('unchanged inventory is a no-op but a new Drive version is resynchronised', () => {
  const row = {
    office_mission_id: 'M1', file_id: 'F1', name: 'balance.xlsx', folder_path: 'Clients/ABC/2026',
    classification: 'EXACT', decision_status: 'VERIFIED', document_type: 'balance_generale',
    drive_version: '7', content_verified_at: '2026-10-29T10:00:00Z'
  };
  const current = inventoryRowToMissionDocument(row);
  assert.equal(needsInventorySync(current, inventoryRowToMissionDocument(row)), false);
  assert.equal(needsInventorySync(current, inventoryRowToMissionDocument({ ...row, drive_version: '8' })), true);
  assert.equal(inventoryDocumentsNeedingSync([row], { M1: [current] }).size, 0);
  assert.deepEqual(inventoryDocumentsNeedingSync([{ ...row, drive_version: '8' }], { M1: [current] }).get('M1').map(x => x.file_id), ['F1']);
});

test('inventory sync writes only missing or materially changed mission documents', async () => {
  const stableRow = {
    office_mission_id: 'M1', file_id: 'F1', name: 'already.pdf', folder_path: 'Clients/M1',
    classification: 'EXACT', decision_status: 'VERIFIED', document_type: 'contrat',
    drive_version: '4', is_folder: false, archived_at: null
  };
  const inventory = [
    stableRow,
    { office_mission_id: 'M1', file_id: 'F2', name: 'new.xlsx', classification: 'UNREVIEWED', decision_status: 'INVENTORIED', is_folder: false, archived_at: null },
    { ...stableRow, office_mission_id: 'M2', drive_version: '5' }
  ];
  const calls = [];
  const fetchRows = async path => {
    if (path.startsWith('orpailleur_inventory?')) return inventory;
    if (path.startsWith('office_missions?')) return [
      { id: 'M1', name: 'Mission 1', org_id: 'O' },
      { id: 'M2', name: 'Mission 2', org_id: 'O' }
    ];
    throw new Error('unexpected query ' + path);
  };
  const result = await syncInventoryMissionDocuments('O', {
    fetchRows,
    central: { missions: { M1: { documents: [inventoryRowToMissionDocument(stableRow)] } } },
    recordMissionDocuments: async (mission, docs) => { calls.push({ mission: mission.id, docs: docs.map(x => x.id) }); return docs.length; }
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.missing, 2);
  assert.equal(result.attached, 2);
  assert.equal(result.unchanged, 1);
  assert.deepEqual(calls, [
    { mission: 'M1', docs: ['F2'] },
    { mission: 'M2', docs: ['F1'] }
  ]);
});

test('Mission Controller cannot report success when inventory reconciliation is partial', async () => {
  let persisted = { checkpoint: { seen: {} } };
  const result = await runMissionControllerWork('O', {
    loadAgentMemory: async () => ({ memory: persisted }),
    writeAgentMemory: async (_key, update) => { persisted = update(persisted); return { memory: persisted }; },
    syncInventoryMissionDocuments: async () => ({ status: 'partial', inventory: 3, missing: 1, changed: 0, attached: 0, unchanged: 2, unresolved: ['M-X'], errors: [] }),
    refreshMissionMemories: async () => ({ missions: [{ mission_id: 'M1', status: 'updated' }] }),
    autoStatusProposals: async () => [],
    assignValidatedOrphans: async () => null
  });

  assert.equal(result.inventory_sync.status, 'partial');
  assert.equal(persisted.status, 'failed');
  assert.match(persisted.last_error, /synchronisation/i);
});
