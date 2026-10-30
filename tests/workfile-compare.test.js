import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { compareWorkbooks, normalise, reportMarkdown } from '../lib/workfile-compare.js';

async function book(rows, { formula = false } = {}) {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('D2_BUDGET');
  ws.addRow(['Catégorie', 'Budget initial', 'Budget final', 'Amendements']);
  for (const r of rows) ws.addRow(r);
  if (formula) ws.getCell('D2').value = { formula: 'C2-B2', result: 100 };
  wb.addWorksheet('LISTS').addRow(['Oui', 'Non']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('the same amount written differently is the same; dates by day; text without case or spaces', () => {
  assert.deepEqual(normalise('1 234,50'), { kind: 'number', value: 1234.5 });
  assert.deepEqual(normalise('1,234.50'), { kind: 'number', value: 1234.5 });
  assert.deepEqual(normalise('(500)'), { kind: 'number', value: -500 });
  assert.deepEqual(normalise('31/12/2024'), { kind: 'date', value: '2024-12-31' });
  assert.deepEqual(normalise(new Date('2024-12-31T00:00:00Z')), { kind: 'date', value: '2024-12-31' });
  assert.deepEqual(normalise('  Frais   de  mission '), { kind: 'text', value: 'frais de mission' });
  assert.equal(normalise('   '), null);
});

test('the agent is measured against the auditor: same, different, missing, extra; formulas left out', async () => {
  const auditor = await book([['601100', 1000, 1100], ['602000', 500, 450], ['605000', 200, 200]], { formula: true });
  const agent = await book([['601100', '1 000', 1100], ['602000', 500, 400], [null, null, null], ['999999', 1, 1]], { formula: true });
  const r = await compareWorkbooks(auditor, agent, { sheets: ['D2_BUDGET'] });
  const s = r.sheets[0];
  assert.equal(s.status, 'compared');
  assert.equal(s.different, 1, '450 vs 400');
  assert.equal(s.missing, 3, 'row 4 left empty by the agent');
  assert.equal(s.extra, 3, 'row 5 added by the agent');
  assert.equal(s.formulas_left_out, 1);
  assert.equal(s.same, 9, '4 headers + A2, B2 (« 1 000 » = 1000), C2, A3, B3');
  assert.ok(r.differences.some(d => d.cell === 'C3' && d.kind === 'different' && d.reference === '450' && d.candidate === '400'));
  assert.equal(r.totals.accuracy, 69.2, '9 right out of the 13 cells the auditor filled');
  const md = reportMarkdown(r, { reference: 'auditeur.xlsx', candidate: 'agent.xlsx' });
  assert.match(md, /Justesse/); assert.match(md, /\| D2_BUDGET \| C3 \| différente \| 450 \| 400 \|/);
});

test('identical files: 100 %; a sheet the agent never produced is said', async () => {
  const a = await book([['601100', 1000, 1100]]);
  const same = await compareWorkbooks(a, a, { sheets: ['D2_BUDGET'] });
  assert.equal(same.totals.accuracy, 100);
  const r = await compareWorkbooks(a, a, { sheets: ['D2_BUDGET', 'D3_FONDS'] });
  assert.equal(r.sheets.find(s => s.sheet === 'D3_FONDS').status, 'absent_from_reference');
});
