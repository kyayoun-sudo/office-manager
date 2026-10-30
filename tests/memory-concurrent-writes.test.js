import test from 'node:test';
import assert from 'node:assert/strict';
import { saveOne } from '../lib/enhanced-auditor-domain.js';
import { updateJsonFile } from '../lib/mapping-scan.js';

// Audit 2026-10-30: some registers keep the state of every mission (or deposit) in ONE memory file, and were written with
// « read, change, write without version ». Two steps at the same time: the last write erased the other one's work.

// A Drive file with a version: a write that names an older version is refused (as the real adapter does).
function versionedDrive() {
  let file = null, v = 0;
  return {
    get: () => (file ? JSON.parse(file.body) : null),
    findFilesByExactName: async () => (file ? [{ id: 'F', modifiedTime: 'v' + file.v }] : []),
    downloadBuffer: async () => Buffer.from(file.body),
    getMeta: async () => ({ modifiedTime: 'v' + file.v }),
    updateBinary: async (id, { buffer, expectedModifiedTime }) => {
      await new Promise(r => setTimeout(r, 2));
      if (expectedModifiedTime && expectedModifiedTime !== 'v' + file.v) throw new Error('MEMORY_CONFLICT');
      file = { body: buffer.toString('utf8'), v: ++v };
    },
    createBinary: async ({ buffer }) => { file = { body: buffer.toString('utf8'), v: ++v }; return { id: 'F' }; }
  };
}

test('two reviews saved at the same time: both are kept', async () => {
  const drive = versionedDrive();
  await saveOne('M0', { stage: 'start' }, { drive, folder: 'mem' });
  await Promise.all([
    saveOne('M1', { stage: 'risks' }, { drive, folder: 'mem' }),
    saveOne('M2', { stage: 'risks' }, { drive, folder: 'mem' })
  ]);
  assert.deepEqual(Object.keys(drive.get().reviews).sort(), ['M0', 'M1', 'M2']);
});

test('updateJsonFile uses the reader and writer it is given (deposits pass their own in tests)', async () => {
  const calls = [];
  const load = async () => { calls.push('load'); return { fileId: 'F', modifiedTime: 'v1', state: { deposits: { a: 1 } } }; };
  const save = async (name, drive, folder, fileId, state, expected) => { calls.push('save:' + expected); return fileId; };
  const r = await updateJsonFile('X.json', s => ({ ...s, deposits: { ...s.deposits, b: 2 } }), { drive: {}, folder: 'f', load, save });
  assert.deepEqual(r.state.deposits, { a: 1, b: 2 });
  assert.deepEqual(calls, ['load', 'save:v1'], 'written over the version read');
});
