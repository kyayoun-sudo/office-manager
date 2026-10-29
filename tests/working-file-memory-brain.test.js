import test from 'node:test';
import assert from 'node:assert/strict';

import { MEMORY_SHEET, seedMissionMemoryReads } from '../lib/working-file-memory-brain.js';

const meta = (modifiedTime = '2026-10-30T00:00:00.000Z', version = '7', md5Checksum = 'abc') => ({ modifiedTime, version, md5Checksum, trashed: false });
const revision = m => [m.modifiedTime, m.version || '', m.md5Checksum || ''].join('|');

function baseView(reads = []) {
  return {
    work: {
      walkthrough: [{
        kind: 'step-brain-job',
        id: 'job-1',
        step_n: 2,
        reads
      }]
    }
  };
}

const args = view => ({
  orgId: 'org-1',
  missionId: 'mission-1',
  view,
  step: { n: 2, text: 'Contrôler le GL projet' },
  sources: [{ file_id: 'doc-1', name: 'piece.xlsx' }],
  body: { brain_job: 'job-1' }
});

test('matching audit_read revision is reused without rereading document content', async () => {
  const current = meta();
  const original = baseView();
  const out = await seedMissionMemoryReads(args(original), {
    drive: { getMeta: async id => id === 'doc-1' ? current : null },
    missionDocuments: async () => [{
      id: 'doc-1',
      name: 'piece.xlsx',
      audit_read: {
        version: 1,
        revision: revision(current),
        status: 'EXCERPTS_READ',
        document_type: 'grand livre projet',
        summary: 'Grand livre du projet',
        facts: []
      }
    }]
  });

  assert.equal(out.reused, 1);
  assert.notEqual(out.view, original);
  assert.deepEqual(original.work.walkthrough[0].reads, []);
  assert.deepEqual(out.view.work.walkthrough[0].reads, [{
    file_id: 'doc-1',
    revision: revision(current),
    sheets: [MEMORY_SHEET],
    cached: true,
    source: 'mission_memory',
    memory_status: 'EXCERPTS_READ'
  }]);
});

test('changed Drive revision invalidates mission-memory receipt', async () => {
  const oldMeta = meta('2026-10-29T00:00:00.000Z', '6', 'old');
  const current = meta();
  const out = await seedMissionMemoryReads(args(baseView()), {
    drive: { getMeta: async () => current },
    missionDocuments: async () => [{
      id: 'doc-1',
      audit_read: { version: 1, revision: revision(oldMeta), status: 'EXCERPTS_READ' }
    }]
  });

  assert.equal(out.reused, 0);
  assert.deepEqual(out.view.work.walkthrough[0].reads, []);
});

test('a genuine current-job sheet read is never replaced by cached memory', async () => {
  const current = meta();
  const existing = [{ file_id: 'doc-1', revision: revision(current), sheets: ['GL'] }];
  const out = await seedMissionMemoryReads(args(baseView(existing)), {
    drive: { getMeta: async () => current },
    missionDocuments: async () => [{
      id: 'doc-1',
      audit_read: { version: 1, revision: revision(current), status: 'EXCERPTS_READ' }
    }]
  });

  assert.equal(out.reused, 0);
  assert.deepEqual(out.view.work.walkthrough[0].reads, existing);
});
