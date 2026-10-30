import test from 'node:test';
import assert from 'node:assert/strict';

import { hydrateEnhancedAuditorReality, scanMissionDrive } from '../lib/enhanced-auditor-reality.js';

test('mission Drive scan walks subfolders and ignores Office Manager internal memory', async () => {
  const tree = {
    root: [
      { id: 'f-a', name: 'Audit', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'f-internal', name: '_OFFICE_MANAGER', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'doc-root', name: 'balance.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', modifiedTime: '2026-10-30T00:00:00Z' }
    ],
    'f-a': [{ id: 'doc-a', name: 'invoice.pdf', mimeType: 'application/pdf', modifiedTime: '2026-10-30T00:01:00Z' }],
    'f-internal': [{ id: 'memory', name: 'OFFICE_MANAGER_MISSION_MEMORY.json', mimeType: 'application/json' }]
  };

  const out = await scanMissionDrive('root', {
    searchDriveFiles: async ({ parentId }) => tree[parentId] || []
  });

  assert.deepEqual(out.files.map(x => x.id).sort(), ['doc-a', 'doc-root']);
  assert.equal(out.folders, 2);
});

test('reality hydration registers a physical mission file missing from memory before reasoning', async () => {
  let docs = [];
  const physical = [{ id: 'doc-1', name: 'GL October.xlsx', path: 'Audit/GL October.xlsx', parent_id: 'audit', modifiedTime: '2026-10-30T00:00:00Z' }];

  const out = await hydrateEnhancedAuditorReality('org-1', 'mission-1', {
    fetchRows: async query => query.startsWith('office_missions?')
      ? [{ id: 'mission-1', name: 'Mission A', mission_code: 'A', drive_folder_id: 'root', org_id: 'org-1' }]
      : [],
    missionDocuments: async () => docs,
    recordMissionDocuments: async (_mission, incoming) => {
      docs = [...docs, ...incoming.map(x => ({ ...x }))];
      return docs.length;
    },
    scanMissionDrive: async () => ({ files: physical, folders: 2, possibly_truncated: false }),
    syncInventoryMissionDocuments: async () => ({ status: 'ok', inventory: 0, missing: 0, changed: 0, attached: 0, unchanged: 0 }),
    reconcileMissionMemoryCopies: async () => ({ status: 'ok', missions: 1, synced: 1, unchanged: 0, documents: docs.length })
  });

  assert.equal(out.ok, true);
  assert.equal(out.repaired_files, 1);
  assert.equal(out.changed, true);
  assert.equal(out.documents[0].id, 'doc-1');
  assert.equal(out.documents[0].role, 'piece_recue');
});

test('reality hydration blocks instead of working blind when physical Drive and memory still disagree', async () => {
  const out = await hydrateEnhancedAuditorReality('org-1', 'mission-1', {
    fetchRows: async () => [{ id: 'mission-1', name: 'Mission A', drive_folder_id: 'root', org_id: 'org-1' }],
    missionDocuments: async () => [],
    recordMissionDocuments: async () => 0,
    scanMissionDrive: async () => ({ files: [{ id: 'doc-1', name: 'piece.pdf', path: 'piece.pdf', parent_id: 'root' }], folders: 1, possibly_truncated: false }),
    syncInventoryMissionDocuments: async () => ({ status: 'ok', inventory: 0, missing: 0, changed: 0, attached: 0, unchanged: 0 }),
    reconcileMissionMemoryCopies: async () => ({ status: 'ok', missions: 0, synced: 0, unchanged: 0, documents: 0 })
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, 'MISSION_REALITY_MEMORY_MISMATCH');
  assert.deepEqual(out.missing_file_ids, ['doc-1']);
});
