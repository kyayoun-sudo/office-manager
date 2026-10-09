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

function scanState(drive) {
  return JSON.parse(Buffer.from([...drive.files.values()][0].buffer).toString());
}

test('a saved page cursor survives a crash, replay does not duplicate IDs, and mapping never reads content', async () => {
  const drive = fakeDrive(); let crash = true, passed;
  const tokens = [];
  const d = { drive, folder: 'MEM', root: { id: 'R', path: '' }, budgetMs: 10000, fire: async () => true,
    listPage: async (id, ctx) => {
      tokens.push(ctx.pageToken);
      if (!ctx.pageToken) return { files: [{ id: 'x', name: 'x.pdf', mimeType: 'application/pdf' }], nextPageToken: 'P2' };
      if (crash) {
        crash = false;
        // Terminate at the boundary after page 1 was persisted, before page 2 is accepted.
        throw new Error('GOOGLE_API_503');
      }
      return { files: [{ id: 'x', name: 'x.pdf', mimeType: 'application/pdf' },
        { id: 'y', name: 'y.pdf', mimeType: 'application/pdf' }], nextPageToken: null };
    }, runPass: async (dr, o) => { passed = o; return { summary: {} }; } };
  await startScan('org', {}, d);
  let s = await scanStep('org', {}, d);
  assert.equal(s.status, 'incomplete'); assert.equal(passed, undefined);
  const before = scanState(drive);
  assert.equal(before.failed_queue[0].next_page_token, 'P2');
  assert.equal(before.failed_queue[0].status, 'ERROR_RETRYABLE');
  assert.equal(before.items.length, 1); assert.equal(s.folders_scanned, 0);
  // Backoff has not expired: no background call is launched.
  assert.equal((await startScan('org', {}, d)).started, false);
  before.failed_queue[0].next_retry_at = '2020-01-01';
  [...drive.files.values()][0].buffer = Buffer.from(JSON.stringify(before));
  const resumed = await startScan('org', {}, d);
  assert.equal(resumed.resumed, true); assert.equal(resumed.run_id, before.run_id);
  s = await scanStep('org', {}, d);
  assert.equal(s.status, 'done'); assert.equal(s.folders_scanned, 1);
  assert.deepEqual(tokens, [null, 'P2', 'P2']);
  assert.deepEqual(passed.listing.items.map(i => i.id), ['x', 'y']);
  assert.equal(passed.maxReads, 0); assert.equal(passed.listing.complete, true);
});

test('an inaccessible folder keeps the scan incomplete and cannot produce false disappearances', async () => {
  const drive = fakeDrive(); let passed = 0;
  const d = { drive, folder: 'MEM', root: { id: 'R', path: '' }, fire: async () => true,
    list: async () => { throw new Error('GOOGLE_API_403: permissionDenied'); }, runPass: async () => { passed++; return { summary: {} }; } };
  await startScan('org', {}, d);
  const initial = scanState(drive);
  initial.previous = { at: 'T0', seen: { old: 'T0' } };
  [...drive.files.values()][0].buffer = Buffer.from(JSON.stringify(initial));
  const s = await scanStep('org', {}, d);
  assert.equal(s.status, 'incomplete'); assert.equal(s.complete, false);
  assert.equal(s.blocked_folders, 1); assert.equal(s.folders_left, 1);
  assert.equal(s.delta, null); assert.equal(passed, 0);
  assert.deepEqual(scanState(drive).previous.seen, { old: 'T0' });
});

test('the size guard reports incomplete instead of mapping an unfinished tree', async () => {
  const drive = fakeDrive(); let passed = 0;
  const d = { drive, folder: 'MEM', root: { id: 'R', path: '' }, maxItems: 2, fire: async () => true,
    list: async id => tree[id] || [], runPass: async () => { passed++; return { summary: {} }; } };
  await startScan('org', {}, d);
  const s = await scanStep('org', {}, d);
  assert.equal(s.status, 'incomplete'); assert.equal(s.reason, 'ITEM_LIMIT');
  assert.equal(s.folders_left, 1); assert.equal(passed, 0);
  assert.equal((await startScan('org', {}, d)).started, false);
});

test('new runs compare permanent IDs, retain first-seen time and combine rename, move and modification', async () => {
  const drive = fakeDrive(); let generation = 0;
  const d = { drive, folder: 'MEM', root: { id: 'R', path: '' }, fire: async () => true,
    list: async () => [{ id: 'x', name: generation ? 'renamed.pdf' : 'x.pdf', mimeType: 'application/pdf',
      parents: generation ? ['other'] : ['R'], modifiedTime: generation ? 'T2' : 'T1', createdTime: 'T0', size: '42' }],
    runPass: async () => ({ summary: {} }) };
  await startScan('org', {}, d); await scanStep('org', {}, d);
  const first = scanState(drive); generation++;
  const next = await startScan('org', {}, d);
  assert.notEqual(next.run_id, first.run_id);
  const s = await scanStep('org', {}, d);
  assert.deepEqual([s.delta.added, s.delta.modified, s.delta.renamed, s.delta.moved], [0, 1, 1, 1]);
  const item = scanState(drive).items[0];
  assert.equal(item.first_seen_at, first.items[0].first_seen_at);
  assert.equal(item.createdTime, 'T0'); assert.equal(item.scan_status, 'DISCOVERED');
});

test('shortcuts are observed as shortcuts and never traversed as folders; duplicate folders are walked once', async () => {
  const drive = fakeDrive(); const calls = [];
  const d = { drive, folder: 'MEM', root: { id: 'R', path: '' }, fire: async () => true,
    list: async id => { calls.push(id); return id === 'R' ? [tree.R[0], tree.R[0],
      { id: 's', name: 'shortcut', mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: 'A' } }] : []; },
    runPass: async () => ({ summary: {} }) };
  await startScan('org', {}, d); await scanStep('org', {}, d);
  assert.deepEqual(calls, ['R', 'A']);
  const item = scanState(drive).items.find(i => i.id === 's');
  assert.equal(item.is_shortcut, true); assert.equal(item.shortcutDetails.targetId, 'A');
  assert.equal(scanState(drive).items.length, 2);
});

test('a scan cannot be resumed by another organisation or under another root', async () => {
  const drive = fakeDrive(); const d = { drive, folder: 'MEM', root: { id: 'R', path: '' }, fire: async () => true };
  await startScan('org', {}, d);
  await assert.rejects(startScan('other', {}, d), /SCAN_SCOPE_MISMATCH/);
  await assert.rejects(scanStep('other', {}, d), /SCAN_SCOPE_MISMATCH/);
  await assert.rejects(startScan('org', {}, { ...d, root: { id: 'OTHER' } }), /SCAN_SCOPE_MISMATCH/);
  await assert.rejects(scanStep('org', {}, { ...d, root: { id: 'OTHER' } }), /SCAN_SCOPE_MISMATCH/);
});

test('an empty but fully traversed Drive completes; restarting the last saved walking checkpoint does not restart the tree', async () => {
  const drive = fakeDrive(); let lists = 0, mapped = 0;
  const d = { drive, folder: 'MEM', root: { id: 'R', path: '' }, fire: async () => true,
    list: async () => { lists++; return []; }, runPass: async () => { mapped++; return { summary: {} }; } };
  await startScan('org', {}, d);
  const before = scanState(drive); before.queue = []; before.scanned_folder_ids = ['R'];
  [...drive.files.values()][0].buffer = Buffer.from(JSON.stringify(before));
  const resumed = await startScan('org', {}, d);
  assert.equal(resumed.run_id, before.run_id); assert.equal(resumed.resumed, true);
  const result = await scanStep('org', {}, d);
  assert.equal(result.status, 'done'); assert.equal(result.files_seen, 0);
  assert.equal(lists, 0); assert.equal(mapped, 1);
});
