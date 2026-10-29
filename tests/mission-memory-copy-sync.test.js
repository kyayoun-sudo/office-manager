import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileMissionMemoryCopies } from '../lib/mission-memory-copy-sync.js';

const central = {
  missions: {
    'm-1': {
      name: 'Mission 1',
      documents: [
        { id: 'd-1', name: 'GL.xlsx', type: 'grand_livre', at: '2026-10-30T00:00:00Z' },
        { id: 'd-2', name: 'Budget.xlsx', type: 'budget', at: '2026-10-30T00:00:00Z' }
      ]
    }
  }
};

test('copies central document metadata into mission-local memory without losing notes, then becomes a no-op', async () => {
  let local = { mission_id: 'm-1', notes: [{ id: 'n-1', text: 'keep me' }], documents: [] };
  let writes = 0;
  const deps = {
    central,
    drive: {},
    folder: 'central-memory',
    fetchRows: async () => [{ id: 'm-1', name: 'Mission 1', drive_folder_id: 'mission-folder', org_id: 'org-1' }],
    missionMemoryHome: async () => 'mission-memory-folder',
    loadJsonFile: async file => file === 'OFFICE_MANAGER_MISSION_MEMORY.json' ? { state: local } : { state: central },
    updateJsonFile: async (_file, update) => {
      writes += 1;
      local = update(local);
      return { state: local, fileId: 'memory-file' };
    }
  };

  const first = await reconcileMissionMemoryCopies('org-1', deps);
  assert.equal(first.status, 'ok');
  assert.equal(first.synced, 1);
  assert.equal(first.documents, 2);
  assert.equal(local.documents.length, 2);
  assert.deepEqual(local.notes, [{ id: 'n-1', text: 'keep me' }]);
  assert.equal(writes, 1);

  const second = await reconcileMissionMemoryCopies('org-1', deps);
  assert.equal(second.status, 'ok');
  assert.equal(second.synced, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(writes, 1);
});
