// Paul, 2026-10-25 : « à vue d'œil on sait où mettre chacun » — the TEB's own columns go to D2's columns by their meaning.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { previewTableImport } from '../lib/workfile-table-import.js';
import { proposeColumn } from '../lib/client-table-understanding.js';
import { mapWorkingFile } from '../lib/workfile-map.js';

const TEB = ['Code', 'Libellé', "Budget de l'exercice", 'Décaissement', 'Engagement', 'Réalisation', 'Crédit disponible', 'Exécution budget %'];
const ROWS = [['601', 'Salaires et indemnités', 1000000, 200000, 300000, 500000, 500000, '50%'], ['605', 'Loyers', 400000, 100000, 0, 100000, 300000, '25%']];

test('code alone reads the meaning of each column, like a person', () => {
  const at = l => proposeColumn(l, TEB, ROWS);
  assert.equal(TEB[at('Catégorie budgétaire').source], 'Libellé');
  assert.equal(TEB[at('Budget final approuvé (document)').source], "Budget de l'exercice");
  assert.equal(at('Budget final approuvé (document)').sure, true);
  assert.equal(TEB[at('Budget initial').source], "Budget de l'exercice");
  assert.equal(at('Budget initial').sure, false);                          // only one budget in the TEB: said, to confirm
  assert.equal(at('Amendements / réallocations (net)').source, null);       // nothing in the TEB: left empty, with the reason
  assert.match(at('Amendements / réallocations (net)').why, /amendements/);
  assert.equal(TEB[at('Engagements au 31/12').source], 'Engagement');
  assert.equal(at('Crédit disponible restant').source, TEB.indexOf('Crédit disponible'));
  assert.equal(at('Montant décaissé').source, TEB.indexOf('Décaissement'));
});

test('D2 as in NL-T01: « Budget final approuvé (document) » is the document amount (not a decision) and is proposed from the TEB', async () => {
  const Y = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } }, D = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  const w = new ExcelJS.Workbook(), s = w.addWorksheet('D2_BUDGET');
  s.getCell('A1').value = 'D2 — Budget approuvé par catégorie';
  s.getCell('A2').value = 'Budget de la convention : initial, amendements / réallocations, final approuvé (document du bailleur).';
  s.getCell('D5').value = { formula: 'SUM(D2_BUDGET!$D$11:$D$50)' };
  ['Catégorie budgétaire', 'Budget initial', 'Amendements / réallocations (net)', 'Budget final approuvé (document)', 'Engagements au 31/12', 'Élig PRJ-03']
    .forEach((h, i) => { const c = s.getCell(10, i + 1); c.value = h; c.fill = D; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });
  for (let r = 11; r <= 50; r++) { for (let c = 1; c <= 5; c++) s.getCell(r, c).fill = Y; s.getCell(r, 6).value = { formula: `IF(D${r}>0,"Oui","")` }; }
  const map = mapWorkingFile(w), d2 = map.sheets.find(x => x.name === 'D2_BUDGET');
  assert.equal(d2.tables[d2.main].columns.find(c => c.col === 'D').role, 'fact');
  let wp = Buffer.from(await w.xlsx.writeBuffer());
  const src = new ExcelJS.Workbook(), t = src.addWorksheet('TABLEAU'); t.addRow(TEB); ROWS.forEach(r => t.addRow(r));
  const sb = Buffer.from(await src.xlsx.writeBuffer());
  const view = { editable: true, card: { steps: [{ text: 'Importer le budget' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-03' } };
  const d = { view: async () => view, sources: async () => [{ file_id: 'S', name: 'TEB_TABLEAU_EXTRAIT.xlsx' }],
    drive: { getMeta: async id => (id === 'WP' ? { name: 'NL.xlsx', size: wp.length, modifiedTime: 'v' } : { name: 'TEB_TABLEAU_EXTRAIT.xlsx', size: sb.length, modifiedTime: 'x' }), downloadBuffer: async id => (id === 'WP' ? wp : sb) } };
  const p = await previewTableImport('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', step: 1, source_file_id: 'S', source_sheet: 'TABLEAU' }, { email: 'p' }, d);
  const got = Object.fromEntries(p.columns.map(c => [c.label, c.suggested_source == null ? null : TEB[c.suggested_source]]));
  assert.deepEqual(got, { 'Catégorie budgétaire': 'Libellé', 'Budget initial': "Budget de l'exercice", 'Amendements / réallocations (net)': null,
    'Budget final approuvé (document)': "Budget de l'exercice", 'Engagements au 31/12': 'Engagement' });
  assert.ok(p.columns.every(c => c.suggested_why));
});
