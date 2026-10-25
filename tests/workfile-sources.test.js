import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseNumber, verifyRows, extractPdfTable, designateSource, chosenIn } from '../lib/workfile-sources.js';
import { finishImport } from '../lib/workfile-import-assist.js';

test('numbers are read as written in French or English documents', () => {
  assert.equal(parseNumber('1 234 567'), 1234567);
  assert.equal(parseNumber('1.234.567,50'), 1234567.5);
  assert.equal(parseNumber('1,234,567.50'), 1234567.5);
  assert.equal(parseNumber('(12 500)'), -12500);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('Personnel'), null);
});

test('a row whose amount is not in the PDF is set aside, never imported', () => {
  const text = 'TABLEAU D EXECUTION BUDGETAIRE 2023\nPersonnel 1 200 000 800 000\nFormation 450 000 300 000\nTotal 1 650 000 1 100 000';
  const { ok, doubt } = verifyRows([['Personnel', '1 200 000', '800 000'], ['Formation', '450000', '300 000'], ['Véhicules', '9 999 999', '1']], text, ['text', 'number', 'number']);
  assert.deepEqual(ok.map(r => r.row[0]), ['Personnel', 'Formation']);
  assert.equal(doubt.length, 1);
  assert.match(doubt[0].missing.join(), /Véhicules|9 999 999/);
});

function workingFile() {
  const w = new ExcelJS.Workbook(), s = w.addWorksheet('D2_BUDGET');
  s.getCell('A1').value = 'D2 — Budget et exécution par catégorie';
  ['Catégorie', 'Budget', 'Réalisé'].forEach((h, i) => { const c = s.getCell(4, i + 1); c.value = h; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }; c.font = { bold: true }; });
  for (let r = 5; r <= 9; r++) for (let c = 1; c <= 3; c++) s.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
  return w;
}

test('a PDF becomes a new Excel next to it: verified rows in TABLEAU, doubtful ones in A_VERIFIER, origin in SOURCE; chosen for the sheet', async () => {
  const wp = Buffer.from(await workingFile().xlsx.writeBuffer());
  const created = {}, notes = [];
  const drive = {
    getMeta: async id => (id === 'TEB' ? { name: 'TEB_2023.pdf', size: 1000, parents: ['P'], mimeType: 'application/pdf' } : created[id] ? { id, webViewLink: 'https://x/' + id } : { size: wp.length }),
    downloadBuffer: async id => (id === 'TEB' ? Buffer.from('%PDF fake') : created[id]?.buffer || wp),
    findFilesByExactName: async () => [],
    createBinary: async ({ name, parentId, buffer }) => { created.N = { name, parentId, buffer }; return { id: 'N' }; }
  };
  const d = { drive, view: async () => ({ editable: true, workpaper: { file_id: 'WP' }, work: { status: 'in_progress' } }), audit: async () => null,
    sources: async () => [{ file_id: 'TEB', name: 'TEB_2023.pdf' }], missionMemory: async () => [], fitName: async n => ({ name: n }),
    readPdf: async () => ({ text: 'TABLEAU D EXECUTION BUDGETAIRE 2023\n213100 Personnel 1 200 000 800 000\n244100 Formation 450 000 300 000', pages_read: [1], ocr_pages: [] }),
    ai: async () => ({ text: JSON.stringify({ what: 'Tableau d’exécution budgétaire', period: '2023', fits: true, headers: ['Code', 'Libellé', 'Budget de l’exercice', 'Engagement'], rows: [['213100', 'Personnel', '1 200 000', '800 000'], ['244100', 'Formation', '450 000', '300 000'], ['999999', 'Inventé', '7 777 777', '1']] }) }),
    noteMissionEvent: async (o, m, f, e) => { notes.push([f, e]); } };
  const r = await extractPdfTable('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', file_id: 'TEB' }, { email: 'paul@x.ci' }, d);
  assert.equal(r.rows, 2); assert.equal(r.to_check, 1);
  assert.equal(created.N.parentId, 'P'); assert.match(created.N.name, /^TEB_2023_TABLEAU_EXTRAIT_[a-f0-9]{10}\.xlsx$/);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(created.N.buffer);
  const t = back.getWorksheet('TABLEAU');
  // the document's OWN columns, codes kept as text, amounts as numbers
  assert.deepEqual([t.getCell('A1').value, t.getCell('C1').value, t.getCell('A2').value, t.getCell('B2').value, t.getCell('C2').value, t.getCell('D3').value], ['Code', 'Budget de l’exercice', '213100', 'Personnel', 1200000, 300000]);
  assert.equal(back.getWorksheet('A_VERIFIER').getCell('B2').value, 'Inventé');
  assert.match(String(back.getWorksheet('SOURCE').getCell('B1').value), /TEB_2023\.pdf/);
  const mine = notes.find(n => n[0] === 'N')[1];
  assert.deepEqual(chosenIn([{ id: 'N', uses: mine.uses }], 'D2_BUDGET'), ['N']);
  // the same bytes again: the extract already made is given back, nothing created twice
  const again = await extractPdfTable('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', file_id: 'TEB' }, { email: 'paul@x.ci' }, { ...d, missionMemory: async () => [{ id: 'N', name: created.N.name, uses: mine.uses }] });
  assert.equal(again.reused, true);
});

test('what the person chose is ticked; the AI preferring the PTBA does not change it', async () => {
  const items = [
    { id: 'PTBA|S', file: { file_id: 'PTBA', name: 'PTBA_2023.xlsx' }, sheet: 'S', by: 'code', p: { source_headers: ['Catégorie', 'Budget'], sample_rows: [], years: { 2023: 10 }, rows: 10, columns: [{ column: 1, label: 'Catégorie' }, { column: 2, label: 'Budget' }] }, mapping: [{ column: 1, source: 0 }, { column: 2, source: 1 }] },
    { id: 'TEB|TABLEAU', file: { file_id: 'TEBX', name: 'TEB_2023_TABLEAU_EXTRAIT.xlsx' }, sheet: 'TABLEAU', by: null, p: { source_headers: ['Catégorie', 'Budget'], sample_rows: [], years: {}, rows: 2, columns: [{ column: 1, label: 'Catégorie' }, { column: 2, label: 'Budget' }] }, mapping: [{ column: 1, source: 0 }, { column: 2, source: 1 }] }];
  const r = await finishImport('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', items }, {}, { fetchRows: async () => [{ period_label: '2023' }], chosenFor: async () => ['TEBX'],
    ai: async () => ({ text: JSON.stringify({ sources: [{ id: 'PTBA|S', fits: true, what: 'PTBA' }, { id: 'TEB|TABLEAU', fits: false, what: 'exécution' }] }) }) });
  const at = id => r.items.find(x => x.file_id === id);
  assert.equal(at('TEBX').recommended, true); assert.equal(at('TEBX').chosen, true);
  assert.equal(at('PTBA').recommended, false);
});

test('choosing a piece writes it in the mission memory; only a piece of the mission', async () => {
  let note = null;
  const d = { view: async () => ({ editable: true }), sources: async () => [{ file_id: 'TEBX', name: 'TEB.xlsx' }], noteMissionEvent: async (o, m, f, e) => { note = [f, e]; } };
  await designateSource('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', file_id: 'TEBX' }, { email: 'p' }, d);
  assert.deepEqual(chosenIn([{ id: note[0], uses: note[1].uses }], 'D2_BUDGET'), ['TEBX']);
  await designateSource('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', file_id: 'TEBX', remove: true }, { email: 'p' }, d);
  assert.deepEqual(chosenIn([{ id: note[0], uses: note[1].uses }], 'D2_BUDGET'), []);
  await assert.rejects(designateSource('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', file_id: 'AUTRE' }, { email: 'p' }, d), /DOCUMENT_SOURCE_CHANGED/);
});

test('in the chat, the auditor names the PDF for D2: chosen and extracted; a piece the auditor did not name is refused', async () => {
  const { executeProcedureActions } = await import('../lib/procedure-workspace.js');
  const calls = [];
  const d = { view: async () => ({ editable: true, work: { status: 'in_progress', walkthrough: [] } }), sources: async () => [{ file_id: 'TEB', name: 'TEB 2023.pdf' }, { file_id: 'PTBA', name: 'PTBA_2023_VF.xlsx' }],
    extractPdfTable: async (o, m, c, b) => { calls.push(['extract', b]); return { name: 'TEB 2023_TABLEAU_EXTRAIT.xlsx', rows: 12, to_check: 1 }; },
    designateSource: async (o, m, c, b) => { calls.push(['choose', b]); return {}; } };
  const r = await executeProcedureActions('O', 'M', 'PRJ-03', [{ type: 'extract-pdf', sheet: 'D2_BUDGET', source_file_id: 'TEB' }], 'Non, la bonne pièce pour D2 c’est le TEB 2023, pas le PTBA', { email: 'p' }, d);
  assert.equal(r[0].status, 'done'); assert.equal(calls[0][1].file_id, 'TEB');
  const refused = await executeProcedureActions('O', 'M', 'PRJ-03', [{ type: 'choose-source', sheet: 'D2_BUDGET', source_file_id: 'PTBA' }], 'Non, la bonne pièce pour D2 c’est le TEB 2023', { email: 'p' }, d);
  assert.equal(refused[0].reason, 'PIECE_NOT_NAMED_BY_AUDITOR');
});
