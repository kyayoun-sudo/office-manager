// L'IA comprend et donne les ordres, le code exécute et vérifie (Paul, 2026-10-26 : « le code a la capacité de lire, mais sa capacité de
// comprendre et son cerveau, c'est l'IA »).
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { workingFile } from './corpus/working-file.js';
import { fillOrdersPlan as prepareOnce, acceptFillOrders, cleanOrders } from '../lib/fill-orders.js';

async function fillOrdersPlan(...args) {
  let result;
  for (let n=0;n<40;n++) { result=await prepareOnce(...args); if(!result.pending) return result; }
  throw new Error('TEST_PREPARATION_DID_NOT_FINISH');
}

const wpBuf = Buffer.from(await (await workingFile()).xlsx.writeBuffer());
// A budget execution table as a client sends it: title lines, headers on line 4, category sub-totals between the detail lines, a total.
async function teb() {
  const w = new ExcelJS.Workbook(), ws = w.addWorksheet('Exécution 2023');
  ws.getCell('A1').value = 'PROJET X — TABLEAU D’EXÉCUTION BUDGÉTAIRE 2023';
  ws.getRow(4).values = ['Code', 'Ligne budgétaire', 'Budget de l’exercice', 'Engagé', 'Décaissé'];
  const rows = [['1.1', 'Salaires', 300, 280, 270], ['1.2', 'Primes', 50, 40, 40], [null, 'Sous-total Personnel', 350, 320, 310], ['2.1', 'Loyers', 100, 100, 90], [null, 'Sous-total Fonctionnement', 100, 100, 90], [null, 'TOTAL', 450, 420, 400]];
  rows.forEach((r, i) => { ws.getRow(5 + i).values = r; });
  return Buffer.from(await w.xlsx.writeBuffer());
}
async function gl() {
  const w = new ExcelJS.Workbook(), ws = w.addWorksheet('GL');
  ws.getRow(1).values = ['Compte', 'Intitulé', 'Date', 'Débit', 'Crédit'];
  [['661100', 'Salaires du personnel', '2023-01-31', 270, 0], ['622200', 'Locations', '2023-02-28', 90, 0]].forEach((r, i) => { ws.getRow(2 + i).values = r; });
  return Buffer.from(await w.xlsx.writeBuffer());
}
const files = { T: { name: 'TEB_2023.xlsx', buffer: await teb() }, G: { name: 'GL_2023.xlsx', buffer: await gl() } };

function harness(answer, extra = {}) {
  const memory = Object.entries(files).map(([id, p]) => ({ id, name: p.name, read: true, uses: [] }));
  const saved = [];
  const view = { editable: true, card: { code: 'PRJ-03', objective: 'Vérifier le budget', steps: [{ text: 'Recalculer le budget final' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: extra.walkthrough || [] }, line: { code: 'PRJ-03' }, mission_id: 'M', mission: { period_label: 'Exercice 2023' } };
  const asked = [];
  const notes = [];
  const d = { permissions: async () => ({ granted: true }), notes, noteMission: async (o, m, n) => { notes.push(...(Array.isArray(n) ? n : [n])); }, missionBrief: async () => ({ open: [{ id: 'n1', kind: 'manquant', text: 'Convention à obtenir' }], settled: [] }), view: async () => view, missionMemory: async () => memory, sources: async () => memory.map(m => ({ file_id: m.id, name: m.name })), methodology: async () => ({}),
    save: async (o, w, patch) => { saved.push(patch); Object.assign(view.work, patch); return view.work; },
    drive: { getMeta: async id => (id === 'WP' ? { name: 'WF.xlsx', size: wpBuf.length } : { name: files[id].name, size: files[id].buffer.length, modifiedTime: 'x' }), downloadBuffer: async id => (id === 'WP' ? wpBuf : files[id].buffer) },
    ai: async (pr, o) => { asked.push(JSON.parse(o.input)); return answer(JSON.parse(o.input)); }, ...extra.d };
  return { d, saved, asked, view };
}
const D2 = { sheet: 'D2_BUDGET' };
const ORDERS = {
  understanding: 'Le budget par catégorie, pour recalculer initial + amendements = final (PRJ-03).',
  blocks: [{ document_id: 'T', sheet: 'Exécution 2023', rows: { from: 5, to: 9, except: [] , only: [7, 9] }, columns: [{ target: 'A', source: 'B', transform: 'text', why: 'catégorie' }, { target: 'D', source: 'C', transform: 'number', why: 'budget final' }, { target: 'E', source: 'D', transform: 'number', why: 'engagements' }], why: 'les sous-totaux sont les catégories' }],
  checks: [{ target: 'D', document_id: 'T', sheet: 'Exécution 2023', row: 10, column: 'C' }],
  missing: [{ target: 'B', piece: 'Convention (budget initial)', why: 'le TEB ne donne que le budget de l’exercice' }],
  summary: 'ok'
};

test('l’IA reçoit le SOP, la feuille et le CONTENU des pièces avec les vrais numéros de ligne', async () => {
  const h = harness(() => ({ text: JSON.stringify(ORDERS) }));
  await fillOrdersPlan('O', 'M', 'PRJ-03', D2, { email: 'p' }, h.d);
  const inp = h.asked.at(-1).context;
  assert.equal(inp.sheet.name, 'D2_BUDGET');
  assert.ok(inp.sheet.columns.some(c => c.col === 'D' && c.what_the_tests_do.length), 'ce que les tests font de chaque colonne');
  assert.ok(inp.sop.length, 'le SOP est donné');
  assert.equal(inp.mission_memory.open[0].text, 'Convention à obtenir', 'la mémoire partagée de la mission est donnée à l’IA');
  const t = h.asked.find(i => i.feedback?.some(p => p.file_id === 'T' && p.window)).feedback.find(p => p.file_id === 'T' && p.window).window;
  assert.deepEqual(t.lines.find(l => l.row === 7).cells.slice(0, 2).map(c=>c.value), [null, 'Sous-total Personnel'], 'vraies lignes et colonnes de la pièce');

});

test('le code exécute exactement les ordres : lignes 7 et 9, colonnes B, C, D → A, D, E ; total contrôlé ; ce qui manque est dit', async () => {
  const h = harness(() => ({ text: JSON.stringify(ORDERS) }));
  const P = await fillOrdersPlan('O', 'M', 'PRJ-03', D2, { email: 'p' }, h.d);
  const rows = {}; for (const c of P.cells) (rows[c.address.match(/\d+/)[0]] ||= {})[c.address[0]] = c.value;
  assert.deepEqual(Object.values(rows), [{ A: 'Sous-total Personnel', D: 350, E: 320 }, { A: 'Sous-total Fonctionnement', D: 100, E: 100 }]);
  assert.match(P.cells.find(c => c.address === 'D11').source, /TEB_2023\.xlsx — Exécution 2023 C, ligne 7/);
  assert.deepEqual(P.checks.map(c => c.ok), [true], 'le total écrit (450) est comparé à la ligne 10 de la pièce (450)');
  assert.ok(P.missing.some(m => m.col === 'B' && /Convention/.test(m.piece)));
  assert.ok(P.order_lines[0].includes('lignes 7, 9'));
  assert.equal(h.saved.at(-1).walkthrough.at(-1).kind, 'fill-orders', 'les ordres sont gardés par le serveur');
});

test('un total qui ne tombe pas juste est DIT, rien n’est corrigé par le code', async () => {
  const bad = { ...ORDERS, blocks: [{ ...ORDERS.blocks[0], rows: { only: [7] } }] };
  const P = await fillOrdersPlan('O', 'M', 'PRJ-03', D2, { email: 'p' }, harness(() => ({ text: JSON.stringify(bad) })).d);
  assert.equal(P.checks[0].ok, false); assert.match(P.checks[0].detail, /écart/);
  assert.equal(P.preview.rows, 1);
});

test('les règles dures : pièce inconnue, colonne de formule, même colonne des deux côtés du recalcul, texte dans des montants', async () => {
  const o = { blocks: [
    { document_id: 'X', sheet: 'S', rows: { from: 1, to: 2 }, columns: [{ target: 'A', source: 'A' }] },
    { document_id: 'T', sheet: 'Exécution 2023', rows: { from: 5, to: 6 }, columns: [{ target: 'A', source: 'B' }, { target: 'F', source: 'C' }, { target: 'B', source: 'C' }, { target: 'D', source: 'C' }, { target: 'C', source: 'B' }] }] };
  const P = await fillOrdersPlan('O', 'M', 'PRJ-03', D2, { email: 'p' }, harness(() => ({ text: JSON.stringify(o) })).d);
  assert.match(P.ai_error, /PIECE_NOT_IN_MISSION/);
  const cleaned = cleanOrders(o, {columns:[{col:'A'},{col:'B'},{col:'C'},{col:'D'}]}, ['T']);
  assert.ok(cleaned.problems.some(p=>/pièce inconnue/.test(p)));
  assert.ok(cleaned.problems.some(p=>/F n’est pas une colonne de saisie/.test(p)));

});

test('alignement d’une autre pièce sur une clé, et correspondances de l’IA vérifiées dans le grand livre', async () => {
  const o = { blocks: [
    { document_id: 'T', sheet: 'Exécution 2023', rows: { only: [5, 8] }, columns: [{ target: 'A', source: 'B' }, { target: 'D', source: 'C' }] },
    { document_id: 'G', sheet: 'GL', rows: { from: 2, to: 3 }, align: { target: 'A', source: 'B' }, columns: [{ target: 'E', source: 'D' }] }],
    lookups: [{ target: 'A', map: [{ from: 'Salaires', to: '661100' }, { from: 'Loyers', to: '999999' }], verify_in: { document_id: 'G', sheet: 'GL', column: 'A' } }] };
  const P = await fillOrdersPlan('O', 'M', 'PRJ-03', D2, { email: 'p' }, harness(() => ({ text: JSON.stringify(o) })).d);
  const A = P.cells.filter(c => c.address[0] === 'A').map(c => c.value);
  assert.deepEqual(A, ['661100', 'Loyers'], 'le compte inventé (999999) est refusé, la valeur reste');
  assert.ok(P.checks.some(c => /refusée/.test(c.detail)));
  assert.ok(P.preview.unmatched['GL_2023.xlsx'], 'les lignes sans correspondance sont dites');
});

test('l’IA ne répond pas : rien n’est proposé par le code, la panne est dite', async () => {
  const P = await fillOrdersPlan('O', 'M', 'PRJ-03', D2, { email: 'p' }, harness(() => { throw new Error('AI_TIMEOUT'); }).d);
  assert.equal(P.ai, 'unavailable'); assert.match(P.ai_error, /AI_TIMEOUT/); assert.equal(P.cells.length, 0);
});

test('« Oui, remplis » réexécute les ordres GARDÉS sur les fichiers, pas ce que le navigateur envoie', async () => {
  const kept = { kind: 'fill-orders', sheet: 'D2_BUDGET', orders: cleanOrders(ORDERS, { columns: ['A', 'B', 'C', 'D', 'E'].map(col => ({ col })) }, ['T', 'G']), fingerprint: null };
  let written = null;
  const h = harness(() => ({ text: '{}' }), { walkthrough: [kept], d: {
    preview: async () => ({ revision: 'r', columns: [1, 2, 3, 4, 5].map(column => ({ column })) }),
    run: async (o, m, c, body, a, dd) => { written = { mapping: body.mapping, table: await dd.readTable() }; return { verified: true }; }, noteMissionEvent: async () => null } });
  const r = await acceptFillOrders('O', 'M', 'PRJ-03', { ...D2, columns: [{ col: 'A', document_id: 'G' }] }, { email: 'p' }, h.d);
  assert.deepEqual(written.table.rows.slice(1).map(x => [x[0], x[3]]), [['Sous-total Personnel', 350], ['Sous-total Fonctionnement', 100]]);
  assert.deepEqual(written.mapping.map(m => m.column), [1, 4, 5]);
  assert.equal(r.checks[0].ok, true);
  assert.ok(h.d.notes.some(n => n.kind === 'fait' && /D2_BUDGET rempli/.test(n.text)) && h.d.notes.some(n => n.kind === 'manquant' && /Convention/.test(n.text)), 'la mémoire de la mission apprend ce qui est fait et ce qui manque');
  await assert.rejects(acceptFillOrders('O', 'M', 'PRJ-03', D2, { email: 'p' }, harness(() => ({ text: '{}' })).d), /PREPARE_AGAIN/);
});

test('une préparation acceptée et vérifiée est réutilisée sans nouvel appel IA, avec les mêmes contrôles et confirmation humaine', async () => {
  let recipe = null;
  const h = harness(() => ({ provider: 'ia', text: JSON.stringify({ ...ORDERS, computed: [{ target: 'C', formula: 'D-B', why: 'recalcul' }] }) }), { d: {
    recipeFor: async () => recipe, saveRecipe: async (key, r) => { recipe = r; },
    preview: async () => ({ revision: 'r', columns: [1, 2, 3, 4, 5].map(column => ({ column })) }),
    run: async () => ({ verified: true, plan_id: 'approved-plan' }), review: async () => ({ confirmed: true }), noteMissionEvent: async () => null
  } });
  h.d.save = async (o, work, patch) => { Object.assign(h.view.work, patch); return h.view.work; };
  const first = await fillOrdersPlan('O', 'M', 'PRJ-03', D2, { email: 'paul@cabinet' }, h.d);
  const calls = h.asked.length; assert.ok(calls >= 2); assert.ok(first.order_lines.some(x => /C = D/.test(x)));
  const accepted = await acceptFillOrders('O', 'M', 'PRJ-03', D2, { email: 'paul@cabinet' }, h.d);
  assert.equal(accepted.method_learned, true); assert.equal(recipe.orders_method.validated_by, 'paul@cabinet');
  const next = await fillOrdersPlan('O', 'M', 'PRJ-03', D2, { email: 'paul@cabinet' }, h.d);
  assert.equal(h.asked.length, calls, 'aucun appel IA pour réexpliquer la même méthode');
  assert.equal(next.ai, 'validated-memory'); assert.equal(next.reused_method.validated_by, 'paul@cabinet');
  assert.deepEqual(next.cells, first.cells); assert.deepEqual(next.checks, first.checks);
  await fillOrdersPlan('O', 'M', 'PRJ-03', { ...D2, hint: 'Réexamine ce choix' }, { email: 'paul@cabinet' }, h.d);
  assert.ok(h.asked.length > calls, 'la personne peut demander une nouvelle analyse');
});

test('des ordres non confirmés ne deviennent jamais une méthode apprise', async () => {
  let saved = false;
  const h = harness(() => ({ text: JSON.stringify(ORDERS) }), { d: { recipeFor: async () => null, saveRecipe: async () => { saved = true; } } });
  await fillOrdersPlan('O', 'M', 'PRJ-03', D2, { email: 'p' }, h.d);
  assert.equal(saved, false);
});

test('PTBA sans code : l’IA dirige initial PTBA, final TEB, amendements et correspondances GL par le sens', async () => {
  const ptba = new ExcelJS.Workbook(); const ws = ptba.addWorksheet('Prévision');
  [['Poste budgétaire','Initial'], ['Rémunérations',300], ['Charges des locaux',90]].forEach(row => ws.addRow(row));
  const pbytes = Buffer.from(await ptba.xlsx.writeBuffer());
  const o = { blocks: [
    { document_id: 'P', sheet: 'Prévision', rows: { from: 2 }, columns: [{ target: 'A', source: 'A' }, { target: 'B', source: 'B', transform: 'number' }] },
    { document_id: 'T', sheet: 'Exécution 2023', rows: { only: [7,9] }, align: { target: 'A', source: 'B', source_map: [
      { from: 'Sous-total Personnel', to: 'Rémunérations', why: 'Même poste de personnel, libellés différents dans PTBA et TEB' },
      { from: 'Sous-total Fonctionnement', to: 'Charges des locaux', why: 'Le détail du TEB comporte le loyer, à valider' }] },
      columns: [{ target: 'D', source: 'C', transform: 'number' }, { target: 'E', source: 'D', transform: 'number' }] }
  ], computed: [{ target: 'C', formula: 'D-B', why: 'Budget final TEB moins budget initial PTBA' }],
  lookups: [{ target: 'A', map: [{ from: 'Rémunérations', to: '661100' }, { from: 'Charges des locaux', to: '622200' }], verify_in: { document_id: 'G', sheet: 'GL', column: 'A' } }] };
  const h = harness(inp => ({ text: JSON.stringify(o) }));
  const sourceDocs = [...Object.entries(files).map(([id, f]) => ({ id, name: f.name, read: true })), { id: 'P', name: 'document.xlsx', read: true }];
  h.d.sources = async () => sourceDocs.map(x => ({ file_id: x.id, name: x.name })); h.d.missionMemory = async () => sourceDocs;
  const download = h.d.drive.downloadBuffer, meta = h.d.drive.getMeta;
  h.d.drive.downloadBuffer = async id => id === 'P' ? pbytes : download(id);
  h.d.drive.getMeta = async id => id === 'P' ? { size: pbytes.length, modifiedTime: 'v1' } : meta(id);
  const original = h.d.ai; h.d.ai = async (providers, request) => { assert.match(request.instructions, /AUCUN code/); assert.match(request.instructions, /budget final approuvé − budget initial/); return original(providers, request); };
  const result = await fillOrdersPlan('O', 'M', 'PRJ-03', D2, { email: 'p' }, h.d);
  const row = {}; result.cells.filter(c => c.address.endsWith('11')).forEach(c => { row[c.address[0]] = c.value; });
  assert.deepEqual(row, { A: '661100', B: 300, C: 50, D: 350, E: 320 });
  assert.ok(result.order_lines.some(l => /Sous-total Personnel.*Rémunérations/.test(l)));
  const cleaned = cleanOrders(cleanOrders(o, { columns: ['A','B','C','D','E'].map(col => ({ col })) }, ['P','T','G']), { columns: ['A','B','C','D','E'].map(col => ({ col })) }, ['P','T','G']);
  assert.equal(cleaned.blocks[1].align.source_map.length, 2, 'les ordres restent identiques après validation serveur');
});

test('plusieurs comptes vers UN poste : somme du GL, budget conservé une seule fois ; liens absents ou ambigus refusés', async () => {
  const { executeOrders } = await import('../lib/fill-orders.js');
  const ctx = { sheet: 'Budget', u: { columns: ['A','B','D'].map(col => ({ col, header: col, amount: col !== 'A' })), comparisons: [] }, docs: [{ id: 'P', name: 'inconnu' }, { id: 'G', name: 'mal-renommé' }], drive: {} };
  const pieces = { P: { fingerprint: 'p', sheets: [{ name: 'Prévisions', rows: [{ n: 1, v: ['Poste','Initial'] }, { n: 2, v: ['Déplacements',1000] }, { n: 3, v: ['Autre',200] }] }] },
    G: { fingerprint: 'g', sheets: [{ name: 'GL', rows: [{ n: 1, v: ['Compte','Montant'] }, { n: 2, v: ['625100',300] }, { n: 3, v: ['625200',400] }] }] } };
  const raw = { blocks: [
    { document_id: 'P', sheet: 'Prévisions', rows: { from: 2 }, columns: [{ target: 'A', source: 'A' }, { target: 'B', source: 'B' }] },
    { document_id: 'G', sheet: 'GL', rows: { from: 2 }, align: { target: 'A', source: 'A', source_map: [{ from: '625100', to: 'Déplacements', why: 'transport' }, { from: '625200', to: 'Déplacements', why: 'hébergement' }] }, sum_duplicates: true, columns: [{ target: 'D', source: 'B' }] }
  ] };
  const run = r => executeOrders(ctx, cleanOrders(r, ctx.u, ['P','G']), { readPiece: async doc => pieces[doc.id] });
  const ok = await run(raw); assert.deepEqual(ok.rows, [['Déplacements',1000,700], ['Autre',200,null]]);
  raw.blocks[1].align.source_map.push({ from: '625100', to: 'Autre', why: 'autre possibilité' });
  const ambiguous = await run(raw); assert.equal(ambiguous.rows[0][2], 400); assert.equal(ambiguous.rows[1][2], null); assert.match(ambiguous.report.problems.join(' '), /ambiguë/);
  raw.blocks[1].align.source_map = [{ from: '999999', to: 'Déplacements', why: 'inventé' }];
  const missing = await run(raw); assert.ok(missing.rows.every(r => r[2] === null)); assert.match(missing.report.problems.join(' '), /non appliquée/);
});

test('GL par sections : l’IA voit les comptes reportés sur les écritures avec leurs vrais numéros de ligne', async () => {
  const { readPiece } = await import('../lib/fill-orders.js');
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Export');
  [['Date','Pièce','Libellé','Débit','Crédit'], ['Compte : 625100 - Transport'], ['2023-01-01','F1','Billet',300,0], ['Total compte',null,null,300,0], ['Compte : 625200 - Hébergement'], ['2023-01-02','F2','Hôtel',400,0]].forEach(r => ws.addRow(r));
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const piece = await readPiece({ id: 'G', name: 'scan.xlsx' }, { getMeta: async () => ({ size: bytes.length }), downloadBuffer: async () => bytes });
  const derived = piece.sheets.find(s => s.derived_from === 'Export');
  assert.ok(derived); assert.deepEqual(derived.rows.slice(1).map(r => r.n), [3,6]);
  assert.ok(derived.rows[1].v.includes('625100')); assert.ok(derived.rows[2].v.includes('625200'));
});
