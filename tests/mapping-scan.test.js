import test from 'node:test';
import assert from 'node:assert/strict';
import { startScan, scanStep, scanStatus } from '../lib/mapping-scan.js';

function fakeDrive() {
  const files = new Map(); let n = 0;
  return {
    files,
    findFilesByExactName: async (name) => [...files.entries()].filter(([, f]) => f.name === name).map(([id]) => ({ id })),
    downloadBuffer: async id => files.get(id).buffer,
    createBinary: async ({ name, buffer }) => { const id = 'f' + (++n); files.set(id, { name, buffer }); return { id }; },
    getMeta: async id => ({ id, modifiedTime: files.get(id).mt || 't0' }),
    updateBinary: async (id, { buffer, expectedModifiedTime }) => { if (!expectedModifiedTime) throw new Error('EXPECTED_MODIFIED_TIME_REQUIRED'); files.get(id).buffer = buffer; files.get(id).mt = 't' + Math.random(); }
  };
}
const tree = { R: [{ id: 'A', name: 'Clients', mimeType: 'application/vnd.google-apps.folder' }, { id: 'x', name: 'note.pdf', mimeType: 'application/pdf' }],
  A: [{ id: 'B', name: 'CAC 2026', mimeType: 'application/vnd.google-apps.folder' }], B: [{ id: 'y', name: 'lettre.docx', mimeType: 'x' }] };

test('mapping walks the Drive in resumable steps, then runs the Orpailleur pass on the full listing', async () => {
  const drive = fakeDrive(); const fired = []; let passed = null;
  const d = { drive, folder: 'MEM', fire: async (req, path) => { fired.push(path); return true; },
    list: async (id) => tree[id] || [], runPass: async (dr, o) => { passed = o; return { summary: { objects_seen: o.listing.items.length } }; } };
  // root of a shared-drive / folder firm
  const { firmDriveId } = await import('../lib/google-connection.js');
  void firmDriveId;
  const s0 = await startScan('org', {}, d);
  assert.equal(s0.started, true); assert.equal(fired.length, 1);
  // force the root id (no firm drive loaded in this unit test)
  const st = JSON.parse(Buffer.from([...drive.files.values()][0].buffer).toString()); st.queue = [{ id: 'R', path: '' }];
  [...drive.files.values()][0].buffer = Buffer.from(JSON.stringify(st));
  const s1 = await scanStep('org', {}, { ...d, budgetMs: 0 });   // budget 0: one folder per step at least? none
  assert.equal(s1.status, 'walking');
  let s = s1; let guard = 0;
  while (s.status === 'walking' && guard++ < 20) s = await scanStep('org', {}, { ...d, budgetMs: 5 });
  assert.equal(s.status, 'done');
  assert.equal(passed.listing.items.length, 4);
  assert.equal(passed.listing.complete, true);
  assert.deepEqual(passed.listing.items.map(i => i.path), ['/Clients', '/note.pdf', '/Clients/CAC 2026', '/Clients/CAC 2026/lettre.docx']);
  const v = await scanStatus({ drive, folder: 'MEM' });
  assert.equal(v.files_seen, 2); assert.equal(v.folders_seen, 2);
});
