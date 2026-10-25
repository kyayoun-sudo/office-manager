import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { cleanPipeline, runPipeline, planPipeline, writePipeline, PIPELINE_MARK } from '../lib/audit-pipeline.js';

const rows = [
  { row: 2, date: '2025-03-01', account: '605300', label: 'Fournitures bureau', ref: 'F1', party: 'ALPHA', debit: 150000, credit: 0, amount: 150000 },
  { row: 3, date: '2025-03-01', account: '605300', label: 'Fournitures bureau', ref: 'F1', party: 'ALPHA', debit: 150000, credit: 0, amount: 150000 },
  { row: 4, date: '2025-03-08', account: '622000', label: 'Loyer', ref: 'L3', party: 'IMMO', debit: 500000, credit: 0, amount: 500000 },
  { row: 5, date: '2025-12-29', account: '605300', label: 'Carburant', ref: 'C9', party: 'TOTAL', debit: 72350, credit: 0, amount: 72350 },
  { row: 6, date: '2026-01-04', account: '605300', label: 'Carburant', ref: 'C10', party: 'TOTAL', debit: 81200, credit: 0, amount: 81200 },
  { row: 7, date: '2025-06-10', account: '401000', label: 'Règlement', ref: 'R1', party: 'ALPHA', debit: 0, credit: 300000, amount: -300000 }
];

test('the code refuses what is not in the closed list or not in the mission', () => {
  const c = cleanPipeline([{ op: 'eval', params: {} }, { op: 'compare', params: { with_file_id: 'outside' } }, { op: 'filter', params: { accounts: ['6'] } }], ['gl']);
  assert.equal(c.ready, false);
  assert.equal(c.steps.length, 2);
  assert.ok(c.problems.some(p => /inconnue/.test(p)) && c.problems.some(p => /pas une pièce de la mission/.test(p)));
});

test('a multi-step test runs by code with a trace, and the same seed gives the same sample', () => {
  const pipe = cleanPipeline([{ op: 'filter', params: { accounts: ['6'] } }, { op: 'duplicates', params: { by: ['date', 'amount', 'ref'] } }], ['gl']);
  const r = runPipeline(rows, pipe);
  assert.deepEqual(r.rows.map(x => x.row), [2, 3]);
  assert.deepEqual(r.trace.map(t => [t.op, t.in, t.out]), [['filter', 6, 5], ['duplicates', 5, 2]]);
  assert.ok(r.flags[0].text.includes('2, 3'));
  const s = cleanPipeline([{ op: 'sample', params: { size: 3, seed: 'x' } }], ['gl']);
  assert.deepEqual(runPipeline(rows, s).rows.map(x => x.row), runPipeline(rows, s).rows.map(x => x.row));
  const cut = runPipeline(rows, cleanPipeline([{ op: 'cutoff', params: { days: 10 } }], ['gl'], { end: '2025-12-31' }));
  assert.deepEqual(cut.rows.map(x => x.row), [5, 6]);
  assert.ok(cut.flags.some(f => f.kind === 'after_close'));
  const g = runPipeline(rows, cleanPipeline([{ op: 'group', params: { by: 'account' } }], ['gl']));
  assert.equal(g.rows.find(x => x.key === '605300').amount, 453550);
  const cmp = runPipeline(rows, cleanPipeline([{ op: 'compare', params: { with_file_id: 'bal' } }], ['gl', 'bal']), { bal: [{ account: '605300', amount: 453550 }, { account: '622000', amount: 400000 }] });
  assert.equal(cmp.rows.find(x => x.key === '622000').difference, 100000);
  assert.equal(cmp.flags.filter(f => f.kind === 'difference').length, 2);   // 622000 and 401000 (absent from the trial balance)
  const ck = runPipeline(rows, cleanPipeline([{ op: 'top', params: { n: 2 } }, { op: 'checklist', params: { columns: ['Facture ?'] } }], ['gl']));
  assert.ok(ck.columns.includes('Facture ?') && ck.rows.length === 2);
});

async function fakes() {
  const wp = new ExcelJS.Workbook(); wp.addWorksheet('C02_ACH-03').getCell('A1').value = 'Test';
  let wpBuf = Buffer.from(await wp.xlsx.writeBuffer());
  const saved = []; let aiCalls = 0;
  const work = { id: 'w1', status: 'in_progress', walkthrough: [] };
  const view = { editable: true, work, line: { code: 'C02_ACH-03', title: 'Doublons' }, card: { objective: 'Pas de doublons', steps: [{ text: 'Rechercher les doublons de factures dans le grand livre des achats' }] }, workpaper: { file_id: 'wp' } };
  const drive = {
    getMeta: async id => ({ id, name: id === 'wp' ? 'WP.xlsx' : 'GL.xlsx', modifiedTime: 't1' }),
    downloadBuffer: async id => wpBuf,
    updateBinary: async (id, { buffer }) => { wpBuf = buffer; }
  };
  const header = ['Date', 'Compte', 'Libellé', 'Pièce', 'Débit', 'Crédit'];
  const d = {
    view: async () => view, drive, fetchRows: async () => [{ period_label: 'Exercice 2025' }],
    loop: { listRequests: async () => [] }, missionDocuments: async () => [{ id: 'gl', name: 'GL_2025.xlsx', type: 'grand livre' }, { id: 'wp', name: 'WP.xlsx' }],
    clientTable: async id => ({ meta: { id, name: 'GL_2025.xlsx', modifiedTime: 't0' }, header_row: 0, rows: [header, ...rows.map(r => [r.date, r.account, r.label, r.ref, r.debit, r.credit])] }),
    peek: async () => ({ sheets: [{ name: 'GL', rows: [header] }] }), permissions: async () => ({ granted: true }),
    ai: async () => { aiCalls++; return { provider: 'fake', text: JSON.stringify({ understood: 'Doublons date + montant + pièce sur les achats', source_file_id: 'gl', pipeline: [{ op: 'filter', params: { accounts: ['6'] } }, { op: 'duplicates', params: { by: ['date', 'amount', 'ref'] } }, { op: 'checklist', params: { columns: ['Facture vue ?'] } }], questions: [] }) }; },
    save: async (o, w, ch) => { saved.push(ch); work.walkthrough = ch.walkthrough; }, audit: async () => null, now: () => '2026-10-25T10:00:00Z'
  };
  return { d, view, calls: () => aiCalls, wb: async () => { const b = new ExcelJS.Workbook(); await b.xlsx.load(wpBuf); return b; } };
}

test('opening the step: the agent understands, the code runs, results shown; reopening does not ask the AI again', async () => {
  const f = await fakes();
  const r = await planPipeline('o', 'm', 'C02_ACH-03', { step: 1 }, { email: 'a@x' }, f.d);
  assert.equal(r.ready, true);
  assert.equal(r.count, 2);
  assert.deepEqual(r.rows.map(x => x.row), [2, 3]);
  assert.ok(r.columns.some(c => c.key === 'Facture vue ?'));
  const again = await planPipeline('o', 'm', 'C02_ACH-03', { step: 1 }, { email: 'a@x' }, f.d);
  assert.equal(again.ai, 'cached'); assert.equal(f.calls(), 1); assert.equal(again.count, 2);
  // a source outside the mission proposed by the AI is refused by the code
  f.d.ai = async () => ({ text: JSON.stringify({ source_file_id: 'elsewhere', pipeline: [{ op: 'top', params: { n: 3 } }] }) });
  const bad = await planPipeline('o', 'm', 'C02_ACH-03', { text: 'Les 3 plus gros montants' }, { email: 'a@x' }, f.d);
  assert.equal(bad.ready, false); assert.ok(bad.problems[0].includes('pas une pièce de la mission'));
});

test('« Écrire » puts the result in a separate sheet of the working file, read back; nothing written before', async () => {
  const f = await fakes();
  const r = await planPipeline('o', 'm', 'C02_ACH-03', { step: 1 }, { email: 'a@x' }, f.d);
  assert.equal((await f.wb()).worksheets.length, 1);
  const w = await writePipeline('o', 'm', 'C02_ACH-03', { key: r.key }, { email: 'a@x' }, f.d);
  assert.equal(w.verified, true); assert.equal(w.sheet, 'C02_ACH-03_T1');
  const ws = (await f.wb()).getWorksheet('C02_ACH-03_T1');
  assert.equal(ws.getCell('A1').value, PIPELINE_MARK);
  // rewriting replaces our own sheet, never another one
  await writePipeline('o', 'm', 'C02_ACH-03', { key: r.key }, { email: 'a@x' }, f.d);
  assert.equal((await f.wb()).worksheets.length, 2);
  await assert.rejects(writePipeline('o', 'm', 'C02_ACH-03', { key: 'unknown' }, { email: 'a@x' }, f.d), /PREPARE_AGAIN/);
});
