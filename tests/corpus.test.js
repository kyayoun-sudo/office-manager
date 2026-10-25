// Banc d'essai (Paul, 2026-10-25 : « vas-y, fais-le ») — des pièces de formes RÉELLES (exports Sage 100, Odoo, CSV, grand livre fait main ;
// PTBA à la Hydromet, PTBA ivoirien à titres fusionnés, budget à en-tête sur deux lignes ; plan de formation qui n'est pas un budget) passent
// dans le moteur général : lecture, forme reconnue, catégories prouvées, puis remplissage de D1 et D2, l'IA répondant ou EN PANNE.
// Sur le vrai NL-T01 si WORKFILE_MAP_SAMPLE donne son chemin (jamais dans le dépôt), sinon sur un classeur de même forme.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { corpus } from './corpus/pieces.js';
import { workingFile } from './corpus/working-file.js';
import { clientTable } from '../lib/workfile-table-import.js';
import { peekDocument, sheetPlan } from '../lib/sheet-understanding.js';
import { tableStructure } from '../lib/table-structure.js';
import { ledgerColumns, ledgerRows } from '../lib/step-runner.js';

const pieces = await corpus();
const driveOf = p => ({ getMeta: async () => ({ name: p.name, size: p.buffer.length, modifiedTime: 'x' }), downloadBuffer: async () => p.buffer });

for (const p of pieces) test('lecture — ' + p.name, async () => {
  const peek = await peekDocument({ id: 'x', name: p.name }, driveOf(p));
  const t = await clientTable('x', driveOf(p)), headers = (t.rows[t.header_row] || []).map(String);
  if (p.kind === 'gl') {
    assert.match(peek.sheets[0].shape.looks_like, /grand livre/);
    assert.deepEqual(peek.sheets[0].shape.years, p.expect.years);
    const rows = ledgerRows(t, ledgerColumns(headers));
    assert.equal(rows.length, p.expect.entries, 'écritures (reports, totaux, pages répétées écartés)');
    if (p.expect.debit != null) { assert.equal(rows.reduce((s, r) => s + r.debit, 0), p.expect.debit); assert.equal(rows.reduce((s, r) => s + r.credit, 0), p.expect.credit); }
    assert.deepEqual([...new Set(rows.map(r => String(r.account)))].sort(), p.expect.accounts, 'numéro de compte seul sur chaque écriture');
  } else {
    const st = tableStructure(headers, t.rows.slice(t.header_row + 1));
    assert.deepEqual(st.categories.map(c => c.label), p.expect.categories);
    if (p.expect.amounts) assert.deepEqual(st.categories.map(c => c.amount), p.expect.amounts, 'montant de la colonne principale (le total), pas de T1 ni d’un bailleur');
    assert.ok(headers.every(h => !/PLAN DE TRAVAIL|BUDGET ANNUEL|Annexe/i.test(h)), 'le titre du document n’est pas pris pour les en-têtes');
  }
});

const sample = process.env.WORKFILE_MAP_SAMPLE && fs.existsSync(process.env.WORKFILE_MAP_SAMPLE) ? fs.readFileSync(process.env.WORKFILE_MAP_SAMPLE) : null;
const wpBuf = sample || Buffer.from(await (await workingFile()).xlsx.writeBuffer());
async function plan(sheet, docs, aiDown) {
  const files = Object.fromEntries(docs.map((p, i) => ['F' + i, p]));
  const memory = Object.entries(files).map(([id, p]) => ({ id, name: p.name, read: true, uses: [] }));
  const view = { editable: true, card: { steps: [{ text: 'x' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-03' }, mission: { period_label: 'Exercice 2023' } };
  const d = { view: async () => view, missionMemory: async () => memory, sources: async () => memory.map(m => ({ file_id: m.id, name: m.name })), save: async () => null,
    drive: { getMeta: async id => (id === 'WP' ? { name: 'WF.xlsx', size: wpBuf.length } : { name: files[id].name, size: files[id].buffer.length, modifiedTime: 'x' }), downloadBuffer: async id => (id === 'WP' ? wpBuf : files[id].buffer) },
    ai: async (pr, o) => {
      if (/vérifies le plan/.test(o.instructions)) return { text: '{}' };
      if (aiDown) throw new Error('AI_TIMEOUT');
      const cols = JSON.parse(o.input).columns.map(c => c.col);
      return { text: JSON.stringify({ rows_from: { document_id: 'F0', which: sheet === 'D2_BUDGET' ? 'subtotals' : 'lines' }, columns: cols.filter(c => sheet !== 'D2_BUDGET' || ['A', 'D'].includes(c)).map(col => ({ col, document_id: 'F0', heading: null })) }) };
    } };
  return sheetPlan('O', 'M', 'PRJ-03', { sheet }, { email: 'p' }, d);
}
const byRow = P => { const rows = {}; for (const c of P.cells) { const r = c.address.match(/\d+/)[0]; (rows[r] ||= {})[c.label] = c.value; } return Object.values(rows); };

for (const p of pieces.filter(x => x.kind === 'gl')) for (const down of [false, true]) test(`D1 ← ${p.name}${down ? ' (IA en panne)' : ''}`, async () => {
  const P = await plan('D1_GL_PROJET', [p, pieces.find(x => /FORMATION/.test(x.name))], down);
  const rows = byRow(P);
  assert.equal(rows.length, p.expect.entries);
  const amount = Object.keys(rows[0]).find(k => /^montant$/i.test(k)), cat = Object.keys(rows[0]).find(k => /cat[ée]gorie/i.test(k));
  assert.equal(Math.round(rows.reduce((s, r) => s + r[amount], 0)), p.expect.debit != null ? p.expect.debit - p.expect.credit : Math.round(rows.reduce((s, r) => s + r[amount], 0)));
  assert.ok(rows.every(r => /^\d{6}$/.test(String(r[cat]))), 'catégorie = numéro de compte (méthode du cabinet)');
  assert.ok(rows.every(r => r.Date instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(r.Date))), 'les dates sont des dates');
  assert.equal(Boolean(P.ai_error), down, 'une panne de l’IA est dite');
});
for (const p of pieces.filter(x => x.kind === 'ptba')) for (const down of [false, true]) test(`D2 ← ${p.name}${down ? ' (IA en panne)' : ''}`, async () => {
  const P = await plan('D2_BUDGET', [p, pieces.find(x => /SAGE/.test(x.name))], down);
  const rows = byRow(P);
  assert.deepEqual(rows.map(r => r['Catégorie budgétaire']), p.expect.categories);
  assert.deepEqual(rows.map(r => r['Budget final approuvé (document)']), p.expect.amounts);
  assert.ok(P.cells.every(c => !/^Budget|^Amendement/.test(c.label) || typeof c.value === 'number'), 'aucun texte dans une colonne de montants');
  assert.match(P.problem || '', /sans numéro de compte/, 'les catégories que le GL ne connaît pas sont signalées');
});

test('l’IA ne répond pas au premier appel : elle est redemandée (entrée allégée) et c’est SA réponse qui remplit', async () => {
  const p = pieces.find(x => /SAGE/.test(x.name)), calls = [];
  const files = { F0: p }, memory = [{ id: 'F0', name: p.name, read: true, uses: [] }];
  const view = { editable: true, card: { steps: [{ text: 'x' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-03' } };
  const P = await sheetPlan('O', 'M', 'PRJ-03', { sheet: 'D1_GL_PROJET' }, { email: 'p' }, { view: async () => view, missionMemory: async () => memory, sources: async () => [{ file_id: 'F0', name: p.name }], save: async () => null,
    drive: { getMeta: async id => (id === 'WP' ? { name: 'WF.xlsx', size: wpBuf.length } : { name: p.name, size: p.buffer.length }), downloadBuffer: async id => (id === 'WP' ? wpBuf : files[id].buffer) },
    ai: async (pr, o) => { if (/vérifies le plan/.test(o.instructions)) return { text: '{}' }; calls.push(o.input.length); if (calls.length === 1) throw new Error('AI_TIMEOUT');
      return { provider: 'ia', text: JSON.stringify({ rows_from: { document_id: 'F0', which: 'lines' }, columns: JSON.parse(o.input).columns.map(c => ({ col: c.col, document_id: 'F0', heading: null })) }) }; } });
  assert.equal(calls.length, 2); assert.ok(calls[1] <= calls[0]);
  assert.equal(P.ai_error, null); assert.equal(P.ai_retried, 'AI_TIMEOUT'); assert.equal(P.ai, 'ia');
  assert.ok(P.cells.length > 0);
});

// Paul, 2026-10-25 : « le GL est là, il ne l'a pas touché ; il a pris les GL auxiliaires au lieu du GL ; D3 il a recopié le GL encore une fois ».
import { auxLedger, bankStatement, bigGeneralLedger } from './corpus/pieces.js';
const general = pieces.find(x => /SAGE/.test(x.name));
async function planWith(sheet, docs, answer) {
  const files = Object.fromEntries(docs.map((p, i) => ['F' + i, p])), memory = Object.entries(files).map(([id, p]) => ({ id, name: p.name, read: true, uses: [] }));
  const view = { editable: true, card: { steps: [{ text: 'x' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-07' }, mission: { period_label: 'Exercice 2023' } };
  return sheetPlan('O', 'M', 'PRJ-07', { sheet }, { email: 'p' }, { view: async () => view, missionMemory: async () => memory, sources: async () => memory.map(m => ({ file_id: m.id, name: m.name })), save: async () => null,
    drive: { getMeta: async id => (id === 'WP' ? { name: 'WF.xlsx', size: wpBuf.length } : { name: files[id].name, size: files[id].buffer.length }), downloadBuffer: async id => (id === 'WP' ? wpBuf : files[id].buffer) },
    ai: async (pr, o) => (/vérifies le plan/.test(o.instructions) ? { text: '{}' } : answer(JSON.parse(o.input))) });
}
const shapeOf = async p => (await peekDocument({ id: 'x', name: p.name }, driveOf(p))).sheets[0].shape;

test('grand livre général, auxiliaire, relevé bancaire : reconnus par leur contenu', async () => {
  assert.match((await shapeOf(general)).looks_like, /GÉNÉRAL/);
  assert.match((await shapeOf(auxLedger())).looks_like, /AUXILIAIRE/);
  assert.match((await shapeOf(await bankStatement())).looks_like, /relevé bancaire/);
});

test('D1 : l’IA prend le grand livre AUXILIAIRE — le code remet le grand livre GÉNÉRAL', async () => {
  const P = await planWith('D1_GL_PROJET', [auxLedger('2023'), auxLedger('2024'), general], inp => ({ text: JSON.stringify({ rows_from: { document_id: 'F0', which: 'lines' }, columns: inp.columns.map(c => ({ col: c.col, document_id: 'F0', heading: null })) }) }));
  assert.ok(P.plan.filter(p => p.document_id).every(p => p.document === general.name), JSON.stringify(P.plan.map(p => p.document)));
  assert.equal(new Set(P.cells.map(c => c.address.match(/\d+/)[0])).size, general.expect.entries);
});

test('D3 : l’IA recopie le grand livre — refusé ; les crédits des relevés bancaires sont pris', async () => {
  const docs = [general, await bankStatement('06'), await bankStatement('09')];
  const P = await planWith('D3_FONDS_RECUS', docs, inp => ({ text: JSON.stringify({ rows_from: { document_id: 'F0', which: 'credits' }, columns: inp.columns.map(c => ({ col: c.col, document_id: 'F0', heading: null })) }) }));
  assert.ok(!P.plan.some(p => p.document === general.name), 'aucune colonne de D3 ne vient du grand livre');
  assert.ok(P.plan.some(p => /relevés bancaires/.test(p.why || '')));
});

test('D3 sans relevé bancaire parmi les pièces : rien n’est recopié du grand livre, et il est dit qu’il manque les relevés', async () => {
  const P = await planWith('D3_FONDS_RECUS', [general], inp => ({ text: JSON.stringify({ rows_from: { document_id: 'F0', which: 'credits' }, columns: inp.columns.map(c => ({ col: c.col, document_id: 'F0', heading: null })) }) }));
  assert.equal(P.cells.length, 0);
  assert.ok(P.plan.some(p => /aucun relevé bancaire/.test(p.why || '')));
});

test('un grand livre général de 25 000 lignes est lu (avant : refusé sans le dire, les auxiliaires pris à sa place)', async () => {
  const big = await bigGeneralLedger(25000);
  const t = await clientTable('x', driveOf(big));
  assert.equal(t.rows.length - 1 - t.header_row, 25000);
  assert.match((await shapeOf(big)).looks_like, /GÉNÉRAL/);
});

// Paul, 2026-10-25 : « D2 : reconnaître la catégorie budgétaire avec les noms, chercher dans le grand livre, trouver les comptes ; [le montant
// du PTBA] dans budget initial ; ensuite prendre le TEB, mettre les montants d'engagement correspondant à ses comptes ».
import { ptbaByNature, tebByAccount } from './corpus/pieces.js';
for (const variant of ['ai-wrong', 'ai-down']) test(`D2 selon la méthode de Paul : PTBA → comptes du GL → initial ; TEB → final et engagements par compte (${variant})`, async () => {
  const docs = [await tebByAccount(), await ptbaByNature(), general];
  // the AI takes the TEB for everything (what Paul saw) — or does not answer
  const P = await planWith('D2_BUDGET', docs, variant === 'ai-down' ? () => { throw new Error('AI_DOWN'); } : inp => ({ text: JSON.stringify({ rows_from: { document_id: 'F0', which: 'lines' }, columns: inp.columns.map(c => ({ col: c.col, document_id: 'F0', heading: null })) }) }));
  const byRow = {}; for (const c of P.cells) { const [, col, row] = c.address.match(/^([A-Z]+)(\d+)$/); (byRow[row] ||= {})[col] = c.value; }
  const rows = Object.values(byRow).map(r => [r.A, r.B, r.C ?? null, r.D ?? null, r.E ?? null]);
  assert.deepEqual(rows, [
    ['605300', 300000, 20000, 320000, 232500],
    ['618120', 800000, 100000, 900000, 805000],        // two TEB lines of 618120 added up
    ['632400', 1500000, 0, 1500000, 1200000],
    ['Équipements informatiques', 1050000, null, null, null]], JSON.stringify(P.plan.map(p => [p.col, p.document, p.heading, p.why])));
  assert.ok(P.preview.categories.without_account.some(x => /Équipements/.test(x)));
});

test('D2 selon la méthode de Paul : « Oui, remplis » écrit exactement ces valeurs dans le working file', async () => {
  const { acceptSheetPlan } = await import('../lib/sheet-understanding.js');
  const ExcelJS = (await import('exceljs')).default;
  const docs = [await tebByAccount(), await ptbaByNature(), general];
  const files = Object.fromEntries(docs.map((p, i) => ['F' + i, p])), memory = Object.entries(files).map(([id, p]) => ({ id, name: p.name, read: true, uses: [] }));
  let wp = Buffer.from(wpBuf), mod = 1;
  const view = { editable: true, card: { steps: [{ text: 'x' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-03' }, mission: { period_label: 'Exercice 2023' } };
  const d = { view: async () => view, missionMemory: async () => memory, sources: async () => memory.map(m => ({ file_id: m.id, name: m.name })), save: async (o, w, c) => Object.assign(view.work, c), audit: async () => null, noteMissionEvent: async () => null,
    drive: { getMeta: async id => (id === 'WP' ? { name: 'WF.xlsx', size: wp.length, modifiedTime: 'v' + mod } : { name: files[id].name, size: files[id].buffer.length, modifiedTime: 'x' }), downloadBuffer: async id => (id === 'WP' ? wp : files[id].buffer), updateBinary: async (id, o) => { wp = o.buffer; mod++; } },
    ai: async () => { throw new Error('AI_DOWN'); } };
  const P = await sheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET' }, { email: 'p' }, d);
  await acceptSheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET', rows_from: P.rows_from, gl_document_id: P.gl_document_id, columns: P.plan.map(p => ({ col: p.col, document_id: p.document_id, heading: p.heading, compute: p.compute, account_from_gl: p.account_from_gl })) }, { email: 'p' }, d);
  const b = new ExcelJS.Workbook(); await b.xlsx.load(wp); const s = b.getWorksheet('D2_BUDGET');
  const first = P.cells.map(c => +c.address.match(/\d+/)[0]).sort((x, y) => x - y)[0];
  assert.deepEqual([0, 1].map(k => [1, 2, 3, 4, 5].map(c => s.getCell(first + k, c).value)), [['605300', 300000, 20000, 320000, 232500], ['618120', 800000, 100000, 900000, 805000]]);
});
