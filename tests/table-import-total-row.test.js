import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { previewTableImport, runTableImport } from '../lib/workfile-table-import.js';
import { shiftAfter } from '../lib/workfile-extend.js';

test('references below the table move down when rows are inserted (only that sheet, only rows after it)', () => {
  assert.equal(shiftAfter('SUM(D5:D9)+D10+$D$12+Autre!D12', 'D2', 'D2', 9, 7), 'SUM(D5:D9)+D17+$D$19+Autre!D12');
  assert.equal(shiftAfter("'D2'!B11*2", 'X', 'D2', 9, 3), "'D2'!B14*2");
});

test('a piece longer than the table with a TOTAL line under it: rows inserted above the total, total formula extended', async () => {
  const Y = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } }, D = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  const w = new ExcelJS.Workbook(), s = w.addWorksheet('D2_BUDGET'); s.getCell('A1').value = 'D2 budget';
  const H = ['Catégorie', 'Budget initial', 'Amendements', 'Budget final', 'Réalisé'];
  H.forEach((h, i) => { const c = s.getCell(4, i + 1); c.value = h; c.fill = D; c.font = { bold: true }; });
  for (let r = 5; r <= 9; r++) for (let c = 1; c <= 5; c++) s.getCell(r, c).fill = Y;
  s.getCell('A10').value = 'TOTAL'; s.getCell('D10').value = { formula: 'SUM(D5:D9)' };
  w.addWorksheet('LEAD').getCell('B2').value = { formula: 'D2_BUDGET!D10' };
  let wp = Buffer.from(await w.xlsx.writeBuffer()), mod = 1;
  const src = new ExcelJS.Workbook(), t = src.addWorksheet('TABLEAU'); t.addRow(H);
  for (let i = 0; i < 12; i++) t.addRow(['Ligne ' + i, null, null, 1000 * i, 500 * i]);
  const sb = Buffer.from(await src.xlsx.writeBuffer());
  const view = { editable: true, card: { steps: [{ text: 'Importer le budget' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-03' } };
  const d = { view: async () => view, sources: async () => [{ file_id: 'S', name: 'TEB_TABLEAU_EXTRAIT.xlsx' }], save: async (o, w2, c) => Object.assign(view.work, c), audit: async () => null, noteMissionEvent: async () => null,
    drive: { getMeta: async id => (id === 'WP' ? { name: 'NL.xlsx', size: wp.length, modifiedTime: 'v' + mod } : { name: 'TEB_TABLEAU_EXTRAIT.xlsx', size: sb.length, modifiedTime: 'x' }), downloadBuffer: async id => (id === 'WP' ? wp : sb), updateBinary: async (id, o) => { wp = o.buffer; mod++; } } };
  const body = { sheet: 'D2_BUDGET', step: 1, source_file_id: 'S', source_sheet: 'TABLEAU' };
  const p = await previewTableImport('O', 'M', 'PRJ-03', body, { email: 'p' }, d);
  assert.equal(p.start_row, 5); assert.equal(p.last_row, 9);   // the TOTAL line is not part of the entries
  const mapping = p.columns.filter(c => c.suggested_source != null).map(c => ({ column: c.column, source: c.suggested_source }));
  await assert.rejects(runTableImport('O', 'M', 'PRJ-03', { ...body, revision: p.revision, mapping }, { email: 'p' }, d), /TABLE_TOO_SMALL/);
  const r = await runTableImport('O', 'M', 'PRJ-03', { ...body, revision: p.revision, mapping, extend: true }, { email: 'p' }, d);
  assert.equal(r.rows, 12); assert.equal(r.extended.rows_inserted, 7);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(wp); const b = back.getWorksheet('D2_BUDGET');
  assert.equal(b.getCell('A16').value, 'Ligne 11'); assert.equal(b.getCell('A17').value, 'TOTAL');
  assert.equal(b.getCell('D17').formula, 'SUM(D5:D16)');
  assert.equal(back.getWorksheet('LEAD').getCell('B2').formula, 'D2_BUDGET!D17');
});
