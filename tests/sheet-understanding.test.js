// Paul, 2026-10-25 : « peu importe la mission et les pièces, l'agent doit comprendre, analyser et remplir parfaitement ».
// The sheet is understood from the workbook's own formulas, each column gets the document that holds it, the code refuses what would make a
// test right by construction, several documents are aligned row by row, and the import writes with each cell's provenance.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mapWorkingFile } from '../lib/workfile-map.js';
import { understandSheet, checkAssignments, alignRows, sheetPlan, acceptSheetPlan } from '../lib/sheet-understanding.js';

const Y = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } }, DK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
function head(ws, row, titles) { titles.forEach((h, i) => { const c = ws.getCell(row, i + 1); c.value = h; c.fill = DK; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; }); }

// A working file shaped like NL-T01 (D2 budget, D1 GL, PRJ-03 recomputation, PRJ-11 execution) — built here, nothing of the real file.
async function workingFile() {
  const w = new ExcelJS.Workbook();
  const d1 = w.addWorksheet('D1_GL_PROJET'); d1.getCell('A1').value = 'D1 — Grand livre analytique du projet';
  head(d1, 10, ['ID ligne', 'Date', 'Libellé', 'Montant', 'Catégorie budgétaire']);
  for (let r = 11; r <= 30; r++) for (let c = 1; c <= 5; c++) d1.getCell(r, c).fill = Y;
  [['L1', '2024-02-01', 'Salaire janvier', 300, 'Salaires'], ['L2', '2024-03-01', 'Loyer', 100, 'Loyers']].forEach((v, i) => v.forEach((x, j) => { d1.getCell(11 + i, j + 1).value = x; }));
  const d2 = w.addWorksheet('D2_BUDGET'); d2.getCell('A1').value = 'D2 — Budget approuvé par catégorie';
  d2.getCell('A2').value = 'Budget de la convention : initial, amendements / réallocations, final approuvé (document du bailleur).';
  d2.getCell('D5').value = { formula: 'SUM(D2_BUDGET!$D$11:$D$30)' };
  head(d2, 10, ['Catégorie budgétaire', 'Budget initial', 'Amendements / réallocations (net)', 'Budget final approuvé (document)', 'Engagements au 31/12', 'Élig PRJ-03', 'N° PRJ-03']);
  for (let r = 11; r <= 30; r++) { for (let c = 1; c <= 5; c++) d2.getCell(r, c).fill = Y; d2.getCell(r, 6).value = { formula: `IF(AND(LEN(A${r})>0),1,0)` }; d2.getCell(r, 7).value = { formula: `IF(F${r}=1,COUNTIF(F$11:F${r},1),"")` }; }
  const p3 = w.addWorksheet('PRJ-03'); p3.getCell('A1').value = 'PRJ-03 — Budget initial, amendements et réallocations';
  p3.getCell('A3').value = 'Comment faire : budget initial + amendements = budget final (recalcul).';
  head(p3, 10, ['N°', '_ligne', 'Catégorie budgétaire', 'Budget initial', 'Amendements', 'Budget final recalculé', 'Budget final approuvé (document)', 'Écart', 'Résultat']);
  for (let r = 11; r <= 15; r++) {
    p3.getCell(r, 1).value = r - 10;
    p3.getCell(r, 2).value = { formula: `IFERROR(MATCH(A${r},D2_BUDGET!$G$11:$G$30,0),"")` };
    p3.getCell(r, 3).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$A$11:$A$30,B${r})&"")` };
    p3.getCell(r, 4).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$B$11:$B$30,B${r}))` };
    p3.getCell(r, 5).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$C$11:$C$30,B${r}))` };
    p3.getCell(r, 6).value = { formula: `IF(C${r}="","",N(D${r})+N(E${r}))` };
    p3.getCell(r, 7).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$D$11:$D$30,B${r}))` };
    p3.getCell(r, 8).value = { formula: `IF(OR(C${r}="",G${r}=""),"",F${r}-G${r})` };
    p3.getCell(r, 9).value = { formula: `IF(C${r}="","",IF(ABS(N(H${r}))>0,"EXCEPTION","PASS"))` };
  }
  const p11 = w.addWorksheet('PRJ-11'); p11.getCell('A1').value = 'PRJ-11 — Tableau d’exécution budgétaire';
  head(p11, 10, ['N°', '_ligne', 'Catégorie budgétaire', 'Budget final approuvé', 'Réalisé selon GL analytique', 'Résultat']);
  for (let r = 11; r <= 15; r++) {
    p11.getCell(r, 1).value = r - 10;
    p11.getCell(r, 2).value = { formula: `IFERROR(MATCH(A${r},D2_BUDGET!$G$11:$G$30,0),"")` };
    p11.getCell(r, 3).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$A$11:$A$30,B${r})&"")` };
    p11.getCell(r, 4).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$D$11:$D$30,B${r}))` };
    p11.getCell(r, 5).value = { formula: `IF(C${r}="","",SUMIFS(D1_GL_PROJET!$D$11:$D$30,D1_GL_PROJET!$E$11:$E$30,C${r}))` };
    p11.getCell(r, 6).value = { formula: `IF(C${r}="","",IF(E${r}>N(D${r}),"EXCEPTION","PASS"))` };
  }
  return w;
}

test('the sheet is understood from its formulas: recomputation, comparison, rows, lookup in the GL', async () => {
  const w = await workingFile(), map = mapWorkingFile(w), u = understandSheet(w, map, 'D2_BUDGET');
  const c = col => u.columns.find(x => x.col === col);
  assert.deepEqual(u.comparisons.map(k => [k.test, k.left, k.right]), [['PRJ-03', ['B', 'C'], ['D']]]);
  assert.match(c('B').says.join(' '), /Budget initial.*\+.*Amendements.*= « Budget final recalculé ».*comparé à « Budget final approuvé \(document\) »/);
  assert.ok(c('A').says.some(x => /définit les lignes/.test(x)));
  assert.deepEqual(c('A').must_match.map(m => [m.sheet, m.col]), [['D1_GL_PROJET', 'E']]);
  assert.ok(c('D').total && c('D').amount);
  assert.equal(u.rows_from, 'A');
  // The other direction: the GL's category column must be written like D2's categories.
  const g = understandSheet(w, map, 'D1_GL_PROJET');
  assert.deepEqual(g.columns.find(x => x.col === 'E').must_match.map(m => [m.sheet, m.col]), [['D2_BUDGET', 'A']]);
});

test('code rule: the same column of the same document never feeds both sides of a recomputation', async () => {
  const w = await workingFile(), u = understandSheet(w, mapWorkingFile(w), 'D2_BUDGET');
  const docs = [{ id: 'TEB', name: 'TEB.xlsx' }];
  const p = checkAssignments(u, [
    { col: 'B', document_id: 'TEB', heading: "Budget de l'exercice", by: 'ia' },
    { col: 'D', document_id: 'TEB', heading: "Budget de l'exercice", by: 'ia' },
    { col: 'E', document_id: 'GHOST', heading: 'x', by: 'ia' }], docs);
  assert.equal(p.find(x => x.col === 'D').document_id, 'TEB');
  assert.equal(p.find(x => x.col === 'B').document_id, null);
  assert.match(p.find(x => x.col === 'B').why, /juste d’office/);
  assert.equal(p.find(x => x.col === 'E').document_id, null);            // a document not in the mission is set aside
});

test('rows of several documents are aligned on the code, then on the label; total lines left out', () => {
  const teb = { id: 'T', headers: ['Code', 'Libellé', 'Budget'], rows: [['601', 'Salaires', 1000], ['605', 'Loyers', 400], [null, 'TOTAL', 1400]] };
  const conv = { id: 'C', headers: ['Ligne budgétaire', 'Montant initial'], rows: [['Loyers', 350], ['Salaires', 900], ['Total', 1250]] };
  const { joined, unmatched } = alignRows(teb, [conv]);
  assert.equal(joined.length, 2);
  assert.deepEqual(joined.map(j => j.from.C?.[1]), [900, 350]);
  assert.deepEqual(unmatched, {});
});

test('plan and fill: TEB for the final budget and engagements, convention for the initial budget, PTBA refused, the GL categories checked', async () => {
  const w = await workingFile();
  let wp = Buffer.from(await w.xlsx.writeBuffer()), mod = 1;
  const book = async (sheet, rows) => { const b = new ExcelJS.Workbook(), s = b.addWorksheet(sheet); rows.forEach(r => s.addRow(r)); return Buffer.from(await b.xlsx.writeBuffer()); };
  const files = {
    TEBX: { name: 'TEB_2024_TABLEAU_EXTRAIT.xlsx', buf: await book('TABLEAU', [['Code', 'Libellé', "Budget de l'exercice", 'Décaissement', 'Engagement', 'Réalisation'], ['601', 'Salaires', 1000, 200, 300, 500], ['605', 'Loyers', 400, 100, 0, 100], [null, 'TOTAL', 1400, 300, 300, 600]]) },
    CONV: { name: 'Convention_annexe_budget.xlsx', buf: await book('Budget', [['Ligne budgétaire', 'Montant initial'], ['Salaires', 900], ['Loyers', 350]]) },
    PTBA: { name: 'PTBA_2024.xlsx', buf: await book('PTBA', [['Activité', 'Budget', 'T1'], ['Atelier', 50, 10]]) },
  };
  const memory = [
    { id: 'TEB', name: 'TEB_2024.pdf', title: "Tableau d'exécution budgétaire 2024 par catégorie", read: true, uses: [] },
    { id: 'TEBX', name: files.TEBX.name, title: 'Tableau extrait — TEB 2024', read: true, uses: [{ what: 'extrait_de', where: 'TEB', method: 'document_columns' }] },
    { id: 'CONV', name: files.CONV.name, title: 'Annexe budgétaire de la convention (budget initial par catégorie)', read: true, uses: [] },
    { id: 'PTBA', name: files.PTBA.name, title: 'Plan de travail et budget annuel par activité', read: true, uses: [] }];
  const notes = [];
  const view = { editable: true, card: { steps: [{ text: 'Importer le budget' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-03' } };
  let aiInput = null;
  const d = {
    view: async () => view, missionMemory: async () => memory,
    sources: async () => ['TEB', 'TEBX', 'CONV', 'PTBA'].map(id => ({ file_id: id, name: memory.find(m => m.id === id).name })),
    drive: { getMeta: async id => (id === 'WP' ? { name: 'NL.xlsx', size: wp.length, modifiedTime: 'v' + mod } : { name: files[id].name, size: files[id].buf.length, modifiedTime: 'x' }),
      downloadBuffer: async id => (id === 'WP' ? wp : files[id].buf), updateBinary: async (id, o) => { wp = o.buffer; mod++; } },
    ai: async (p, o) => { aiInput = JSON.parse(o.input); return { provider: 'stub', text: JSON.stringify({ columns: [
      { col: 'A', document_id: 'TEB', heading: 'Libellé', why: 'catégories du TEB' },
      { col: 'B', document_id: 'CONV', heading: 'Montant initial', why: 'budget initial de la convention' },
      { col: 'C', document_id: null, missing: 'Avenants / no-objections', why: 'aucun avenant déposé' },
      { col: 'D', document_id: 'TEB', heading: "Budget de l'exercice", why: 'dernier budget approuvé (TEB)' },
      { col: 'E', document_id: 'TEB', heading: 'Engagement', why: 'engagements du TEB' }] }) }; },
    save: async (o, w2, c) => Object.assign(view.work, c), audit: async () => null, noteMissionEvent: async (o, m, id, ev) => { notes.push([id, ev]); },
  };
  const plan = await sheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET' }, { email: 'p@x' }, d);
  // The AI was given what the tests do, not only titles.
  assert.ok(aiInput.columns.find(c => c.col === 'B').what_the_tests_do.some(x => /comparé à/.test(x)));
  const at = col => plan.plan.find(p => p.col === col);
  assert.equal(at('A').document_id, 'TEBX'); assert.equal(at('A').heading, 'Libellé');   // the PDF's verified extract is what is read
  assert.match(at('A').why, /100 % des valeurs retrouvées/);                              // checked against the GL's categories
  assert.equal(at('B').document_id, 'CONV');
  assert.equal(at('C').status, 'missing'); assert.equal(plan.missing.find(m => m.col === 'C').piece, 'Avenants / no-objections');
  assert.equal(at('D').heading, "Budget de l'exercice");
  assert.equal(plan.preview.rows, 2);                                                     // TOTAL line left out
  assert.deepEqual(plan.preview.sample[0], ['Salaires', 900, null, 1000, 300]);
  const r = await acceptSheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', columns: plan.plan.map(p => ({ col: p.col, document_id: p.document_id, heading: p.heading })) }, { email: 'p@x' }, d);
  assert.equal(r.rows, 2);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(wp); const s = back.getWorksheet('D2_BUDGET');
  assert.deepEqual([1, 2, 3, 4, 5].map(c => s.getCell(11, c).value), ['Salaires', 900, null, 1000, 300]);
  assert.deepEqual([1, 2, 4, 5].map(c => s.getCell(12, c).value), ['Loyers', 350, 400, 0]);
  const rec = view.work.walkthrough.at(-1).receipt.cells;
  assert.equal(rec.find(c => c.cell === 'B11').file_id, 'CONV');                          // each cell keeps its own document
  assert.equal(rec.find(c => c.cell === 'D11').file_id, 'TEBX');
  assert.ok(notes.some(([id, ev]) => id === 'CONV' && ev.uses[0].where === 'D2_BUDGET!B'));   // remembered for next time
  // A person trying to put the TEB's budget in both B and D is refused.
  await assert.rejects(acceptSheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', columns: [{ col: 'B', document_id: 'TEBX', heading: "Budget de l'exercice" }, { col: 'D', document_id: 'TEBX', heading: "Budget de l'exercice" }] }, { email: 'p@x' }, d), /SAME_SOURCE_ON_BOTH_SIDES/);
});

test('any data sheet, any piece: a grand livre fills D1 with Montant = Débit − Crédit, columns by meaning, no AI needed for a confirmed plan', async () => {
  const w = await workingFile();
  const d1 = w.getWorksheet('D1_GL_PROJET'); for (let r = 11; r <= 12; r++) for (let c = 1; c <= 5; c++) d1.getCell(r, c).value = null;
  let wp = Buffer.from(await w.xlsx.writeBuffer()), mod = 1;
  const b = new ExcelJS.Workbook(), s = b.addWorksheet('GL'); [['N° écriture', 'Date', 'Libellé écriture', 'Débit', 'Crédit', 'Code catégorie'], ['E1', '2024-02-01', 'Salaire', 300, 0, 'Salaires'], ['E2', '2024-03-01', 'Avoir loyer', 0, 40, 'Loyers']].forEach(r => s.addRow(r));
  const gl = Buffer.from(await b.xlsx.writeBuffer());
  const memory = [{ id: 'GL', name: 'GL_2024.xlsx', title: 'Grand livre analytique 2024', read: true, uses: [
    { what: 'colonne', where: 'D1_GL_PROJET!A', heading: 'N° écriture' }, { what: 'colonne', where: 'D1_GL_PROJET!B', heading: 'Date' }, { what: 'colonne', where: 'D1_GL_PROJET!C', heading: 'Libellé écriture' },
    { what: 'colonne', where: 'D1_GL_PROJET!D', heading: 'Débit − Crédit' }, { what: 'colonne', where: 'D1_GL_PROJET!E', heading: 'Code catégorie' }] }];
  const view = { editable: true, card: { steps: [{ text: 'Importer le GL' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-11' } };
  let called = 0;
  const d = { view: async () => view, missionMemory: async () => memory, sources: async () => [{ file_id: 'GL', name: 'GL_2024.xlsx' }],
    drive: { getMeta: async id => (id === 'WP' ? { name: 'NL.xlsx', size: wp.length, modifiedTime: 'v' + mod } : { name: 'GL_2024.xlsx', size: gl.length, modifiedTime: 'x' }), downloadBuffer: async id => (id === 'WP' ? wp : gl), updateBinary: async (id, o) => { wp = o.buffer; mod++; } },
    ai: async () => { called++; return { text: '{}' }; }, save: async (o, w2, c) => Object.assign(view.work, c), audit: async () => null, noteMissionEvent: async () => null };
  const P = await sheetPlan('O', 'M', 'PRJ-11', { sheet: 'D1_GL_PROJET' }, { email: 'p' }, d);
  assert.equal(called, 0);                                                     // every column already confirmed: no AI call
  assert.equal(P.plan.find(p => p.col === 'D').heading, 'Débit − Crédit');
  assert.deepEqual(P.preview.sample.map(r => r[3]), [300, -40]);
  await acceptSheetPlan('O', 'M', 'PRJ-11', { sheet: 'D1_GL_PROJET', columns: P.plan.map(p => ({ col: p.col, document_id: p.document_id, heading: p.heading })) }, { email: 'p' }, d);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(wp);
  assert.deepEqual([1, 3, 4, 5].map(c => back.getWorksheet('D1_GL_PROJET').getCell(12, c).value), ['E2', 'Avoir loyer', -40, 'Loyers']);
});

test('a PDF named for a column is not read in the same call: the plan says « extraire », then reads the verified extract', async () => {
  const w = await workingFile(); const wp = Buffer.from(await w.xlsx.writeBuffer());
  const memory = [{ id: 'TEB', name: 'TEB_2024.pdf', title: "Tableau d'exécution budgétaire", read: true, uses: [] }];
  const view = { editable: true, card: { steps: [{ text: 'x' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] } };
  let extracted = 0;
  const d = { view: async () => view, missionMemory: async () => memory, sources: async () => [{ file_id: 'TEB', name: 'TEB_2024.pdf' }],
    drive: { getMeta: async () => ({ name: 'NL.xlsx', size: wp.length }), downloadBuffer: async () => wp },
    ai: async () => ({ text: JSON.stringify({ columns: [{ col: 'D', document_id: 'TEB', heading: "Budget de l'exercice" }] }) }),
    extractPdf: async () => { extracted++; throw new Error('should not run without a request'); } };
  const P = await sheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET' }, { email: 'p' }, d);
  const D = P.plan.find(p => p.col === 'D');
  assert.equal(D.status, 'needs_extraction'); assert.equal(D.pdf, 'TEB'); assert.equal(extracted, 0);
});
