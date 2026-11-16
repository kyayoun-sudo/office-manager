// 2026-11-16: from 4 to 16 November every pass of the Orpailleur failed (DRIVE_DETECTION_INCOMPLETE): a folder as the
// firm's Drive was searched across all drives at once (Google: « incomplete »), and once 1 705 files had changed since its
// last pass, « too many files » failed each pass and the backlog only grew. Now: complete search, then catch-up in slices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oldestSlice } from '../lib/google-drive.js';

const F = 'application/vnd.google-apps.folder';
function storeDrive(store) {
  return {
    findFilesByExactName: async name => store[name] ? [{ id: name, modifiedTime: 't' }] : [],
    downloadBuffer: async id => Buffer.from(JSON.stringify(store[id])),
    getMeta: async () => ({ modifiedTime: 't' }),
    updateBinary: async (id, { buffer }) => { store[id] = JSON.parse(buffer.toString()); },
    createBinary: async ({ name, buffer }) => { store[name] = JSON.parse(buffer.toString()); return { id: name }; }
  };
}
const file = (id, t, created = null) => ({ id, name: id + '.pdf', mimeType: 'application/pdf', parents: ['D1'], modifiedTime: t, createdTime: created || t });

test('the oldest changes come first; a group of files with the same date is never cut in two; under the limit nothing changes', () => {
  const files = [file('c', '2026-11-03T00:00:00Z'), file('a', '2026-11-01T00:00:00Z'), file('b2', '2026-11-02T00:00:00Z'), file('b1', '2026-11-02T00:00:00Z'), file('d', '2026-11-04T00:00:00Z')];
  const s = oldestSlice(files, 2);
  assert.deepEqual(s.map(f => f.id).slice(0, 1), ['a']);
  assert.equal(s.length, 3, 'b1 and b2 share the date: both taken');
  assert.equal(s.more, true); assert.equal(s.upTo, '2026-11-02T00:00:00Z');
  // An uploaded file keeps an old modification date: its creation date counts.
  assert.equal(oldestSlice([file('up', '2025-01-01T00:00:00Z', '2026-11-05T00:00:00Z'), file('x', '2026-11-01T00:00:00Z')], 1)[0].id, 'x');
  const all = oldestSlice(files, 10);
  assert.equal(all.length, 5); assert.equal(all.more, undefined);
});

test('a pass with too many changes takes a slice and ends at the date it reached; the next pass continues from there', async () => {
  const { startChangesPass, tidyPlanStep } = await import('../lib/tidy-plan.js');
  const store = { 'OFFICE_MANAGER_SCAN_STATE.json': { items: [{ id: 'D1', name: 'BLE', mimeType: F, path: '/01/BLE' }], finished_at: '2026-09-01' },
    'OFFICE_MANAGER_TIDY_STATE.json': { status: 'done', mode: 'changes', last_pass_at: '2026-10-19T12:00:00Z', first_scan_done: '2026-10-19T11:00:00Z' } };
  const asked = [];
  const slice = Object.assign([file('old1', '2026-10-20T00:00:00Z')], { more: true, upTo: '2026-10-20T00:00:00Z' });
  const d = { drive: storeDrive(store), folder: 'MEM', fire: async () => true, fetchRows: async () => [], writeJournal: async () => null, saveCheckpoint: async () => null,
    loadCheckpoint: async () => null, driveKind: null,
    changedSince: async (since, o) => { asked.push({ since, o }); return asked.length === 1 ? slice : [file('new', '2026-11-16T00:00:00Z')]; },
    readText: async () => 'Relevé bancaire SGCI BLE TRANSIT octobre 2026 solde 12 450 000 FCFA',
    runAI: async () => ({ text: JSON.stringify({ decisions: [{ file_id: 'old1', action: 'ok' }, { file_id: 'new', action: 'ok' }] }) }) };
  const r = await startChangesPass('org', {}, d);
  assert.equal(asked[0].since, '2026-10-19T12:00:00Z');
  assert.equal(asked[0].o.slice, true, 'the pass asks for a slice, never « all or nothing »');
  assert.equal(r.catching_up, true); assert.equal(r.up_to, '2026-10-20T00:00:00Z');
  const st = await tidyPlanStep('org', {}, d);
  assert.equal(st.status, 'done');
  assert.equal(st.last_pass_at, '2026-10-20T00:00:00Z', 'the watermark is the date reached, not the hour of the pass');
  await startChangesPass('org', {}, d);
  assert.equal(asked[1].since, '2026-10-20T00:00:00Z', 'the next pass continues from the date reached');
});
