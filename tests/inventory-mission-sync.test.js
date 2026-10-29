import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inventoryRowToMissionDocument,
  missingInventoryDocuments,
  syncInventoryMissionDocuments
} from '../lib/inventory-mission-sync.js';

test('unreviewed inventory file is visible but not promoted to a false audit role', () => {
  const doc = inventoryRowToMissionDocument({
    file_id: 'F1',
    name: 'balance.xlsx',
    folder_path: 'Clients/ABC/2026',
    classification: 'UNREVIEWED',
    decision_status: 'INVENTORIED',
    document_type: 'balance_generale',
    office_mission_id: 'M1'
  });

  assert.equal(doc.id, 'F1');
  assert.equal(doc.role, 'piece_recue');
  assert.equal(doc.type, null);
  assert.equal(doc.path, 'Clients/ABC/2026/balance.xlsx');
  assert.equal(doc.source, 'orpailleur_inventory');
});

test('reviewed inventory classification can carry its document type into mission memory', () => {
  const doc = inventoryRowToMissionDocument({
    file_id: 'F2',
    name: 'GL.xlsx',
    classification: 'EXACT',
    decision_status: 'VERIFIED',
    document_type: 'grand_livre',
    document_period: '2026',
    content_verified_at: '2026-10-29T10:00:00Z'
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
  const missing = missingInventoryDocuments(rows, {
    M1: [{ id: 'F1' }],
    M2: []
  });

  assert.deepEqual(missing.get('M1').map(x => x.file_id), ['F2']);
  assert.deepEqual(missing.get('M2').map(x => x.file_id), ['F1']);
});

test('inventory sync records only mission-linked documents missing from that mission register', async () => {
  const inventory = [
    { office_mission_id: 'M1', file_id: 'F1', name: 'already.pdf', classification: 'EXACT', decision_status: 'VERIFIED', document_type: 'contrat', is_folder: false },
    { office_mission_id: 'M1', file_id: 'F2', name: 'new.xlsx', classification: 'UNREVIEWED', decision_status: 'INVENTORIED', is_folder: false },
    { office_mission_id: 'M2', file_id: 'F1', name: 'same-file-correct-mission.pdf', classification: 'EXACT', decision_status: 'VERIFIED', document_type: 'contrat', is_folder: false }
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
    central: { missions: { M1: { documents: [{ id: 'F1', name: 'already.pdf' }] } } },
    recordMissionDocuments: async (mission, docs) => {
      calls.push({ mission: mission.id, docs: docs.map(x => x.id) });
      return docs.length;
    }
  });

  assert.equal(result.missing, 2);
  assert.equal(result.attached, 2);
  assert.equal(result.missions, 2);
  assert.deepEqual(calls, [
    { mission: 'M1', docs: ['F2'] },
    { mission: 'M2', docs: ['F1'] }
  ]);
});
