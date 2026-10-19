import test from 'node:test';
import assert from 'node:assert/strict';
import { belongsToDrive, findAtelier } from '../lib/memory-home.js';

// A fake Google Drive API: files with parents and driveId; folder creation recorded.
function fakeApi(files) {
  const created = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const ok = body => ({ ok: true, status: 200, json: async () => body });
    if (init.method === 'POST') { const b = JSON.parse(init.body); const f = { id: 'new' + (created.length + 1), name: b.name, mimeType: b.mimeType, parents: b.parents }; files.push(f); created.push(f); return ok(f); }
    const m = u.pathname.match(/\/files\/([^/]+)$/);
    if (m) { const f = files.find(x => x.id === decodeURIComponent(m[1])); return f ? ok(f) : { ok: false, status: 404, json: async () => ({}) }; }
    const qs = u.searchParams.get('q') || '';
    const parent = qs.match(/'([^']+)' in parents/)?.[1];
    let list = files.filter(f => !parent || (f.parents || []).includes(parent));
    if (/name contains 'manager'/.test(qs)) list = files.filter(f => /manager/i.test(f.name) && f.mimeType === 'application/vnd.google-apps.folder');
    if (u.searchParams.get('corpora') === 'drive') list = list.filter(f => f.driveId === u.searchParams.get('driveId'));
    return ok({ files: list });
  };
  return { fetchImpl, created };
}
const FOLDER = 'application/vnd.google-apps.folder';
const H = { headers: {} };

test('a folder is in the chosen « Mon Drive » folder only if one of its parents is that folder', async () => {
  const { fetchImpl } = fakeApi([
    { id: 'chosen', name: 'Cabinet test', mimeType: FOLDER, parents: ['root'] },
    { id: 'sub', name: 'Clients', mimeType: FOLDER, parents: ['chosen'] },
    { id: 'deep', name: 'x', mimeType: FOLDER, parents: ['sub'] },
    { id: 'other', name: '00_TATY_AI_MANAGER', mimeType: FOLDER, parents: ['realDrive'], driveId: 'realDrive' }
  ]);
  assert.equal(await belongsToDrive('deep', H, { kind: 'folder', driveId: 'chosen', fetchImpl }), true);
  assert.equal(await belongsToDrive('other', H, { kind: 'folder', driveId: 'chosen', fetchImpl }), false);
  assert.equal(await belongsToDrive('other', H, { kind: 'drive', driveId: 'testDrive', fetchImpl }), false);
  assert.equal(await belongsToDrive('other', H, { kind: 'drive', driveId: 'realDrive', fetchImpl }), true);
});

test('another Drive\'s « … AI MANAGER » is never adopted: the home is created in the chosen Drive', async () => {
  const files = [
    { id: 'chosen', name: 'Cabinet test', mimeType: FOLDER, parents: ['root'] },
    { id: 'tatyHome', name: '00_TATY_AI_MANAGER', mimeType: FOLDER, parents: ['realDrive'], driveId: 'realDrive' }
  ];
  const { fetchImpl, created } = fakeApi(files);
  const home = await findAtelier(H, { kind: 'folder', driveId: 'chosen', fetchImpl, create: true });
  assert.notEqual(home.manager.id, 'tatyHome');
  assert.equal(home.manager.created, true); assert.equal(home.created, true);
  assert.deepEqual(created.map(f => [f.name, f.parents[0]]), [['00_OFFICE_MANAGER_AI', 'chosen'], ['MEMORY', created[0].id]]);
});

test('a « … AI MANAGER » already in the chosen Drive is kept (nothing created)', async () => {
  const files = [
    { id: 'chosen', name: 'Cabinet test', mimeType: FOLDER, parents: ['root'] },
    { id: 'clients', name: 'Clients', mimeType: FOLDER, parents: ['chosen'] },
    { id: 'myHome', name: '00 CABINET AI MANAGER', mimeType: FOLDER, parents: ['clients'] },
    { id: 'mem', name: 'MEMORY', mimeType: FOLDER, parents: ['myHome'] },
    { id: 'tatyHome', name: '00_TATY_AI_MANAGER', mimeType: FOLDER, parents: ['realDrive'], driveId: 'realDrive' }
  ];
  const { fetchImpl, created } = fakeApi(files);
  const home = await findAtelier(H, { kind: 'folder', driveId: 'chosen', fetchImpl, create: true });
  assert.equal(home.manager.id, 'myHome'); assert.equal(home.id, 'mem'); assert.equal(created.length, 0);
});

test('two copies of a memory file: never binned; a nearly empty new copy does not beat the real one', async () => {
  const { pickActive } = await import('../lib/memory-home.js');
  const real = { id: 'R', modifiedTime: '2026-10-18', size: '90000' }, empty = { id: 'E', modifiedTime: '2026-10-19', size: '300' };
  assert.equal(pickActive(empty, real).active.id, 'R');
  assert.equal(pickActive({ id: 'N', modifiedTime: '2026-10-19', size: '80000' }, real).active.id, 'N');
});

test('a passing database error does not make the agents forget the firm’s Drive', async () => {
  const g = await import('../lib/google-connection.js');
  g.resetFirmDriveCache();
  await g.loadFirmDrive('org', { fetchRows: async () => [{ drive_id: 'DRV|m:MEM', drive_name: 'Cabinet' }] });
  assert.equal(g.firmMemoryId(), 'MEM');
  g.resetFirmDriveCache(); await g.loadFirmDrive('org', { fetchRows: async () => [{ drive_id: 'DRV|m:MEM', drive_name: 'Cabinet' }] });
  // cache older than a minute, then the database fails: the known Drive is kept
  const r = await g.loadFirmDrive('org', { fetchRows: async () => { throw new Error('timeout'); } });
  assert.equal(g.firmMemoryId(), 'MEM'); assert.ok(r);
});
