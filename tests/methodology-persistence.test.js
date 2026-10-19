import test from 'node:test';
import assert from 'node:assert/strict';
import { methodologyState, METHODOLOGY_FILE } from '../lib/methodology.js';

// A fake Drive with folders, and a fake office_firm_settings row.
function world() {
  const files = new Map(); let n = 0;
  const drive = {
    findFilesByExactName: async (name, parent) => [...files.entries()].filter(([, f]) => f.name === name && f.parent === parent && !f.trashed).map(([id, f]) => ({ id, modifiedTime: f.mt })),
    downloadBuffer: async id => Buffer.from(files.get(id).body),
    getMeta: async id => files.has(id) ? { id, parents: [files.get(id).parent], trashed: Boolean(files.get(id).trashed), modifiedTime: files.get(id).mt } : null,
    createBinary: async ({ name, parentId, buffer }) => { const id = 'F' + (++n); files.set(id, { name, parent: parentId, body: buffer.toString(), mt: 't' + n }); return { id }; },
    updateBinary: async (id, { buffer }) => { const f = files.get(id); f.body = buffer.toString(); f.mt = 't' + (++n); }
  };
  let settings = {};
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'POST') { settings = JSON.parse(o.body)[0].settings; return []; }
    return [{ settings }];
  };
  return { files, drive, fetchRows, settings: () => settings };
}
const library = { status: 'ready', source_folder_id: 'SOPFOLDERxxxxxxxxxxxxxxx', drive_id: 'OLD_DRIVE_ID', sops: [{ file_id: 's1', procedures: [{ code: 'ACH-01' }] }] };

test('a library in this Drive’s memory is shown even if its old drive_id differs (that check hid it), and its place is remembered', async () => {
  const w = world();
  w.files.set('LIB', { name: METHODOLOGY_FILE, parent: 'MEM1', body: JSON.stringify(library), mt: 't0' });
  const st = await methodologyState({ drive: w.drive, folder: 'MEM1', fetchRows: w.fetchRows }, 'org');
  assert.equal(st.sops.length, 1);
  assert.equal(w.settings().methodology.file_id, 'LIB');
});

test('the memory folder changed: the library is found again by its ID and copied back into the current memory', async () => {
  const w = world();
  w.files.set('LIB', { name: METHODOLOGY_FILE, parent: 'MEM_OLD', body: JSON.stringify(library), mt: 't0' });
  await w.fetchRows('x', { method: 'POST', body: JSON.stringify([{ settings: { methodology: { file_id: 'LIB', source_folder_id: library.source_folder_id } } }]) });
  const st = await methodologyState({ drive: w.drive, folder: 'MEM_NEW', fetchRows: w.fetchRows }, 'org');
  assert.equal(st.recovered, true); assert.equal(st.sops.length, 1);
  const copy = [...w.files.values()].find(f => f.parent === 'MEM_NEW');
  assert.ok(copy, 'copied into the current memory'); assert.ok(w.files.get('LIB'), 'the original is never deleted');
  assert.notEqual(w.settings().methodology.file_id, 'LIB', 'the pointer follows the copy');
  // Next visit: found directly in the current memory.
  assert.equal((await methodologyState({ drive: w.drive, folder: 'MEM_NEW', fetchRows: w.fetchRows }, 'org')).recovered, undefined);
});

test('the library file is gone (bin): the page is told to read the known SOP folder again by itself', async () => {
  const w = world();
  w.files.set('LIB', { name: METHODOLOGY_FILE, parent: 'MEM_OLD', body: JSON.stringify(library), mt: 't0', trashed: true });
  await w.fetchRows('x', { method: 'POST', body: JSON.stringify([{ settings: { methodology: { file_id: 'LIB', source_folder_id: 'SOPFOLDERxxxxxxxxxxxxxxx' } } }]) });
  const st = await methodologyState({ drive: w.drive, folder: 'MEM_NEW', fetchRows: w.fetchRows }, 'org');
  assert.deepEqual([st.status, st.reload, st.source_folder_id], ['none', true, 'SOPFOLDERxxxxxxxxxxxxxxx']);
  // Never loaded at all: nothing to reload.
  assert.equal((await methodologyState({ drive: world().drive, folder: 'M', fetchRows: async () => [] }, 'org')).reload, undefined);
});
