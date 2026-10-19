import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLab, changeLab, mergeLabs } from '../lib/shadow.js';

// A Drive with folders; searchFiles finds every SHADOW_LAB.json of the Drive (not trashed).
function drive() {
  const files = new Map(); let n = 0;
  return { files,
    findFilesByExactName: async (name, parent) => [...files].filter(([, f]) => f.name === name && f.parent === parent && !f.trashed).map(([id, f]) => ({ id, modifiedTime: f.mt })),
    searchFiles: async ({ query }) => [...files].filter(([, f]) => f.name.includes(query) && !f.trashed).map(([id, f]) => ({ id, name: f.name })),
    downloadBuffer: async id => Buffer.from(files.get(id).body),
    getMeta: async id => ({ id, modifiedTime: files.get(id).mt }),
    createBinary: async ({ name, parentId, buffer }) => { const id = 'F' + (++n); files.set(id, { name, parent: parentId, body: buffer.toString(), mt: 't' + n }); return { id }; },
    updateBinary: async (id, { buffer }) => { const f = files.get(id); f.body = buffer.toString(); f.mt = 't' + (++n); } };
}
const saved = { lessons: [{ id: 'L1', agent: 'orpailleur', lesson: 'x', status: 'active' }], tests: [{ id: 'T1', agent: 'orpailleur', scenario: 's' }, { id: 'T2', agent: 'sika', scenario: 's' }] };

test('the memory folder changed: the lab imported earlier is found elsewhere in the Drive, merged and kept in the current memory', async () => {
  const d = drive();
  d.files.set('OLD', { name: 'SHADOW_LAB.json', parent: 'MEM_OLD', body: JSON.stringify(saved), mt: 't0' });
  const lab = await loadLab({ drive: d, folder: 'MEM_NEW' });
  assert.deepEqual(lab.tests.map(t => t.id), ['T1', 'T2']);
  const copy = [...d.files.values()].find(f => f.parent === 'MEM_NEW');
  assert.ok(copy && JSON.parse(copy.body).tests.length === 2, 'now in the current memory');
  assert.ok(d.files.get('OLD'), 'the other copy is never deleted');
});

test('a new empty lab written in the new folder does not hide the real one; a reset (copy in the bin) stays a reset', async () => {
  const d = drive();
  d.files.set('OLD', { name: 'SHADOW_LAB.json', parent: 'MEM_OLD', body: JSON.stringify(saved), mt: 't0' });
  d.files.set('NEW', { name: 'SHADOW_LAB.json', parent: 'MEM_NEW', body: JSON.stringify({ lessons: [], tests: [] }), mt: 't1' });
  await changeLab(l => { l.tests.push({ id: 'T3', agent: 'shadow', scenario: 's' }); }, { drive: d, folder: 'MEM_NEW' });
  assert.deepEqual(JSON.parse(d.files.get('NEW').body).tests.map(t => t.id).sort(), ['T1', 'T2', 'T3']);
  const r = drive(); r.files.set('BIN', { name: 'SHADOW_LAB.json', parent: 'M', body: JSON.stringify(saved), mt: 't0', trashed: true });
  assert.equal((await loadLab({ drive: r, folder: 'M2' })).tests.length, 0);
});

test('merging never replaces: same id kept as it is here', () => {
  const m = mergeLabs({ lessons: [{ id: 'L1', lesson: 'ici' }], tests: [] }, { lessons: [{ id: 'L1', lesson: 'ailleurs' }, { id: 'L2', lesson: 'b' }], tests: [{ id: 'T1' }] });
  assert.deepEqual(m.lessons.map(l => l.lesson), ['ici', 'b']); assert.equal(m.tests.length, 1);
});
