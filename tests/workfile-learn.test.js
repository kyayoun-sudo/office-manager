import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { norm, startWatch, learnFromPerson, confirmLesson, learningState, templateLessons } from '../lib/workfile-learn.js';
import { finishImport } from '../lib/workfile-import-assist.js';

const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
const DARK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };

async function setup() {
  // The working file: D2_BUDGET (Catégorie budgétaire, Budget initial, Amendements) empty.
  const w = new ExcelJS.Workbook(), s = w.addWorksheet('D2_BUDGET');
  s.getCell('A1').value = 'D2 — Budget approuvé par catégorie';
  ['Catégorie budgétaire', 'Budget initial', 'Amendements / réallocations (net)'].forEach((h, i) => { const c = s.getCell(10, i + 1); c.value = h; c.fill = DARK; c.font = { bold: true }; });
  for (let r = 11; r <= 20; r++) for (let c = 1; c <= 3; c++) s.getCell(r, c).fill = YELLOW;
  let wp = Buffer.from(await w.xlsx.writeBuffer()), modified = 1;
  // The PTBA: component titles, category lines (B.1, B.2) with their amounts, and a total.
  const p = new ExcelJS.Workbook(), x = p.addWorksheet('PTBA');
  [['Code', 'Rubrique', 'Montant 2023', 'Révision'], ['', 'SOUS-COMPOSANTE I.1 : APPUI', null, null], ['B.1', 'ASSISTANCE TECHNIQUE', 1200000, 50000], ['B.2', 'FORMATION', 800000, -20000],
    ['', 'SOUS-COMPOSANTE I.2 : REFORMES', null, null], ['B.3', 'EQUIPEMENTS', 450000, 0], ['', 'TOTAL', 2450000, 30000]].forEach(r => x.addRow(r));
  const ptba = Buffer.from(await p.xlsx.writeBuffer());
  const view = { editable: true, workpaper: { file_id: 'WP', url: 'https://drive/wp' }, work: { status: 'in_progress', walkthrough: [] } };
  const memory = { state: null, fileId: null };
  const d = {
    view: async () => view, save: async (o, wk, c) => Object.assign(view.work, c), audit: async () => null,
    sources: async () => [{ file_id: 'PTBA', name: 'PTBA 2023.xlsx' }],
    options: async () => ({ files: [{ file_id: 'PTBA', name: 'PTBA 2023.xlsx' }], sheets: [{ name: 'PTBA' }] }),
    loadJsonFile: async () => ({ state: memory.state ? JSON.parse(JSON.stringify(memory.state)) : null, fileId: memory.fileId }),
    saveJsonFile: async (n, dr, f, id, state) => { memory.state = JSON.parse(JSON.stringify(state)); memory.fileId = 'MEM'; },
    ai: async (order, args) => { const inp = JSON.parse(args.input); return { provider: 'test-ai', text: JSON.stringify({ summary: 'Seules les lignes de rubrique (code B.x) du PTBA sont recopiées ; titres de sous-composante et total laissés.',
      rules: [{ column: 'Catégorie budgétaire', from: 'Rubrique', transform: 'copy', rows: 'lignes avec un code B.x seulement', note: '' }], questions: [], seen: inp.rows_of_the_piece ? inp.rows_of_the_piece.taken.length : 0 }) }; },
    drive: {
      getMeta: async id => id === 'WP' ? { name: 'W.xlsx', size: wp.length, modifiedTime: 'v' + modified } : { name: 'PTBA 2023.xlsx', size: ptba.length, modifiedTime: 'x' },
      downloadBuffer: async id => id === 'WP' ? wp : ptba
    }
  };
  const fillByHand = async () => { const b = new ExcelJS.Workbook(); await b.xlsx.load(wp); const t = b.getWorksheet('D2_BUDGET');
    [['ASSISTANCE TECHNIQUE', 1200000, 50000], ['FORMATION', 800000, -20000], ['EQUIPEMENTS', 450000, 0]].forEach((row, i) => row.forEach((v, j) => { t.getCell(11 + i, j + 1).value = v; }));
    wp = Buffer.from(await b.xlsx.writeBuffer()); modified++; };
  return { d, view, memory, fillByHand };
}
const paul = { email: 'paul@x.ci' };

test('values compare across a piece and the working file (numbers, dates, text)', () => {
  assert.equal(norm('1 200 000'), norm(1200000));
  assert.equal(norm('03/01/2024'), norm(new Date('2024-01-03T00:00:00Z')));
  assert.equal(norm(' Assistance  technique '), norm('ASSISTANCE TECHNIQUE'));
});

test('watch, the person fills in Excel, the agent finds where each value comes from and which lines were taken; no client value kept', async () => {
  const f = await setup();
  const w = await startWatch('O', 'M', 'PRJ-03', {}, paul, f.d);
  assert.equal(w.watching, true);
  assert.equal(w.url, 'https://drive/wp');
  const rec = f.view.work.walkthrough.find(r => r.kind === 'learning-watch');
  assert.ok(!JSON.stringify(rec).includes('ASSISTANCE'));            // only rows and fingerprints
  await f.fillByHand();
  const r = await learnFromPerson('O', 'M', 'PRJ-03', {}, paul, f.d);
  const x = r.learned.find(l => l.sheet === 'D2_BUDGET');
  assert.equal(x.filled, 9);
  assert.deepEqual(x.mappings.map(m => [m.dest_header, m.source_header, m.support]), [['Catégorie budgétaire', 'Rubrique', '3/3'], ['Budget initial', 'Montant 2023', '3/3'], ['Amendements / réallocations (net)', 'Révision', '3/3']]);
  assert.match(x.logic.summary, /lignes de rubrique/);
  const saved = JSON.stringify(f.memory.state);
  assert.ok(!saved.includes('1200000') && !saved.includes('ASSISTANCE'));   // headers and rules only
  assert.equal(f.memory.state.templates[r.template].D2_BUDGET.status, 'to_confirm');
  assert.equal(f.view.work.walkthrough.find(y => y.kind === 'learning-watch').status, 'learned');
});

test('only a validated lesson is used: its columns win over the guess, and the AI is told the rule', async () => {
  const f = await setup();
  await startWatch('O', 'M', 'PRJ-03', {}, paul, f.d); await f.fillByHand();
  const r = await learnFromPerson('O', 'M', 'PRJ-03', {}, paul, f.d);
  const items = [{ id: 'X|PTBA', file: { file_id: 'X', name: 'PTBA 2024.xlsx' }, sheet: 'PTBA', by: 'code', mapping: [{ column: 2, label: 'Budget initial', source: 3, source_label: 'Révision', by: 'code' }],
    p: { source_headers: ['Code', 'Rubrique', 'Montant 2024', 'Révision'].map((h, i) => (i === 2 ? 'Montant 2023' : h)), sample_rows: [], years: {}, rows: 3, columns: [{ column: 1, label: 'Catégorie budgétaire' }, { column: 2, label: 'Budget initial' }, { column: 3, label: 'Amendements / réallocations (net)' }] } }];
  let told = null;
  const d = { ...f.d, fetchRows: async () => [{ period_label: '2023' }], ai: async (o, args) => { told = JSON.parse(args.input); return { provider: 't', text: '{}' }; } };
  const before = await finishImport('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', items: JSON.parse(JSON.stringify(items)), profile: { template_key: r.template } }, paul, d);
  assert.equal(before.learned, false);                                  // to confirm: not used yet
  await confirmLesson('O', 'M', 'PRJ-03', { template: r.template, sheet: 'D2_BUDGET', decision: 'validated', note: 'Ignorer les lignes sans code B.x' }, paul, f.d);
  const after = await finishImport('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', items: JSON.parse(JSON.stringify(items)), profile: { template_key: r.template } }, paul, d);
  assert.equal(after.learned, true);
  const m = after.items[0].mapping.map(x => [x.label, x.source_label, x.by]);
  assert.deepEqual(m, [['Catégorie budgétaire', 'Rubrique', 'appris'], ['Budget initial', 'Montant 2023', 'appris'], ['Amendements / réallocations (net)', 'Révision', 'appris']]);
  assert.equal(told.pieces[0].learned_from_the_auditor.person_rule, 'Ignorer les lignes sans code B.x');
  const state = await learningState(f.view, r.template, f.d);
  assert.equal(state.lessons[0].status, 'validated');
  assert.equal((await templateLessons(r.template, f.d)).D2_BUDGET.decided_by, 'paul@x.ci');
});

test('nothing changed: said plainly, nothing learned', async () => {
  const f = await setup();
  await startWatch('O', 'M', 'PRJ-03', {}, paul, f.d);
  const r = await learnFromPerson('O', 'M', 'PRJ-03', {}, paul, f.d);
  assert.equal(r.nothing_changed, true);
});
