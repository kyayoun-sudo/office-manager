import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { expectedPieces, locatePieces, workfileNeeds, linkNeed } from '../lib/workfile-needs.js';
import { clearSheetWork } from '../lib/workfile-map-view.js';

const map = {
  pbc: { items: [
    { id: 'PBC-PRJ-01', name: 'Budget initial, amendements, no-objections / approbations et budget final par catégorie', type: 'Document', tests: ['PRJ-03'] },
    { id: 'PBC-PRJ-03', name: 'GL analytique par projet / bailleur / catégorie (extraction exploitable)', type: 'Extraction', tests: ['PRJ-05'] },
    { id: 'PBC-GEN-13', name: 'Conventions de financement, notifications et amendements', type: 'Document permanent', tests: ['PRJ-01'] },
    { id: 'PBC-GEN-09', name: 'Organigramme et matrice d’approbation', type: 'Document permanent', tests: ['PRJ-01'] }] },
  tests: [{ code: 'PRJ-01', pbc_required: ['PBC-GEN-13', 'PBC-GEN-09'], reads: [] }, { code: 'PRJ-03', pbc_required: ['PBC-PRJ-01'], reads: ['D2_BUDGET'] }, { code: 'PRJ-05', pbc_required: ['PBC-PRJ-03'], reads: ['D1_GL_PROJET'] }],
  sheets: [{ name: 'D2_BUDGET', role: 'data', title: 'D2 — Budget approuvé par catégorie', instructions: [{ text: 'Budget de la convention : initial, amendements, final approuvé.' }] },
    { name: 'D1_GL_PROJET', role: 'data', title: 'D1 — GL analytique des projets', instructions: [] }]
};
const memory = [
  { id: 'b', name: 'TABLEAU_BUDGETAIRE_PTBA_2023.xlsx', read: true, title: 'Tableau budgétaire PTBA 2023', summary: 'Budget par catégorie, amendements', location: 'PAGFIC/03_BUDGET', history: [] },
  { id: 'g', name: 'GRAND_LIVRE_GENERAL_2024.xls', read: true, title: 'Grand livre général 2024', summary: 'écritures', location: 'PAGFIC/04_COMPTA', history: [] },
  { id: 'c', name: 'ACCORD_DE_PRET_FAD.pdf', read: true, title: 'Accord de prêt FAD — convention de financement', summary: '', uses: [{ what: 'pbc', where: 'PBC-GEN-13' }], history: [] }
];

test('the working file says which piece feeds which sheet and which test', () => {
  const e = expectedPieces(map);
  assert.deepEqual(e.sheets.find(s => s.sheet === 'D2_BUDGET').pieces, ['PBC-PRJ-01']);
  assert.deepEqual(e.sheets.find(s => s.sheet === 'D1_GL_PROJET').pieces, ['PBC-PRJ-03']);
});

test('pieces are found in the mission memory: a confirmed link first, then by what the document IS (GL = grand livre)', () => {
  const r = locatePieces(expectedPieces(map).items, memory);
  const at = id => r.find(x => x.id === id);
  assert.equal(at('PBC-GEN-13').status, 'linked');
  assert.equal(at('PBC-PRJ-01').status, 'probable');
  assert.equal(at('PBC-PRJ-01').docs[0].id, 'b');
  assert.equal(at('PBC-PRJ-03').docs[0].id, 'g');
  assert.equal(at('PBC-GEN-09').status, 'missing');
});

test('the AI can only remove a weak match, never add one; « Ce n’est pas ça » is remembered', async () => {
  const d = { view: async () => ({ card: {} }), map, missionMemory: async () => memory,
    ai: async (o, args) => ({ provider: 't', text: JSON.stringify({ checks: [{ pbc: 'PBC-PRJ-01', file_id: 'b', answers: true }, { pbc: 'PBC-PRJ-03', file_id: 'g', answers: false, why: 'grand livre général, pas analytique' }, { pbc: 'PBC-GEN-09', file_id: 'x', answers: true }] }) }) };
  const r = await workfileNeeds('O', 'M', 'PRJ-01', {}, d);
  assert.equal(r.items.find(x => x.id === 'PBC-PRJ-01').docs[0].ai, true);
  assert.equal(r.items.find(x => x.id === 'PBC-PRJ-03').status, 'missing');
  assert.equal(r.items.find(x => x.id === 'PBC-GEN-09').status, 'missing');
  assert.deepEqual(r.current_test.pieces, ['PBC-GEN-13', 'PBC-GEN-09']);
  let noted = null;
  await linkNeed('O', 'M', 'PRJ-01', { pbc: 'PBC-PRJ-01', file_id: 'b', decision: 'no' }, { email: 'p' }, { view: async () => ({}), noteMissionEvent: async (o, m, f, e) => { noted = e; } });
  const mem2 = memory.map(x => (x.id === 'b' ? { ...x, history: [{ what: noted.what, detail: noted.detail }] } : x));
  assert.equal(locatePieces(expectedPieces(map).items, mem2).find(x => x.id === 'PBC-PRJ-01').status, 'missing');
});

test('« Vider tout le travail de cette feuille » empties its input cells, keeps formulas, asks for confirmation', async () => {
  const w = new ExcelJS.Workbook(), s = w.addWorksheet('D2_BUDGET');
  ['Catégorie budgétaire', 'Budget initial', 'Total'].forEach((h, i) => { const c = s.getCell(4, i + 1); c.value = h; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }; c.font = { bold: true }; });
  for (let r = 5; r <= 8; r++) { for (let c = 1; c <= 2; c++) s.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } }; s.getCell(r, 3).value = { formula: 'B' + r + '*1' }; }
  s.getCell('A5').value = 'Personnel'; s.getCell('B5').value = 100; s.getCell('A6').value = 'Formation'; s.getCell('B6').value = 50;
  let buf = Buffer.from(await w.xlsx.writeBuffer()), mod = 1;
  const d = { view: async () => ({ editable: true, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] } }), audit: async () => null,
    drive: { getMeta: async () => ({ size: buf.length, modifiedTime: 'v' + mod }), downloadBuffer: async () => buf, updateBinary: async (id, o) => { assert.equal(o.expectedModifiedTime, 'v' + mod); buf = o.buffer; mod++; } } };
  await assert.rejects(clearSheetWork('O', 'M', 'PRJ-03', { email: 'p' }, { sheet: 'D2_BUDGET' }, d), /CONFIRM_REQUIRED/);
  const r = await clearSheetWork('O', 'M', 'PRJ-03', { email: 'p' }, { sheet: 'D2_BUDGET', confirm: true }, d);
  assert.equal(r.cleared, 4);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(buf); const t = back.getWorksheet('D2_BUDGET');
  assert.equal(t.getCell('A5').value, null); assert.equal(t.getCell('B6').value, null);
  assert.equal(t.getCell('C5').formula, 'B5*1');
  assert.equal(t.getCell('A4').value, 'Catégorie budgétaire');
});
