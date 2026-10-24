import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { findSourceFor, proposeImport, acceptImport } from '../lib/workfile-import-assist.js';

// Working file: D1_GL_PROJET with Date, Compte, Libellé, Montant (yellow inputs) and a formula column.
async function fixture() {
  const w = new ExcelJS.Workbook(), s = w.addWorksheet('D1_GL_PROJET');
  ['Date', 'Compte', 'Libellé', 'Montant'].forEach((h, i) => { s.getCell(4, i + 1).value = h; });
  for (let r = 5; r <= 9; r++) { for (let c = 1; c <= 4; c++) s.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } }; s.getCell(r, 5).value = { formula: 'D' + r + '*1', result: 0 }; }
  let wp = Buffer.from(await w.xlsx.writeBuffer()), modified = 'v1';
  // The real grand livre is named « export_032.xlsx »; « grand livre.xlsx » is in fact a budget.
  const book = async (rows, sheet = 'Feuil1') => { const b = new ExcelJS.Workbook(), x = b.addWorksheet(sheet); rows.forEach(r => x.addRow(r)); return Buffer.from(await b.xlsx.writeBuffer()); };
  const files = {
    EXP: { name: 'export_032.xlsx', bytes: await book([['Date', 'Compte', 'Libellé', 'Débit', 'Crédit'], ['2025-01-03', '601100', 'Achat fournitures', 1500, 0], ['2025-01-04', '521000', 'Règlement', 0, 1500]]) },
    BUD: { name: 'grand livre.xlsx', bytes: await book([['Catégorie budgétaire', 'Budget approuvé'], ['Personnel', 200]]) }
  };
  const view = { editable: true, line: { code: 'PRJ-04' }, card: { steps: [{ text: 'Importer le GL du projet.' }] }, workpaper: { file_id: 'WP' }, work: { status: 'to_do', walkthrough: [] } };
  let reviewed = null;
  const d = {
    view: async () => view,
    sources: async () => [{ file_id: 'BUD', name: 'grand livre.xlsx' }, { file_id: 'EXP', name: 'export_032.xlsx', document: 'Grand livre' }],
    save: async (o, wk, c) => Object.assign(view.work, c),
    review: async (o, m, c, b) => { reviewed = b; return { confirmation: { status: 'confirmed' } }; },
    drive: {
      getMeta: async id => id === 'WP' ? { name: 'Working.xlsx', size: wp.length, modifiedTime: modified } : { name: files[id].name, size: files[id].bytes.length, modifiedTime: 'x' },
      downloadBuffer: async id => id === 'WP' ? wp : files[id].bytes,
      updateBinary: async (id, o) => { assert.equal(o.expectedModifiedTime, modified); wp = o.buffer; modified = 'v2'; }
    }
  };
  return { d, wp: () => wp, reviewed: () => reviewed };
}
const paul = { email: 'paul@x.ci' };

test('the grand livre is found by its columns, not by its name', async () => {
  const f = await fixture();
  const r = await findSourceFor('O', 'M', 'PRJ-04', 'D1_GL_PROJET', paul, f.d);
  assert.equal(r.status, 'FOUND');
  assert.equal(r.source.file.file_id, 'EXP');
});

test('the proposal maps the columns and computes Montant = Débit − Crédit, nothing written', async () => {
  const f = await fixture(), before = f.wp();
  const p = await proposeImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET' }, paul, f.d);
  assert.equal(p.status, 'READY');
  assert.equal(p.rows, 2);
  assert.deepEqual(p.mapping.map(m => [m.label, m.source_label]), [['Date', 'Date'], ['Compte', 'Compte'], ['Libellé', 'Libellé'], ['Montant', 'Débit − Crédit']]);
  assert.equal(p.gl_summary.difference, 0);
  assert.equal(f.wp(), before);
});

test('« Oui, importe » writes the rows, keeps the formulas, and closes the receipt with the approval given before', async () => {
  const f = await fixture();
  const p = await proposeImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET' }, paul, f.d);
  const r = await acceptImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET', revision: p.revision }, paul, f.d);
  assert.equal(r.verified, true);
  assert.equal(r.confirmed, true);
  assert.match(f.reviewed().note, /approuvé avant écriture/);
  const w = new ExcelJS.Workbook(); await w.xlsx.load(f.wp()); const s = w.getWorksheet('D1_GL_PROJET');
  assert.equal(s.getCell('B5').value, '601100');
  assert.equal(s.getCell('D5').value, 1500);
  assert.equal(s.getCell('D6').value, -1500);
  assert.equal(s.getCell('E5').formula, 'D5*1');
});

test('a changed proposal is not written', async () => {
  const f = await fixture();
  await assert.rejects(acceptImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET', revision: 'old' }, paul, f.d), /WORK_CHANGED_PREPARE_AGAIN/);
});
