import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { proposeImport, acceptImport } from '../lib/workfile-import-assist.js';

// Working file: D1_GL_PROJET with Date, Compte, Libellé, Montant, Bailleur (yellow inputs, 6 rows) and a formula column.
async function fixture({ ai } = {}) {
  const w = new ExcelJS.Workbook(), s = w.addWorksheet('D1_GL_PROJET');
  ['Date', 'Compte', 'Libellé', 'Montant', 'Bailleur'].forEach((h, i) => { s.getCell(4, i + 1).value = h; });
  for (let r = 5; r <= 10; r++) { for (let c = 1; c <= 5; c++) s.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } }; s.getCell(r, 6).value = { formula: 'D' + r + '*1', result: 0 }; }
  let wp = Buffer.from(await w.xlsx.writeBuffer()), modified = 1;
  const book = async (rows, sheet = 'Feuil1') => { const b = new ExcelJS.Workbook(), x = b.addWorksheet(sheet); rows.forEach(r => x.addRow(r)); return Buffer.from(await b.xlsx.writeBuffer()); };
  // Two grand livres (2023 and 2024) with unhelpful names; one has a total line; « grand livre.xlsx » is in fact a budget.
  const files = {
    G23: { name: 'export_031.xlsx', bytes: await book([['Date', 'Compte', 'Libellé écriture', 'Débit', 'Crédit', 'Source fin.'], ['2023-03-02', '601100', 'Fournitures', 800, 0, 'FAD'], ['2023-03-05', '521000', 'Règlement', 0, 800, 'FAD']]) },
    G24: { name: 'export_032.xlsx', bytes: await book([['Date', 'Compte', 'Libellé écriture', 'Débit', 'Crédit', 'Source fin.'], ['2024-01-03', '601100', 'Achat fournitures', 1500, 0, 'FAD'], ['', '', 'Total compte 601100', 1500, 0, ''], ['2024-01-04', '521000', 'Règlement', 0, 1500, 'FAD']]) },
    BUD: { name: 'grand livre.xlsx', bytes: await book([['Catégorie budgétaire', 'Budget approuvé'], ['Personnel', 200]]) }
  };
  const view = { editable: true, line: { code: 'PRJ-04' }, card: { steps: [{ text: 'Importer le GL du projet.' }] }, workpaper: { file_id: 'WP' }, work: { status: 'to_do', walkthrough: [] } };
  let aiCalls = 0;
  const d = {
    view: async () => view,
    fetchRows: async () => [{ period_label: '2023 et 2024' }],
    sources: async () => [{ file_id: 'BUD', name: 'grand livre.xlsx' }, { file_id: 'G24', name: 'export_032.xlsx' }, { file_id: 'G23', name: 'export_031.xlsx' }],
    save: async (o, wk, c) => Object.assign(view.work, c),
    review: async (o, m, c, b) => { const rec = view.work.walkthrough.find(x => x.id === b.plan_id); if (rec) rec.confirmation = { status: 'confirmed' }; return {}; },
    ai: ai || (async (order, args) => { aiCalls++; const inp = JSON.parse(args.input); return { provider: 'test-ai', text: JSON.stringify({ sources: inp.pieces.map(p => ({ id: p.id, fits: true, what: 'grand livre général', period: '', why: 'débit, crédit, compte' })),
      checks: inp.pieces.map(p => ({ id: p.id, ok: p.code_mapping.length >= 4, remarks: 'Débit − Crédit correct' })),
      mappings: inp.pieces.map(p => ({ id: p.id, column: 5, source: p.headers.indexOf('Source fin.'), why: 'source de financement = bailleur' })) }) }; }),
    drive: {
      getMeta: async id => id === 'WP' ? { name: 'Working.xlsx', size: wp.length, modifiedTime: 'v' + modified } : { name: files[id].name, size: files[id].bytes.length, modifiedTime: 'x' },
      downloadBuffer: async id => id === 'WP' ? wp : files[id].bytes,
      updateBinary: async (id, o) => { assert.equal(o.expectedModifiedTime, 'v' + modified); wp = o.buffer; modified++; }
    }
  };
  return { d, wp: () => wp, aiCalls: () => aiCalls };
}
const paul = { email: 'paul@x.ci' };

test('both grand livres are found by their columns, each with its year, both ticked; the budget named « grand livre » is not', async () => {
  const f = await fixture();
  const p = await proposeImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET' }, paul, f.d);
  assert.equal(p.status, 'READY');
  assert.deepEqual(p.mission_years, [2023, 2024]);
  assert.deepEqual(p.items.map(i => i.file_id), ['G23', 'G24']);
  assert.ok(p.items.every(i => i.recommended));
  assert.deepEqual(Object.keys(p.items[1].years), ['2024']);
  assert.equal(p.items[1].rows, 2);                       // the total line is set aside, not an entry
  assert.equal(p.items[1].set_aside.count, 1);
  const m = p.items[0].mapping.map(x => [x.label, x.source_label, x.by]);
  assert.deepEqual(m, [['Date', 'Date', 'code'], ['Compte', 'Compte', 'code'], ['Libellé', 'Libellé écriture', 'code'], ['Montant', 'Débit − Crédit', 'code'], ['Bailleur', 'Source fin.', 'ia']]);
  assert.equal(p.ai, 'test-ai');
  assert.deepEqual(p.items[0].check, { ok: true, remarks: 'Débit − Crédit correct' });
  assert.equal(f.aiCalls(), 1);
});

test('without AI no automatic semantic correspondence is selected', async () => {
  const f = await fixture({ ai: async () => { throw new Error('ALL_DOWN'); } });
  const p = await proposeImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET' }, paul, f.d);
  assert.equal(p.ai, 'unavailable');
  assert.equal(p.status, 'AI_UNAVAILABLE');
  assert.deepEqual(p.items, []);
});

test('« Oui, importe » writes 2023 then 2024 below it, total line set aside, formulas kept, receipts closed', async () => {
  const f = await fixture();
  const p = await proposeImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET' }, paul, f.d);
  const r = await acceptImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET', items: p.items.map(i => ({ file_id: i.file_id, sheet: i.sheet, rows: i.rows, mapping: i.mapping })) }, paul, f.d);
  assert.deepEqual(r.done.map(x => [x.file_id, x.rows, x.start_row, x.confirmed]), [['G23', 2, 5, true], ['G24', 2, 7, true]]);
  const w = new ExcelJS.Workbook(); await w.xlsx.load(f.wp()); const s = w.getWorksheet('D1_GL_PROJET');
  assert.deepEqual([5, 6, 7, 8].map(r => s.getCell('D' + r).value), [800, -800, 1500, -1500]);
  assert.equal(s.getCell('E7').value, 'FAD');
  assert.equal(s.getCell('C9').value, null);
  assert.equal(s.getCell('F7').formula, 'D7*1');
});

test('a piece changed since the proposal is not written', async () => {
  const f = await fixture();
  const p = await proposeImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET' }, paul, f.d);
  await assert.rejects(acceptImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET', items: [{ ...p.items[0], rows: 99 }] }, paul, f.d), /WORK_CHANGED_PREPARE_AGAIN/);
});

test('« Annuler cet import » empties only the cells the import wrote, keeps a cell changed since, and is traced', async () => {
  const { undoImport, importsDone } = await import('../lib/workfile-undo.js');
  const f = await fixture();
  const p = await proposeImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET' }, paul, f.d);
  await acceptImport('O', 'M', 'PRJ-04', { sheet: 'D1_GL_PROJET', items: [{ file_id: 'G23', sheet: p.items[0].sheet, rows: p.items[0].rows, mapping: p.items[0].mapping }] }, paul, f.d);
  const view = await f.d.view();
  const imp = importsDone(view)[0];
  assert.equal(imp.rows, 2);
  // Someone corrects one imported cell by hand: it is kept.
  const w = new ExcelJS.Workbook(); await w.xlsx.load(f.wp()); w.getWorksheet('D1_GL_PROJET').getCell('C5').value = 'corrigé à la main';
  await f.d.drive.updateBinary('WP', { buffer: Buffer.from(await w.xlsx.writeBuffer()), expectedModifiedTime: (await f.d.drive.getMeta('WP')).modifiedTime });
  const r = await undoImport('O', 'M', 'PRJ-04', { plan_id: imp.plan_id }, paul, { ...f.d, audit: async () => null });
  assert.equal(r.kept_changed, 1);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(f.wp()); const s = back.getWorksheet('D1_GL_PROJET');
  assert.equal(s.getCell('D5').value, null);
  assert.equal(s.getCell('C5').value, 'corrigé à la main');
  assert.equal(s.getCell('F5').formula, 'D5*1');
  assert.equal(importsDone(view)[0].status, 'undone');
  await assert.rejects(undoImport('O', 'M', 'PRJ-04', { plan_id: imp.plan_id }, paul, f.d), /IMPORT_ALREADY_UNDONE/);
});
