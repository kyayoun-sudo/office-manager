// The page's preparation queue (assets/brand-theme.js), 2026-11-03: still one request at a time, but the proposal of a data sheet
// goes before the long readings waiting in the queue. Seen on a real mission: D1 waited more than 8 minutes behind SOP readings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function queue() {
  const src = fs.readFileSync(new URL('../assets/brand-theme.js', import.meta.url), 'utf8');
  const start = src.indexOf('var procedureQueues'), end = src.indexOf('window.OfficeManager = OM;');
  assert.ok(start > 0 && end > start, 'the queue code is found in brand-theme.js');
  const ctx = { OM: {}, Promise };
  vm.runInNewContext(src.slice(start, end), ctx);
  return ctx.OM.queueProcedurePreparation;
}
const tick = () => new Promise(r => setTimeout(r, 5));

test('one request at a time; a data-sheet proposal waiting goes before the long readings waiting; a running request is never stopped', async () => {
  const q = queue(), order = [];
  let release;
  const first = q('m:PRJ-01', () => new Promise(r => { order.push('lecture-1 (en cours)'); release = r; }));
  const later = ['lecture-2', 'lecture-3'].map(n => q('m:PRJ-01', async () => { order.push(n); }));
  const d1 = q('m:PRJ-01', async () => { order.push('D1'); return 'proposition D1'; }, 2);
  await tick();
  assert.deepEqual(order, ['lecture-1 (en cours)'], 'nothing else runs while a request runs');
  release('ok');
  assert.equal(await d1, 'proposition D1');
  await Promise.all([first, ...later]);
  assert.deepEqual(order, ['lecture-1 (en cours)', 'D1', 'lecture-2', 'lecture-3']);
});

test('a failed request releases the queue and is not replayed; same priority = order of arrival; other keys do not wait', async () => {
  const q = queue(), order = [];
  const bad = q('k', async () => { order.push('a'); throw new Error('409'); });
  const b = q('k', async () => { order.push('b'); }), c = q('k', async () => { order.push('c'); });
  const other = q('autre', async () => { order.push('x'); });
  await assert.rejects(bad, /409/); await Promise.all([b, c, other]);
  assert.deepEqual(order.filter(x => x !== 'x'), ['a', 'b', 'c']); assert.ok(order.includes('x'));
  assert.equal(order.filter(x => x === 'a').length, 1, 'never replayed');
});
