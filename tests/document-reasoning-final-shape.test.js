// A « final result » without the fields the task expects is not a final result (2026-11-03). Seen on a real mission: a data sheet
// stayed empty with no error, the AI's last answer held no orders (not even « understanding ») and was taken as « no order ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { reasonWithDocuments, documentIdsIn, unwrapFinal } from '../lib/document-reasoning.js';
import { isFinalOrders } from '../lib/fill-orders.js';

function fixture() {
  const state = { editable: true, card: { objective: 'Remplir D1' }, line: { code: 'X-01' }, workpaper: { file_id: 'WP' }, work: { id: 'W', status: 'in_progress', walkthrough: [] } };
  const documents = [{ id: 'GL', name: 'grand livre' }];
  let answers = [], calls = 0;
  const d = { permissions: async () => ({ granted: true }), view: async () => structuredClone(state),
    save: async (_, row, patch) => { Object.assign(state.work, structuredClone(patch)); return structuredClone(state.work); },
    readDocumentWindow: async doc => ({ file_id: doc.id, revision: 'v1||', window: { text: 'écritures' } }),
    ai: async (_, request) => { calls++; const a = answers.shift(); return { provider: 'test', text: JSON.stringify(typeof a === 'function' ? a(JSON.parse(request.input)) : a) }; } };
  const drive = { getMeta: async () => ({ modifiedTime: 'v1' }) };
  const run = () => reasonWithDocuments({ org: 'O', mission: 'M', code: 'X-01', view: structuredClone(state), documents, drive, task: 'Remplir', context: { sheet: 'D1' },
    schema: '{"understanding":"…","blocks":[]}', evidenceIds: documentIdsIn, key: 'fill:D1', body: {}, account: {}, isFinal: isFinalOrders }, d);
  return { run, say: (...a) => { answers.push(...a); }, calls: () => calls };
}

test('an answer with neither a read nor the expected fields is refused, the AI is told, then the error is said — never « no order » in silence', async () => {
  const f = fixture();
  f.say({ note: 'je réfléchis' });
  let r = await f.run(); assert.equal(r.result, null); assert.equal(r.ai_error, null); assert.equal(r.pending, true);
  f.say(input => { assert.equal(input.feedback.at(-1).refused, 'FINAL_RESULT_WITHOUT_EXPECTED_FIELDS'); return { note: 'toujours rien' }; });
  r = await f.run();
  assert.match(r.ai_error, /AI_ANSWER_WITHOUT_RESULT/); assert.equal(r.result, null);
});

test('orders put one level down (« {"orders": {…}} ») are found and used', async () => {
  const f = fixture();
  f.say({ inspect: { file_id: 'GL', page: 1 } }); await f.run(); await f.run();
  f.say({ orders: { understanding: 'les dépenses du projet', blocks: [{ document_id: 'GL', rows: { from: 5, to: 40 }, columns: [{ target: 'B', source: 'A' }] }] } });
  let r = await f.run(); r = await f.run();
  assert.equal(r.result.understanding, 'les dépenses du projet'); assert.equal(r.result.blocks[0].document_id, 'GL');
});

test('a real « nothing to fill » answer (understanding + missing, no block) is still accepted as final', () => {
  const ok = { understanding: 'grand livre général absent', blocks: [], missing: [{ target: 'B', piece: 'grand livre général' }] };
  assert.equal(unwrapFinal(ok, isFinalOrders), ok);
  assert.equal(unwrapFinal({ thinking: 'x' }, isFinalOrders), null);
  assert.equal(unwrapFinal({ anything: 1 }, null).anything, 1, 'without a check, as before');
});
