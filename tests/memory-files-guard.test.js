import test from 'node:test';
import assert from 'node:assert/strict';
import { guardMemory, orderCopies, isMemoryName } from '../lib/memory-files.js';

// A Drive whose search can lag (eventual consistency) or fail; ids are always readable.
function lagDrive() {
  const files = new Map(); let n = 0, lag = false, fail = false;
  const raw = {
    findFilesByExactName: async (name, parent) => { if (fail) throw new Error('timeout'); if (lag) return []; return [...files.values()].filter(f => f.name === name && f.parents[0] === parent && !f.trashed); },
    getMeta: async id => files.get(id) || null,
    createBinary: async ({ name, parentId, buffer }) => { const id = 'F' + (++n); files.set(id, { id, name, parents: [parentId], size: String(buffer.length), modifiedTime: 't' + n }); return { id }; }
  };
  return { files, raw, setLag: v => { lag = v; }, setFail: v => { fail = v; } };
}
let settings = {};
const deps = () => ({ orgId: 'org', driveId: 'D', fetchRows: async (p, o = {}) => { if (o.method === 'POST') { settings = JSON.parse(o.body)[0].settings; return []; } return [{ settings }]; } });

test('a memory file the search does not list yet is found again by its id — never created a second time', async () => {
  settings = {};
  const w = lagDrive(), drive = guardMemory(w.raw, deps());
  const { id } = await drive.createBinary({ name: 'OFFICE_MANAGER_TIDY_STATE.json', parentId: 'MEM', buffer: Buffer.from('{"big":1}') });
  w.setLag(true);
  const found = await drive.findFilesByExactName('OFFICE_MANAGER_TIDY_STATE.json', 'MEM');
  assert.equal(found[0].id, id);
  await assert.rejects(drive.createBinary({ name: 'OFFICE_MANAGER_TIDY_STATE.json', parentId: 'MEM', buffer: Buffer.from('{}') }), /MEMORY_FILE_EXISTS/);
  assert.equal(w.files.size, 1);
});

test('the search fails: nothing is created (the agent stops rather than starting from an empty memory)', async () => {
  settings = {};
  const w = lagDrive(), drive = guardMemory(w.raw, { ...deps(), orgId: 'org2' });
  w.setFail(true);
  await assert.rejects(drive.createBinary({ name: 'SHADOW_LAB.json', parentId: 'MEM', buffer: Buffer.from('{}') }), /MEMORY_LOOKUP_FAILED/);
  assert.equal(w.files.size, 0);
  // Ordinary documents are not concerned.
  w.setFail(false); await drive.createBinary({ name: 'Rapport.docx', parentId: 'X', buffer: Buffer.from('x') }); assert.equal(w.files.size, 1);
});

test('several copies: the richest recent one first, never an almost empty restart', () => {
  const order = orderCopies([{ id: 'empty', size: '200', modifiedTime: '2026-10-19' }, { id: 'real', size: '90000', modifiedTime: '2026-10-18' }, { id: 'old', size: '80000', modifiedTime: '2026-10-01' }]);
  assert.deepEqual(order.map(f => f.id), ['real', 'old', 'empty']);
  assert.ok(isMemoryName('GRAND_CONTROLEUR_MEMORY.json') && isMemoryName('OFFICE_MANAGER_MAP.xlsx') && !isMemoryName('OFFICE_MANAGER_MAP_ANCIENNE_COPIE_2026-10-01.xlsx') && !isMemoryName('Grand livre.xlsx'));
});
