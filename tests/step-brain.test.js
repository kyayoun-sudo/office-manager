import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { directStep, STEP_BRAIN_KIND } from '../lib/step-brain.js';
import { sopRevision } from '../lib/sop-document-work.js';
import { OPERATIONS, planStep, runStep } from '../lib/step-runner.js';
import { readTable } from '../lib/procedure-work.js';

async function fixture() {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('Feuille inconnue').getCell('B4').value = 'Comparer les dépenses aux justificatifs.';
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const sources = Array.from({ length: 65 }, (_, i) => ({ file_id: 'D' + i, name: i === 40 ? 'copie finale inconnue.pdf' : 'pièce ' + i }));
  const view = { editable: true, line: { code: 'X-01' }, card: { steps: [{ text: 'Comparer les dépenses aux justificatifs.' }] }, mission: { period_label: '2026' },
    workpaper: { file_id: 'WP' }, work: { id: 'W', status: 'in_progress', walkthrough: [] } };
  const step = { n: 1, row: null, text: view.card.steps[0].text, source: 'sop' };
  const revisions = { WP: 'v1' }; let asks = 0, reads = 0, saves = 0;
  const d = {
    readDocumentWindow: async (doc, drive, request) => ({ file_id: doc.id, revision: ((await drive.getMeta(doc.id)).modifiedTime + '||'), window: await drive.readText(doc.id,request) }),
    brainLog: () => {}, view: async () => structuredClone(view), permissions: async () => ({ granted: true }),
    loop: { listRequests: async () => [] }, missionDocuments: async () => sources.map(s => ({ id: s.file_id, name: s.name })),
    fetchRows: async () => [], missionBrief: async () => null, noteMission: async () => {}, closeNote: async () => {},
    save: async (org, row, changes) => { assert.equal(org, 'O'); saves++; Object.assign(view.work, structuredClone(changes)); return structuredClone(view.work); },
    drive: { getMeta: async id => ({ modifiedTime: revisions[id] || 'v1', name: id }), downloadBuffer: async () => bytes,
      readText: async (id, options) => { reads++; return { text: 'Contenu réel : convention du bailleur, période 2026.', total_pages: 2 }; },
      updateBinary: async () => { throw new Error('UNEXPECTED_WRITE'); } },
    ai: async () => { asks++; return { provider: 'available', text: JSON.stringify({ understanding: 'Analyse des contenus', orders: [], questions: ['Clarifier la méthode.'] }) }; }
  };
  const args = body => ({ orgId: 'O', missionId: 'M', code: 'X-01', view: structuredClone(view), step, sources, revision: sopRevision(view, step), period: {}, operations: OPERATIONS, body, account: {} });
  const run = body => directStep(args(body || {}), d);
  const order = (action, params) => { d.ai = async () => { asks++; return { provider: 'available', text: JSON.stringify({ understanding: 'Décision fondée sur les lectures', orders: [{ action, params, why: 'Selon le contenu réellement lu' }] }) }; }; };
  return { run, args, order, d, view, step, sources, revisions, counts: () => ({ asks, reads, saves }) };
}

test('the actual step route resumes one AI decision or read per request, including a badly named source beyond the first 30', async () => {
  const f = await fixture();
  const run = body => planStep('O', 'M', 'X-01', { step: 1, ...body }, {}, f.d);
  let p = await run(); assert.equal(p.pending, true); assert.equal(f.counts().asks, 0);
  f.order('read_workbook', { sheet: 'Feuille inconnue', row_from: 1 });
  p = await run({ brain_job: p.brain_job }); assert.equal(f.counts().asks, 1); assert.equal(f.counts().reads, 0);
  p = await run({ brain_job: p.brain_job }); assert.equal(f.counts().asks, 1);
  let job = f.view.work.walkthrough.find(x => x.kind === STEP_BRAIN_KIND);
  assert.equal(job.feedback[0].result.rows[3].cells[0].address, 'B4');
  f.order('next_documents', {}); p = await run({ brain_job: p.brain_job });
  f.d.ai = async (_, request) => {
    const input = JSON.parse(request.input); assert.equal(input.read.documents[10].file_id, 'D40');
    assert.equal(input.read.catalog_remaining, 5);
    return { text: JSON.stringify({ orders: [{ action: 'read_document', params: { file_id: 'D40', page: 1 } }] }) };
  };
  p = await run({ brain_job: p.brain_job }); assert.equal(f.counts().reads, 0);
  p = await run({ brain_job: p.brain_job }); assert.equal(f.counts().reads, 1);
  f.order('choose_plan', { operation: 'extract', document_ids: ['D40'], source_file_id: 'D40', params: { row_from: 4 }, understood: 'Lire les lignes pertinentes.' });
  p = await run({ brain_job: p.brain_job }); assert.equal(p.pending, true);
  p = await run({ brain_job: p.brain_job }); assert.equal(p.ready, true); assert.equal(p.source_file_id, 'D40');
  assert.deepEqual(p.documents_read, ['D40']); assert.equal(p.params.row_from, 4);
  const before = f.counts();
  const resumed = await run({});
  assert.equal(resumed.ready, true);
  assert.equal(f.counts().asks, before.asks, 'reopening does not call the AI for an unchanged prepared plan');
  assert.equal(f.counts().saves, before.saves, 'reopening does not rewrite the checkpoint');
});

test('a model cannot choose a plan without reading the workbook and the selected source', async () => {
  const f = await fixture(); await f.run();
  f.order('choose_plan', { operation: 'extract', document_ids: ['D0'], source_file_id: 'D0' });
  const p = await f.run(); assert.equal(p.plan, null); assert.equal(p.pending, true);
  const job = f.view.work.walkthrough.at(-1); assert.match(job.feedback.at(-1).refused[0].refused, /READ_WORKBOOK/);
});

test('foreign documents are rejected before I/O; refusal returns to the IA', async () => {
  const f = await fixture(); await f.run(); f.order('read_document', { file_id: 'FOREIGN', page: 1 });
  await f.run(); assert.equal(f.counts().reads, 0); assert.match(f.view.work.walkthrough.at(-1).feedback.at(-1).refused[0].refused, /MISSION_DOCUMENT/);
});

test('AI failure is explicit, preserves the checkpoint and never becomes a missing-piece claim', async () => {
  const f = await fixture(); await f.run(); let calls = 0; f.d.ai = async () => { calls++; throw new Error('NO_CREDIT'); };
  const p = await f.run(); assert.equal(p.technical, true); assert.equal(p.pending, false); assert.match(p.ai_error, /NO_CREDIT/);
  assert.equal(p.plan, null); assert.deepEqual(p.questions, []);
  const after = calls, before = f.counts().saves;
  assert.equal((await f.run()).technical, true);
  assert.equal(calls, after, 'reopening does not repeat a failed model call');
  assert.equal(f.counts().saves, before, 'reopening does not rewrite the failure');
  await f.run({ retry_ai: true }); assert.ok(calls > after, 'the explicit retry consults the model');
});

test('an unreadable source returns a tool error, not a false reading receipt', async () => {
  const f = await fixture(); await f.run(); f.order('read_document', { file_id: 'D0', page: 1 }); await f.run();
  f.d.drive.readText = async () => { throw new Error('DRIVE_UNAVAILABLE'); };
  const p = await f.run(); assert.deepEqual(p.documents_read, []);
  assert.equal(f.view.work.walkthrough.at(-1).feedback.at(-1).result.error, 'DRIVE_UNAVAILABLE');
});

test('source changes invalidate previously read evidence', async () => {
  const f = await fixture(); await f.run(); f.order('read_document', { file_id: 'D0', page: 1 }); await f.run(); await f.run();
  f.revisions.D0 = 'v2'; await assert.rejects(f.run(), /DOCUMENT_SOURCE_CHANGED/);
});

test('changed workbook or SOP cannot resume the old brain job', async () => {
  const f = await fixture(); const p = await f.run(); f.revisions.WP = 'v2'; await assert.rejects(f.run({ brain_job: p.brain_job }), /WORK_CHANGED/);
  f.revisions.WP = 'v1'; f.view.card.objective = 'Nouvel objectif'; await assert.rejects(f.run({ brain_job: p.brain_job }), /WORK_CHANGED/);
});

test('a newer checkpoint cannot be overwritten by an in-flight model response', async () => {
  const f = await fixture(); await f.run();
  f.d.ai = async () => { f.view.work.walkthrough[0].seq++; return { text: '{"orders":[]}' }; };
  const resumed = await f.run();
  assert.equal(resumed.pending, true); assert.equal(resumed.phase, 'resume');
  assert.equal(f.view.work.walkthrough[0].seq, resumed.sequence);
});

test('the resumed brain cannot persist into a locked procedure', async () => {
  const f = await fixture(); await f.run(); f.view.editable = false;
  await assert.rejects(planStep('O', 'M', 'X-01', { step: 1 }, {}, f.d), /IN_REVIEW/);
});

test('a changed source can be deliberately reread without getting stuck on its old checkpoint', async () => {
  const f = await fixture(); await f.run(); f.order('read_document', { file_id: 'D0', page: 1 }); await f.run(); await f.run();
  f.revisions.D0 = 'v2'; const p = await f.run({ restart_brain: true });
  assert.equal(p.pending, true); assert.deepEqual(p.documents_read, []);
  assert.equal(f.view.work.walkthrough.filter(x => x.kind === STEP_BRAIN_KIND).length, 1);
});

test('source sheet chosen by the AI is respected instead of the first visible sheet', async () => {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('Ancien budget').addRows([['Compte', 'Libellé', 'Montant'], ['60', 'Ancien', 99]]);
  wb.addWorksheet('Données pertinentes').addRows([['Compte', 'Libellé', 'Montant'], ['60', 'Courant', 120]]);
  const table = await readTable('D', { getMeta: async () => ({ name: 'inconnu.xlsx' }), downloadBuffer: async () => Buffer.from(await wb.xlsx.writeBuffer()) }, 'Données pertinentes');
  assert.equal(table.rows[1][2], 120);
});

test('execution uses the saved AI plan and rejects sources changed since preparation', async () => {
  const f = await fixture(); await f.run();
  f.order('read_workbook', { sheet: 'Feuille inconnue', row_from: 1 }); await f.run(); await f.run();
  f.order('read_document', { file_id: 'D0', page: 1 }); await f.run(); await f.run();
  f.order('choose_plan', { operation: 'extract', document_ids: ['D0'], source_file_id: 'D0' }); await f.run();
  const p = await planStep('O', 'M', 'X-01', { step: 1 }, {}, f.d);
  let called = false;
  f.d.readTable = async id => { called = true; assert.equal(id, 'D0'); throw new Error('EXPECTED_SOURCE_READ'); };
  await assert.rejects(runStep('O', 'M', 'X-01', { plan: { ...p, source_file_id: 'D1' } }, {}, f.d), /EXPECTED_SOURCE_READ/);
  assert.equal(called, true); called = false; f.revisions.D0 = 'v2';
  await assert.rejects(runStep('O', 'M', 'X-01', { plan: p }, {}, f.d), /DOCUMENT_SOURCE_CHANGED/);
  assert.equal(called, false);
});
