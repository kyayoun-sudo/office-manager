import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { shiftRows, extendRanges, extendTable } from '../lib/workfile-extend.js';
import { proposeImport, acceptImport } from '../lib/workfile-import-assist.js';

test('copy-down moves relative rows only; quoted text is never touched', () => {
  assert.equal(shiftRows('IF(D10="","D10",COUNTIF($D$5:$D$10,D10))', 2), 'IF(D12="","D10",COUNTIF($D$5:$D$10,D12))');
  assert.equal(shiftRows('D1_GL_PROJET!$H$5+LOG10(A3)', 1), 'D1_GL_PROJET!$H$5+LOG10(A4)');
});

test('ranges of the table are prolonged in every sheet, others are not', () => {
  assert.equal(extendRanges("SUM(D1_GL_PROJET!$H$5:$H$10)+SUM('D1_GL_PROJET'!A5:A10)+SUM(D2_BUDGET!$H$5:$H$10)", 'X', 'D1_GL_PROJET', 5, 10, 20),
    "SUM(D1_GL_PROJET!$H$5:$H$20)+SUM('D1_GL_PROJET'!A5:A20)+SUM(D2_BUDGET!$H$5:$H$10)");
  assert.equal(extendRanges('SUM($H$5:$H$10)+SUM($H$6:$H$9)', 'D1_GL_PROJET', 'D1_GL_PROJET', 5, 10, 20), 'SUM($H$5:$H$20)+SUM($H$6:$H$9)');
});

const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
const DARK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
async function workbook() {
  const w = new ExcelJS.Workbook(), s = w.addWorksheet('D1_GL_PROJET');
  ['Date', 'Compte', 'Libellé', 'Montant', 'Double ?'].forEach((h, i) => { const c = s.getCell(4, i + 1); c.value = h; c.fill = DARK; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });
  for (let r = 5; r <= 7; r++) {
    for (let c = 1; c <= 4; c++) s.getCell(r, c).fill = YELLOW;
    s.getCell(r, 5).value = { formula: `IF(D${r}="","",COUNTIF($D$5:$D$7,D${r}))` }; s.getCell(r, 5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  }
  s.getCell('G2').value = { formula: 'SUM($D$5:$D$7)' };
  w.addWorksheet('PRJ-04').getCell('C11').value = { formula: 'SUM(D1_GL_PROJET!$D$5:$D$7)' };
  return w;
}

test('a table made larger keeps formats, formulas and the totals of the other sheets', async () => {
  const w = await workbook();
  const r = extendTable(w, 'D1_GL_PROJET', { first_row: 5, last_row: 7 }, 10);
  assert.deepEqual([r.added, r.from_row, r.to_row], [3, 8, 10]);
  const s = w.getWorksheet('D1_GL_PROJET');
  assert.equal(s.getCell('E10').value.formula, 'IF(D10="","",COUNTIF($D$5:$D$10,D10))');
  assert.equal(s.getCell('A10').fill.fgColor.argb, 'FFFFF7CC');
  assert.equal(s.getCell('G2').value.formula, 'SUM($D$5:$D$10)');
  assert.equal(w.getWorksheet('PRJ-04').getCell('C11').value.formula, 'SUM(D1_GL_PROJET!$D$5:$D$10)');
});

test('content below the table is never written over: rows are inserted and it moves down', async () => {
  const w = await workbook(); w.getWorksheet('D1_GL_PROJET').getCell('B9').value = 'note';
  const r = extendTable(w, 'D1_GL_PROJET', { first_row: 5, last_row: 7 }, 10);
  assert.equal(r.rows_inserted, 3);
  assert.equal(w.getWorksheet('D1_GL_PROJET').getCell('B12').value, 'note');
  assert.equal(w.getWorksheet('D1_GL_PROJET').getCell('B9').value, null);
});

test('import of more entries than the table: refused without permission, done with « agrandis »', async () => {
  let wp = Buffer.from(await (await workbook()).xlsx.writeBuffer()), modified = 1;
  const b = new ExcelJS.Workbook(), x = b.addWorksheet('GL');
  [['Date', 'Compte', 'Libellé', 'Débit', 'Crédit'], ['2024-01-02', '601', 'a', 10, 0], ['2024-01-03', '602', 'b', 20, 0], ['2024-01-04', '603', 'c', 30, 0], ['2024-01-05', '521', 'd', 0, 60], ['2024-01-06', '604', 'e', 5, 0]].forEach(r => x.addRow(r));
  const gl = Buffer.from(await b.xlsx.writeBuffer());
  const view = { editable: true, line: { code: 'PRJ-04' }, card: { steps: [{ text: 'Importer le GL.' }] }, workpaper: { file_id: 'WP' }, work: { status: 'to_do', walkthrough: [] } };
  const d = { view: async () => view, fetchRows: async () => [{ period_label: 'Exercice 2024' }], sources: async () => [{ file_id: 'G', name: 'x.xlsx' }], ai: async () => { throw new Error('none'); },
    save: async (o, wk, c) => Object.assign(view.work, c), review: async (o, m, c, bd) => { view.work.walkthrough.find(y => y.id === bd.plan_id).confirmation = { status: 'confirmed' }; },
    drive: { getMeta: async id => id === 'WP' ? { name: 'W.xlsx', size: wp.length, modifiedTime: 'v' + modified } : { name: 'x.xlsx', size: gl.length, modifiedTime: 'x' },
      downloadBuffer: async id => id === 'WP' ? wp : gl, updateBinary: async (id, o) => { wp = o.buffer; modified++; } } };
  const paul = { email: 'paul@x.ci' };
  const p = await proposeImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET' }, paul, d);
  const items = p.items.map(i => ({ file_id: i.file_id, sheet: i.sheet, rows: i.rows, mapping: i.mapping }));
  await assert.rejects(acceptImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET', items }, paul, d), /TABLE_TOO_SMALL/);
  const r = await acceptImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET', items, extend: true }, paul, d);
  assert.equal(r.done[0].rows, 5);
  assert.equal(r.done[0].extended.added, 2);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(wp); const s = back.getWorksheet('D1_GL_PROJET');
  assert.deepEqual([5, 6, 7, 8, 9].map(n => s.getCell('D' + n).value), [10, 20, 30, -60, 5]);
  assert.equal(s.getCell('E9').value.formula, 'IF(D9="","",COUNTIF($D$5:$D$9,D9))');
  assert.equal(back.getWorksheet('PRJ-04').getCell('C11').value.formula, 'SUM(D1_GL_PROJET!$D$5:$D$9)');
});
