// La carte du working file : même lecture pour tout modèle (NL-T01 avec AUDIT_META, ou modèle d'un autre cabinet).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { mapWorkingFile, mayWrite, columnRole, mapSummary, formulaRefs, fillKind } from '../lib/workfile-map.js';

const HEAD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const BLUE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };

function header(ws, row, titles, style = 'fill') {
  titles.forEach((t, i) => { const c = ws.getCell(row, i + 1); c.value = t; if (style === 'fill') { c.fill = HEAD; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; } else c.font = { bold: true }; });
}

// A workbook of the same SHAPE as NL-T01 (no firm content): AUDIT_META, guide, programme, risks, PBC, data sheet, test sheet, lead.
function nlLike() {
  const wb = new ExcelJS.Workbook();
  let ws = wb.addWorksheet('00_GUIDE');
  ws.getCell('A1').value = 'XX-T01 — mode d’emploi';
  ws.getCell('A5').value = '1. 01_SYNTHESE'; ws.getCell('A6').value = '2. Feuilles de données D1_GL';
  ws.getCell('A7').value = '3. R_RAPPROCHEMENTS'; ws.getCell('A8').value = '4. 02_PROGRAMME';
  ws.getCell('A9').value = '5. Feuilles de test XX-01 … XX-02'; ws.getCell('A10').value = '6. 04_LEAD → SIGNOFF';

  ws = wb.addWorksheet('01_SYNTHESE'); ws.getCell('A1').value = 'Synthèse'; ws.getCell('B28').value = 2026;
  wb.definedNames.add("'01_SYNTHESE'!$B$28", 'GRAINE');

  ws = wb.addWorksheet('02_PROGRAMME');
  header(ws, 4, ['Test ID', 'Nom du test (SOP)', 'Type SOP', 'Niveau', 'Feuille', 'Activé ?']);
  [['XX-01', 'Compréhension', 'CORE', 'Senior', '→ XX-01', 'Oui'], ['XX-02', 'Éligibilité', 'RISK-DEPENDENT', 'Junior', '→ XX-02', 'À décider']]
    .forEach((r, i) => r.forEach((v, j) => { const c = ws.getCell(5 + i, j + 1); c.value = v; if (j === 5) c.fill = YELLOW; }));

  ws = wb.addWorksheet('03_RISQUES');
  header(ws, 4, ['Risk ID', 'Risque (SOP)', 'Assertion(s)', 'Tests PRIMARY']);
  ws.addRow(['XX-R01', 'Dépense non éligible', 'Éligibilité', 'XX-02']); ws.addRow(['XX-R02', 'Mauvaise imputation', 'Affectation', 'XX-01']);
  header(ws, 9, ['Risk ID', 'Test ID', 'Nom du test', 'Coverage type']);
  ws.getRow(10).values = ['XX-R01', 'XX-02', 'Éligibilité', 'PRIMARY']; ws.getRow(11).values = ['XX-R02', 'XX-01', 'Compréhension', 'CORROBORATIVE'];

  ws = wb.addWorksheet('PBC');
  header(ws, 4, ['PBC ID', 'Nom du PBC', 'Type', 'Règle du nombre attendu', 'Tests de ce WF']);
  ws.getRow(5).values = ['PBC-GEN-01', 'Balance', 'Extraction', '1 document', 'XX-01'];
  ws.getRow(6).values = ['PBC-XX-04', 'Pièces de l’échantillon', 'Justificatif', '1 par élément', 'XX-02'];
  header(ws, 9, ['Test ID', 'PBC ID', 'Nom du PBC', 'Requis / Optionnel', 'Finalité dans le test']);
  ws.getRow(10).values = ['XX-02', 'PBC-XX-04', 'Pièces', 'Requis', 'Pièces de l’échantillon'];
  ws.getRow(11).values = ['XX-02', 'PBC-GEN-01', 'Balance', 'Optionnel', 'Rapprochement'];

  ws = wb.addWorksheet('D1_GL');
  ws.getCell('A1').value = 'D1 — GL'; ws.getCell('A4').value = "Source : copie non modifiée de l'extraction du client.";
  header(ws, 10, ['ID ligne', 'Date', 'Montant', 'Payé par avance ?', 'Aléa', 'N° tirage', 'Retenu']);
  for (let r = 11; r <= 30; r++) {
    ['A', 'B', 'C', 'D', 'G'].forEach(l => { ws.getCell(l + r).fill = YELLOW; });
    ws.getCell('D' + r).dataValidation = { type: 'list', formulae: ['"Oui,Non"'] };
    ws.getCell('E' + r).value = { formula: `IF(A${r}="","",MOD(ROW()*GRAINE,1))` }; ws.getCell('E' + r).fill = GREY;
    ws.getCell('F' + r).value = { formula: `IF(E${r}="","",RANK(E${r},$E$11:$E$30))` }; ws.getCell('F' + r).fill = GREY;
  }

  ws = wb.addWorksheet('R_RAPPROCHEMENTS');
  header(ws, 10, ['ID', 'Contrôle', 'Valeur calculée', 'Référence', 'Résultat', 'Écart accepté (Senior) ?']);
  for (let r = 11; r <= 12; r++) {
    ws.getCell('A' + r).value = 'RC0' + (r - 10); ws.getCell('B' + r).value = 'Contrôle ' + r;
    ws.getCell('C' + r).value = { formula: 'SUM(D1_GL!$C$11:$C$30)' }; ws.getCell('C' + r).fill = GREY;
    ws.getCell('D' + r).fill = YELLOW; ws.getCell('F' + r).fill = YELLOW;
    ws.getCell('E' + r).value = { formula: `IF(D${r}="","À FAIRE",IF(C${r}=D${r},"OK","ÉCART"))` }; ws.getCell('E' + r).fill = GREY;
  }

  for (const code of ['XX-01', 'XX-02']) {
    ws = wb.addWorksheet(code);
    ws.getCell('A1').value = code + ' — test'; ws.getCell('A2').value = 'Objectif (SOP) : éligibilité';
    ws.getCell('A4').value = 'Comment faire : comparer aux clauses.';
    ws.getCell('A9').value = 'Paramètres du test'; ws.getCell('B9').value = "Taille de l'échantillon";
    header(ws, 10, ['N°', 'Référence', 'Montant comptabilisé', 'Montant justifié', 'Écart', '✓ Clauses respectées', '✓ Documents fournis', 'Pièces / références', 'Résultat']);
    for (let r = 11; r <= 22; r++) {
      ws.getCell('A' + r).value = r - 10; ws.getCell('A' + r).fill = GREY;
      ws.getCell('B' + r).value = { formula: `IF(A${r}="","",INDEX(D1_GL!$A$11:$A$30,MATCH(A${r},D1_GL!$F$11:$F$30,0)))` }; ws.getCell('B' + r).fill = GREY;
      ws.getCell('C' + r).value = { formula: `IF(B${r}="","",INDEX(D1_GL!$C$11:$C$30,MATCH(A${r},D1_GL!$F$11:$F$30,0)))` }; ws.getCell('C' + r).fill = GREY;
      ws.getCell('D' + r).fill = YELLOW;
      ws.getCell('E' + r).value = { formula: `IF(OR(C${r}="",D${r}=""),"",C${r}-D${r})` }; ws.getCell('E' + r).fill = GREY;
      ['F', 'G'].forEach(l => { ws.getCell(l + r).fill = YELLOW; ws.getCell(l + r).dataValidation = { type: 'list', formulae: ['"Oui,Non,N/A"'] }; });
      ws.getCell('H' + r).fill = YELLOW;
      ws.getCell('I' + r).value = { formula: `IF(B${r}="","",IF(OR(COUNTIF(F${r}:G${r},"Non")>0,ABS(N(E${r}))>0),"EXCEPTION",IF(COUNTBLANK(F${r}:G${r})>0,"EN COURS","PASS")))` }; ws.getCell('I' + r).fill = GREY;
    }
  }

  ws = wb.addWorksheet('04_LEAD');
  header(ws, 10, ['Compte', 'Libellé', 'Solde N (balance)', 'Solde selon détail', 'Écart', 'Résultat']);
  for (let r = 11; r <= 20; r++) {
    ['A', 'B', 'C'].forEach(l => { ws.getCell(l + r).fill = YELLOW; });
    ws.getCell('D' + r).value = { formula: '""' }; ws.getCell('D' + r).fill = GREY;
    ws.getCell('E' + r).value = { formula: `IF(OR(C${r}="",D${r}=""),"",C${r}-D${r})` }; ws.getCell('E' + r).fill = GREY;
    ws.getCell('F' + r).value = { formula: `IF(A${r}="","",IF(C${r}="","À FAIRE","OK"))` }; ws.getCell('F' + r).fill = GREY;
  }
  ws.getCell('A11').value = 'Fonds'; ws.getCell('A12').value = 'Dépenses';

  ws = wb.addWorksheet('SIGNOFF');
  header(ws, 22, ['Niveau', 'Requis ?', 'Nom', 'Date', 'Statut']);
  ws.getRow(23).values = ['Préparé par', 'Oui']; ws.getRow(24).values = ['Revue Manager', 'Oui'];

  ws = wb.addWorksheet('AUDIT_META'); ws.state = 'hidden';
  [['AUDIT_META'], [], ['Template_ID', 'XX-T01'], ['Template_version', '2.0'], ['Methodology_family', 'Famille test'], ['Cycle_ID', 'XX'],
    ['Test_sheets', 'XX-01, XX-02'], ['Data_sheets', 'D1_GL'], ['Engagement_ID', { formula: 'MISSION_ID&""' }]].forEach(r => ws.addRow(r));
  ws = wb.addWorksheet('LISTS'); ws.state = 'hidden'; ws.getCell('A1').value = 'Oui';
  return wb;
}

// The template of another firm, never seen: no AUDIT_META, bold headers, BLUE inputs, an « Instructions » sheet, English.
function otherFirm() {
  const wb = new ExcelJS.Workbook();
  let ws = wb.addWorksheet('Instructions');
  ws.getCell('A1').value = 'Revenue working paper'; ws.getCell('A3').value = '1. Paste TB';
  ws.getCell('A4').value = '2. Complete Leadsheet'; ws.getCell('A5').value = '3. Cut-off testing in REV-01'; ws.getCell('A6').value = '4. Sign-off';
  ws = wb.addWorksheet('TB');
  header(ws, 3, ['Account', 'Description', 'PY', 'CY'], 'bold');
  for (let r = 4; r <= 503; r++) ['A', 'B', 'C', 'D'].forEach(l => { ws.getCell(l + r).fill = BLUE; });
  ws = wb.addWorksheet('Leadsheet');
  header(ws, 5, ['Account', 'Description', 'CY (TB)', 'Diff'], 'bold');
  for (let r = 6; r <= 20; r++) { ['A', 'B', 'C'].forEach(l => { ws.getCell(l + r).fill = BLUE; }); ws.getCell('D' + r).value = { formula: `IF(A${r}="","",C${r}-SUMIF(TB!$A$4:$A$503,A${r},TB!$D$4:$D$503))` }; }
  ws = wb.addWorksheet('REV-01');
  ws.getCell('A1').value = 'Cut-off'; ws.getCell('A2').value = 'For each invoice around year-end, agree delivery date.';
  header(ws, 7, ['No', 'Invoice', 'Invoice date', 'Evidence', 'Delivery date', 'Correct period?', 'Conclusion'], 'bold');
  for (let r = 8; r <= 17; r++) {
    ws.getCell('A' + r).value = r - 7;
    ['B', 'C', 'D', 'E', 'F'].forEach(l => { ws.getCell(l + r).fill = BLUE; });
    ws.getCell('F' + r).dataValidation = { type: 'list', formulae: ['"Yes,No"'] };
    ws.getCell('G' + r).value = { formula: `IF(F${r}="","Open",IF(F${r}="No","Exception","OK"))` };
  }
  ws = wb.addWorksheet('Sign-off');
  header(ws, 2, ['Level', 'Name', 'Date'], 'bold'); ws.getRow(3).values = ['Preparer']; ws.getRow(4).values = ['Reviewer'];
  return wb;
}

async function roundTrip(wb) { const b = await wb.xlsx.writeBuffer(); const w = new ExcelJS.Workbook(); await w.xlsx.load(b); return w; }

test('reads the references of a formula: other sheets, same-row columns, literals', () => {
  const r = formulaRefs(`IF(C11="","",IF(OR(COUNTIF(L11:N11,"Non")>0,ABS(N(K11))>SEUIL),"EXCEPTION","PASS"))&'D1 GL'!$A$1`);
  assert.deepEqual([...new Set(r.cols.map(x => x.col))].sort(), ['C', 'K', 'L', 'M', 'N']);
  assert.deepEqual(r.sheets.map(s => s.sheet), ['D1 GL']);
  assert.ok(r.literals.includes('EXCEPTION') && r.literals.includes('Non'));
});

test('NL-T01 shape: identity from AUDIT_META, roles of sheets, order of the guide', async () => {
  const m = mapWorkingFile(await roundTrip(nlLike()));
  assert.equal(m.key, 'XX-T01@2.0');
  assert.equal(m.template.source, 'AUDIT_META');
  const role = n => m.sheets.find(s => s.name === n).role;
  assert.equal(role('XX-02'), 'test'); assert.equal(role('D1_GL'), 'data'); assert.equal(role('AUDIT_META'), 'meta');
  assert.equal(role('04_LEAD'), 'lead'); assert.equal(role('LISTS'), 'lists');
  assert.deepEqual(m.order.slice(0, 6), ['00_GUIDE', '01_SYNTHESE', 'D1_GL', 'R_RAPPROCHEMENTS', '02_PROGRAMME', 'XX-01']);
  assert.ok(m.order.indexOf('04_LEAD') < m.order.indexOf('SIGNOFF'));
  assert.ok(m.defined_names.includes('GRAINE'));
});

test('NL-T01 shape: programme read by its columns (activation from « Activé ? », never from a word elsewhere)', async () => {
  const m = mapWorkingFile(await roundTrip(nlLike()));
  assert.deepEqual(m.programme.map(p => [p.code, p.activated, p.sheet]), [['XX-01', 'Oui', 'XX-01'], ['XX-02', 'À décider', 'XX-02']]);
  assert.deepEqual(m.risks.map(r => r.id), ['XX-R01', 'XX-R02']);
  assert.equal(m.risk_matrix.length, 2);
});

test('NL-T01 shape: the form of a test, column by column, deduced from colours, formulas and lists', async () => {
  const m = mapWorkingFile(await roundTrip(nlLike()));
  const t = m.tests.find(x => x.code === 'XX-02');
  assert.deepEqual(t.result, ['I']);
  assert.deepEqual(t.judgment, ['F', 'G'], 'inputs with a list that the result reads directly = judgment of the auditor');
  assert.deepEqual(t.facts, ['D', 'H'], 'an input that only feeds an amount = a fact the agent may propose');
  assert.deepEqual(t.keys, ['A'], 'the sample number read by MATCH = a key, never overwritten');
  assert.deepEqual(t.reads, ['D1_GL']);
  assert.equal(t.capacity, 12);
  assert.deepEqual(t.pbc_required, ['PBC-XX-04']); assert.deepEqual(t.pbc_optional, ['PBC-GEN-01']);
  assert.deepEqual(t.risks.map(r => r.risk), ['XX-R01']);
});

test('NL-T01 shape: what the application may write, and what it may never write', async () => {
  const m = mapWorkingFile(await roundTrip(nlLike()));
  assert.equal(mayWrite(m, 'XX-02', 'D11').ok, true);
  assert.equal(mayWrite(m, 'XX-02', 'F11').reason, 'JUDGMENT_OF_THE_AUDITOR');
  assert.equal(mayWrite(m, 'XX-02', 'A11').reason, 'KEY_COLUMN');
  assert.equal(mayWrite(m, 'XX-02', 'I11').reason, 'CALCULATED');
  assert.equal(mayWrite(m, 'XX-02', 'B9').reason, 'OUTSIDE_A_TABLE');
  assert.equal(mayWrite(m, 'R_RAPPROCHEMENTS', 'F11').reason, 'JUDGMENT_OF_THE_AUDITOR', '« accepté (Senior) » is a decision');
  assert.equal(columnRole(m, 'D1_GL', 'G').role, 'judgment', '« Retenu » is chosen by the Senior / Manager');
  assert.equal(columnRole(m, 'D1_GL', 'D').role, 'fact', 'a client column with a list is still client data');
});

test('NL-T01 shape: capacities, template example rows, and data sheets', async () => {
  const m = mapWorkingFile(await roundTrip(nlLike()));
  const d1 = m.sheets.find(s => s.name === 'D1_GL'); assert.equal(d1.tables[d1.main].capacity, 20);
  const lead = m.sheets.find(s => s.name === '04_LEAD'); assert.deepEqual(lead.tables[lead.main].prefilled_rows, [11, 12]);
  assert.ok(m.warnings.includes('FORMULA_RESULTS_NOT_CACHED'));
  const sum = mapSummary(m);
  assert.ok(JSON.stringify(sum).length < JSON.stringify(m).length);
  assert.ok(sum.tests.every(t => !('formula' in t)));
});

test('another firm’s template, never seen: same map, same rules, without AUDIT_META', async () => {
  const m = mapWorkingFile(await roundTrip(otherFirm()));
  assert.equal(m.template.source, 'structure');
  assert.match(m.key, /^shape:[0-9a-f]{16}$/);
  assert.ok(m.warnings.includes('NO_AUDIT_META'));
  assert.deepEqual(m.order, ['Instructions', 'TB', 'Leadsheet', 'REV-01', 'Sign-off']);
  const role = n => m.sheets.find(s => s.name === n).role;
  assert.equal(role('TB'), 'data'); assert.equal(role('Leadsheet'), 'lead'); assert.equal(role('REV-01'), 'test'); assert.equal(role('Sign-off'), 'signoff');
  const t = m.tests.find(x => x.code === 'REV-01');
  assert.equal(fillKind({ fill: BLUE }), 'tint:DDEBF7');
  assert.deepEqual(t.result, ['G']);
  assert.deepEqual(t.judgment, ['F'], '« Correct period? » with a list, read by the conclusion');
  assert.deepEqual(t.facts, ['B', 'C', 'D', 'E']);
  assert.equal(t.capacity, 10);
  assert.deepEqual(m.sheets.find(s => s.name === 'Leadsheet').tables[0].reads_sheets, ['TB']);
  assert.equal(m.sheets.find(s => s.name === 'TB').tables[0].capacity, 500);
});

test('the same template read twice gives the same key (one map per version, reused by every mission)', async () => {
  const a = mapWorkingFile(await roundTrip(otherFirm())), b = mapWorkingFile(await roundTrip(otherFirm()));
  assert.equal(a.key, b.key);
});

// Optional check on a real template kept OUTSIDE the repository (the repository is public).
const SAMPLE = process.env.WORKFILE_MAP_SAMPLE;
test('real NL-T01 template (optional, WORKFILE_MAP_SAMPLE)', { skip: !SAMPLE || !fs.existsSync(SAMPLE || '') }, async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(SAMPLE);
  const m = mapWorkingFile(wb);
  assert.equal(m.programme.length, 14);
  assert.equal(m.programme.find(p => p.code === 'PRJ-01').activated, 'Oui');
  assert.equal(m.risks.length, 6);
  const t = m.tests.find(x => x.code === 'PRJ-05');
  assert.deepEqual(t.judgment, ['L', 'M', 'N']); assert.deepEqual(t.keys, ['A']); assert.deepEqual(t.result, ['P']);
  assert.ok(t.facts.includes('J') && t.facts.includes('O'));
  assert.equal(t.capacity, 60);
  assert.deepEqual(t.pbc_required.sort(), ['PBC-GEN-13', 'PBC-PRJ-03', 'PBC-PRJ-04']);
});

test('the procedure view returns the map of its own working file, read in the Drive (read only)', async () => {
  const { workfileMapView } = await import('../lib/workfile-map-view.js');
  const buf = Buffer.from(await nlLike().xlsx.writeBuffer());
  const writes = [];
  const drive = { getMeta: async () => ({ name: 'WP_XX.xlsx', size: buf.length, modifiedTime: '2026-10-24T10:00:00Z' }), downloadBuffer: async () => buf,
    updateBinary: async () => writes.push('update'), createFile: async () => writes.push('create') };
  const r = await workfileMapView('org', 'm1', 'XX-02', { email: 'a@b.c' }, { view: async () => ({ workpaper: { file_id: 'f1' } }), drive, now: '2026-10-24T10:00:00Z' });
  assert.equal(r.summary.key, 'XX-T01@2.0');
  assert.equal(r.procedure.test.code, 'XX-02');
  assert.deepEqual(r.procedure.test.judgment, ['F', 'G']);
  assert.equal(r.file.name, 'WP_XX.xlsx');
  assert.deepEqual(writes, [], 'nothing is written');
  await assert.rejects(workfileMapView('org', 'm1', 'XX-02', {}, { view: async () => ({ workpaper: null }), drive }), /NO_WORKPAPER_FOR_CYCLE/);
});
