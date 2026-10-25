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
  assert.equal(at('C').compute, 'D-B'); assert.match(at('C').why, /méthode du cabinet/);       // Paul's method: amendments = final − initial
  assert.equal(at('D').heading, "Budget de l'exercice");
  assert.equal(plan.preview.rows, 2);                                                     // TOTAL line left out
  assert.deepEqual(plan.preview.sample[0], ['Salaires', 900, 100, 1000, 300]);
  const r = await acceptSheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', columns: plan.plan.map(p => ({ col: p.col, document_id: p.document_id, heading: p.heading, compute: p.compute })) }, { email: 'p@x' }, d);
  assert.equal(r.rows, 2);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(wp); const s = back.getWorksheet('D2_BUDGET');
  assert.deepEqual([1, 2, 3, 4, 5].map(c => s.getCell(11, c).value), ['Salaires', 900, 100, 1000, 300]);
  assert.deepEqual([1, 2, 3, 4, 5].map(c => s.getCell(12, c).value), ['Loyers', 350, 50, 400, 0]);
  const rec = view.work.walkthrough.at(-1).receipt.cells;
  assert.equal(rec.find(c => c.cell === 'B11').file_id, 'CONV');                          // each cell keeps its own document
  assert.equal(rec.find(c => c.cell === 'D11').file_id, 'TEBX');
  assert.ok(notes.some(([id, ev]) => id === 'CONV' && ev.uses[0].where === 'D2_BUDGET!B'));   // remembered for next time
  // A person trying to put the TEB's budget in both B and D is refused.
  await assert.rejects(acceptSheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', columns: [{ col: 'B', document_id: 'TEBX', heading: "Budget de l'exercice" }, { col: 'D', document_id: 'TEBX', heading: "Budget de l'exercice" }] }, { email: 'p@x' }, d), /SAME_SOURCE_ON_BOTH_SIDES/);
});

test('any data sheet, any piece: a grand livre fills D1 with Montant = Débit − Crédit, columns by meaning, the AI only verifies a confirmed plan', async () => {
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
  assert.equal(called, 1);                                                     // every column confirmed: the AI is asked only to verify
  assert.equal(P.plan.find(p => p.col === 'D').heading, 'Débit − Crédit');
  assert.deepEqual(P.preview.sample.map(r => r[3]), [300, -40]);
  await acceptSheetPlan('O', 'M', 'PRJ-11', { sheet: 'D1_GL_PROJET', columns: P.plan.map(p => ({ col: p.col, document_id: p.document_id, heading: p.heading })) }, { email: 'p' }, d);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(wp);
  assert.deepEqual([1, 3, 4, 5].map(c => back.getWorksheet('D1_GL_PROJET').getCell(12, c).value), ['E2', 'Avoir loyer', -40, 'Loyers']);
});

test('the AI chooses from what each document CONTAINS (table rows, PDF text), and a PDF it chooses is turned into a table by the agent itself', async () => {
  const w = await workingFile(); const wp = Buffer.from(await w.xlsx.writeBuffer());
  const b = new ExcelJS.Workbook(); b.addWorksheet('PTBA').addRow(['Activité', 'Budget']); b.getWorksheet('PTBA').addRow(['Atelier', 50]);
  const ptba = Buffer.from(await b.xlsx.writeBuffer());
  const memory = [{ id: 'TEB', name: 'TEB_2024.pdf', title: 'Pièce à confirmer', read: true, uses: [] }, { id: 'LET', name: 'LETTRE_AVIS_NON_OBJECTION.pdf', title: 'Lettre de non-objection sur le PTBA', read: true, uses: [] }, { id: 'PTBA', name: 'PLAN_2024.xlsx', title: 'PTBA', read: true, uses: [] }];
  const view = { editable: true, card: { steps: [{ text: 'x' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] } };
  let input = null, extracted = [];
  const d = { view: async () => view, missionMemory: async () => memory, sources: async () => memory.map(m => ({ file_id: m.id, name: m.name })),
    drive: { getMeta: async id => ({ name: id === 'WP' ? 'NL.xlsx' : memory.find(m => m.id === id).name, size: 10 }), downloadBuffer: async id => (id === 'WP' ? wp : id === 'PTBA' ? ptba : Buffer.from(id)) },
    pdfText: async bytes => ({ text: String(bytes) === 'TEB' ? 'TABLEAU D EXECUTION BUDGETAIRE 2024 Code Libellé Budget de l exercice Décaissement Engagement Réalisation 601 Salaires 1 000 000 200 000 300 000 500 000 ' + 'x'.repeat(60) : 'Nous avons l honneur de vous informer de notre non-objection sur le PTBA 2024 et le PPM. ' + 'y'.repeat(60) }),
    ai: async (p, o) => { if (!input) input = JSON.parse(o.input); return { text: JSON.stringify({ columns: [{ col: 'D', document_id: 'TEB', heading: "Budget de l'exercice" }] }) }; },
    extractPdf: async (o, m, c, body) => { extracted.push(body.file_id); throw new Error('PDF_UNREADABLE'); } };
  const P = await sheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET' }, { email: 'p' }, d);
  const doc = id => input.documents.find(x => x.id === id);
  assert.match(doc('TEB').content.text, /Budget de l exercice/);
  assert.match(doc('LET').content.text, /non-objection/);
  assert.deepEqual(doc('PTBA').content.sheets[0].rows[0], ['Activité', 'Budget']);
  assert.deepEqual(extracted, ['TEB']);                                            // the agent extracts the PDF it chose, without a click
  assert.equal(P.plan.find(p => p.col === 'D').status, 'unreadable');              // and says when it could not
});

test('the AI checks the plan on the real tables: corrects a heading, empties a column, an invented heading is ignored, hard rules stay', async () => {
  const { verifyWithAi, enforce } = await import('../lib/sheet-understanding.js');
  const w = await workingFile(), u = understandSheet(w, mapWorkingFile(w), 'D2_BUDGET');
  const tables = { T: { name: 'TEB.xlsx', headers: ['Code', 'Libellé', "Budget de l'exercice", 'Engagement', 'Réalisation'], rows: [['601', 'Salaires', 1000, 300, 500]] } };
  const plan = [
    { col: 'A', header: 'Catégorie budgétaire', document_id: 'T', heading: 'Code', source_index: 0, status: 'to_confirm', why: 'doute' },
    { col: 'B', header: 'Budget initial', document_id: null, status: 'missing' },
    { col: 'C', header: 'Amendements', document_id: null, status: 'missing' },
    { col: 'D', header: 'Budget final approuvé (document)', document_id: 'T', heading: "Budget de l'exercice", source_index: 2, status: 'sure' },
    { col: 'E', header: 'Engagements au 31/12', document_id: 'T', heading: 'Engagement', source_index: 3, status: 'sure' }];
  const r = await verifyWithAi(u, plan, tables, { ai: async (p, o) => { const x = JSON.parse(o.input); assert.ok(x.documents[0].first_rows.length); return { provider: 'stub', text: JSON.stringify({ summary: 'ok', columns: [
    { col: 'A', verdict: 'heading', heading: 'Libellé', why: 'les catégories sont nommées par leur libellé' },
    { col: 'D', verdict: 'heading', heading: 'Budget révisé', why: 'inventé' },
    { col: 'E', verdict: 'empty', why: 'ce TEB donne des engagements non soldés, pas au 31/12', missing: 'État des engagements au 31/12' }] }) }; } });
  assert.equal(r.provider, 'stub');
  assert.equal(plan[0].heading, 'Libellé'); assert.equal(plan[0].status, 'sure');
  assert.equal(plan[3].heading, "Budget de l'exercice"); assert.match(plan[3].why, /absent du document/);
  assert.equal(plan[4].document_id, null); assert.equal(plan[4].missing, 'État des engagements au 31/12');
  // Even if the AI said « ok », the same column on both sides of PRJ-03 is still refused by the code.
  plan[1] = { col: 'B', header: 'Budget initial', document_id: 'T', heading: "Budget de l'exercice", status: 'sure' };
  enforce(u, plan); assert.equal(plan[1].document_id, null);
});

test('Paul’s method for D2: lines = PTBA sub-totals, category = account number found through the GL labels, initial = PTBA, final and engagements = TEB, amendments = final − initial', async () => {
  const w = await workingFile();
  const d1 = w.getWorksheet('D1_GL_PROJET'); for (let r = 11; r <= 12; r++) for (let c = 1; c <= 5; c++) d1.getCell(r, c).value = null;
  let wp = Buffer.from(await w.xlsx.writeBuffer()), mod = 1;
  const book = async (sheet, rows) => { const b = new ExcelJS.Workbook(), s = b.addWorksheet(sheet); rows.forEach(r => s.addRow(r)); return Buffer.from(await b.xlsx.writeBuffer()); };
  const files = {
    PTBA: { name: 'PLAN_2023_VF.xlsx', buf: await book('PTBA', [['N°', 'Désignation', 'Montant'], ['1.1', 'Achat carburant', 100], ['1.2', 'Gasoil groupe', 82.5], [null, 'Sous-total Fournitures non stockables – Autres énergies', 182.5],
      ['2.1', 'Billets Dakar', 50], [null, 'Sous-total Transport des agents en formation à l’étranger', 50], [null, 'TOTAL GENERAL', 232.5]]) },
    GL: { name: 'GL AUXIL 2023.xlsx', buf: await book('GL', [['Date', 'Journal', 'Pièce', 'Libellé', 'Débit', 'Crédit'], ['605300 Fournitures non stockables – Autres énergies'], ['03/01/2023', 'BQ', 'P1', 'Carburant', 182.5, null],
      [null, null, null, 'Total compte 605300', 182.5, 0], ['618120 TRANSPORT DES AGENTS EN FORMATION A L’ETRANGER'], ['10/03/2023', 'BQ', 'P9', 'Billet', 54, null]]) },
    TEB: { name: 'TEB_2023_TABLEAU_EXTRAIT.xlsx', buf: await book('TABLEAU', [['Code', 'Libellé', "Budget de l'exercice", 'Engagement'], ['605300', 'Fournitures non stockables – Autres énergies', 200, 0], ['618120', 'TRANSPORT DES AGENTS EN FORMATION A L’ETRANGER', 60, 10]]) } };
  const memory = Object.entries(files).map(([id, f]) => ({ id, name: f.name, title: id, read: true, uses: [] }));
  const view = { editable: true, card: { steps: [{ text: 'Importer le budget' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-03' } };
  const d = { view: async () => view, missionMemory: async () => memory, sources: async () => memory.map(m => ({ file_id: m.id, name: m.name })),
    drive: { getMeta: async id => (id === 'WP' ? { name: 'NL.xlsx', size: wp.length, modifiedTime: 'v' + mod } : { name: files[id].name, size: files[id].buf.length, modifiedTime: 'x' }), downloadBuffer: async id => (id === 'WP' ? wp : files[id].buf), updateBinary: async (id, o) => { wp = o.buffer; mod++; } },
    ai: async (p, o) => (/vérifies le plan/.test(o.instructions) ? { text: '{}' } : { provider: 'stub', text: JSON.stringify({ rows_from: { document_id: 'PTBA', which: 'subtotals' }, gl_document_id: 'GL', columns: [
      { col: 'A', document_id: 'PTBA', heading: 'Désignation', account_from_gl: true }, { col: 'B', document_id: 'PTBA', heading: 'Montant' }, { col: 'C', compute: 'D-B' },
      { col: 'D', document_id: 'TEB', heading: "Budget de l'exercice" }, { col: 'E', document_id: 'TEB', heading: 'Engagement' }] }) }),
    save: async (o, w2, c) => Object.assign(view.work, c), audit: async () => null, noteMissionEvent: async () => null };
  const P = await sheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET' }, { email: 'p' }, d);
  assert.deepEqual(P.preview.sample, [['605300', 182.5, 17.5, 200, 0], ['618120', 50, 10, 60, 10]]);
  await acceptSheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', rows_from: P.rows_from, gl_document_id: P.gl_document_id, columns: P.plan.map(p => ({ col: p.col, document_id: p.document_id, heading: p.heading, compute: p.compute, account_from_gl: p.account_from_gl })) }, { email: 'p' }, d);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(wp); const s = back.getWorksheet('D2_BUDGET');
  assert.deepEqual([1, 2, 3, 4, 5].map(c => s.getCell(12, c).value), ['618120', 50, 10, 60, 10]);
});

test('fonds reçus: credits collected from every bank statement, and one row per credit advice read by the AI — amounts checked in the document', async () => {
  const w = new ExcelJS.Workbook(), d3 = w.addWorksheet('D3_FONDS_RECUS');
  d3.getCell('A1').value = 'D3 — Fonds reçus (bailleurs, contrepartie, autres)';
  head(d3, 10, ['ID ligne', 'Date', 'Pièce / référence', 'Bailleur / contributeur', 'Montant', 'Élig PRJ-07']);
  for (let r = 11; r <= 30; r++) { for (let c = 1; c <= 5; c++) d3.getCell(r, c).fill = Y; d3.getCell(r, 6).value = { formula: `IF(AND(LEN(A${r})>0),1,0)` }; }
  const p7 = w.addWorksheet('PRJ-07'); head(p7, 10, ['N°', 'Montant']); p7.getCell('B11').value = { formula: 'SUM(D3_FONDS_RECUS!$E$11:$E$30)' };
  let wp = Buffer.from(await w.xlsx.writeBuffer()), mod = 1;
  const book = async rows => { const b = new ExcelJS.Workbook(), s = b.addWorksheet('Relevé'); rows.forEach(r => s.addRow(r)); return Buffer.from(await b.xlsx.writeBuffer()); };
  const files = {
    R1: { name: 'releve_janvier.xlsx', buf: await book([['Date', 'Libellé', 'Débit', 'Crédit', 'Solde'], ['05/01/2023', 'Virement FAD tranche 1', null, 5000000, 5000000], ['09/01/2023', 'Frais', 2500, null, 4997500]]) },
    R2: { name: 'releve_fevrier.xlsx', buf: await book([['Date', 'Libellé', 'Débit', 'Crédit', 'Solde'], ['12/02/2023', 'Contrepartie Etat', null, 800000, 5797500], [null, 'Total', 2500, 800000, null]]) },
    AV: { name: 'avis_credit_mars.pdf', buf: Buffer.from('x') } };
  const memory = Object.entries(files).map(([id, f]) => ({ id, name: f.name, title: id, read: true, uses: [] }));
  const view = { editable: true, card: { steps: [{ text: 'Fonds reçus' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-07' } };
  const d = { view: async () => view, missionMemory: async () => memory, sources: async () => memory.map(m => ({ file_id: m.id, name: m.name })),
    drive: { getMeta: async id => (id === 'WP' ? { name: 'NL.xlsx', size: wp.length, modifiedTime: 'v' + mod } : { name: files[id].name, size: files[id].buf.length, modifiedTime: 'x' }), downloadBuffer: async id => (id === 'WP' ? wp : files[id].buf), updateBinary: async (id, o) => { wp = o.buffer; mod++; } },
    pdfText: async () => ({ text: 'AVIS DE CREDIT — Réf AC-0315 — 15/03/2023 — Donneur d’ordre : BAD — Montant crédité : 1 250 000 FCFA' }),
    ai: async (p, o) => (/vérifies le plan/.test(o.instructions) ? { text: '{}' } : { provider: 'stub', text: JSON.stringify({ rows_from: { document_ids: ['R1', 'R2'], which: 'credits' }, columns: [{ col: 'B', document_id: 'R1', heading: 'Date' }, { col: 'E', document_id: 'R1', heading: 'Crédit' }] }) }),
    save: async (o, w2, c) => Object.assign(view.work, c), audit: async () => null, noteMissionEvent: async () => null };
  const P = await sheetPlan('O', 'M', 'PRJ-07', { sheet: 'D3_FONDS_RECUS' }, { email: 'p' }, d);
  assert.equal(P.collect.rows, 2); assert.equal(P.collect.read, 2);
  assert.deepEqual(P.preview.sample.map(r => [r[1], r[4]]), [['05/01/2023', 5000000], ['12/02/2023', 800000]]);   // debits and totals left out
  // Credit advices: one row per document, the amount must be found in the advice's text.
  const d2 = { ...d, fileForAI: async id => ({ id, name: files[id].name, text: 'AVIS DE CREDIT — Réf AC-0315 — 15/03/2023 — Donneur d’ordre : BAD — Montant crédité : 1 250 000 FCFA', visual: false }),
    ai: async (p, o) => (/Chaque document ci-joint est UNE opération/.test(o.instructions) ? { text: JSON.stringify({ rows: [{ document_id: 'AV', values: { B: '15/03/2023', C: 'AC-0315', D: 'BAD', E: '1 250 000' } }] }) }
      : /vérifies le plan/.test(o.instructions) ? { text: '{}' } : { text: JSON.stringify({ rows_from: { document_ids: ['AV'], which: 'one_per_document' }, columns: [] }) }) };
  const Q = await sheetPlan('O', 'M', 'PRJ-07', { sheet: 'D3_FONDS_RECUS' }, { email: 'p' }, d2);
  assert.deepEqual(Q.preview.sample, [[null, '15/03/2023', 'AC-0315', 'BAD', 1250000]], JSON.stringify(Q.collect));
  await acceptSheetPlan('O', 'M', 'PRJ-07', { sheet: 'D3_FONDS_RECUS', rows_from: Q.rows_from, columns: Q.plan.map(p => ({ col: p.col, document_id: p.document_id, heading: p.heading })) }, { email: 'p' }, d2);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(wp);
  assert.equal(back.getWorksheet('D3_FONDS_RECUS').getCell('E11').value, 1250000);
  // An amount the AI « read » that is not in the advice is not kept.
  const d3b = { ...d2, ai: async (p, o) => (/Chaque document ci-joint est UNE opération/.test(o.instructions) ? { text: JSON.stringify({ rows: [{ document_id: 'AV', values: { E: '9 999 999' } }] }) } : /vérifies le plan/.test(o.instructions) ? { text: '{}' } : { text: JSON.stringify({ rows_from: { document_ids: ['AV'], which: 'one_per_document' }, columns: [] }) }) };
  const R = await sheetPlan('O', 'M', 'PRJ-07', { sheet: 'D3_FONDS_RECUS' }, { email: 'p' }, d3b);
  assert.equal(R.collect.rows, 0); assert.match(R.collect.to_check[0], /non retrouvé/);
});
