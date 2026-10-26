// Paul, 2026-10-26 : « l'IA devait permettre à l'application de savoir automatiquement ce qu'il faut prendre ; si on change de mission,
// pouvoir trouver ces mêmes documents » ; « si quand on dépose les documents l'IA les connaît tous, aura-t-on ce problème ? » ; « on a
// préféré écrire B1 au lieu de chercher le numéro de compte ou le poste de dépense associé ; et il n'apprend pas ».
// Ce banc vérifie la tuyauterie : la fiche de chaque pièce (mesures du code sur TOUTE la pièce + ce que l'IA en dit), les doutes du code
// (jamais une décision à la place de l'IA), le compte choisi par l'IA par le sens, et la recette apprise sur la mission A puis réutilisée
// sur la mission B (autres noms, autre présentation). L'IA est simulée : la vraie IA n'est PAS essayée ici.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { corpus, auxLedger, ptbaByNature, tebByAccount } from './corpus/pieces.js';
import { workingFile } from './corpus/working-file.js';
import { ensureProfiles, correctProfile, lessonsFor } from '../lib/piece-profile.js';
import { sheetPlan, acceptSheetPlan } from '../lib/sheet-understanding.js';

const pieces = await corpus();
const general = pieces.find(x => /SAGE/.test(x.name));
const wpBase = Buffer.from(await (await workingFile()).xlsx.writeBuffer());
const store = () => { const files = {}; return { files, loadJsonFile: async n => ({ state: files[n] ? JSON.parse(JSON.stringify(files[n])) : null, fileId: files[n] ? n : null }), saveJsonFile: async (n, dr, f, id, st) => { files[n] = JSON.parse(JSON.stringify(st)); } }; };
const isProfile = o => /Pour chaque pièce d'une mission/.test(o.instructions), isAccounts = o => /Voici des libellés de lignes/.test(o.instructions), isVerify = o => /vérifies le plan/.test(o.instructions);

async function xlsx(rows) { const wb = new ExcelJS.Workbook(), s = wb.addWorksheet('S'); rows.forEach(r => s.addRow(r)); return Buffer.from(await wb.xlsx.writeBuffer()); }

test('la fiche est faite sur TOUTE la pièce : l’IA voit les classes de comptes mesurées ; le code SIGNALE un doute, sans décider', async () => {
  const aux = auxLedger('2023'), files = { G: general, X: aux }, saved = [], seen = [];
  const d = { drive: { getMeta: async id => ({ name: files[id].name, size: files[id].buffer.length, modifiedTime: 'v1' }), downloadBuffer: async id => files[id].buffer },
    fetchRows: async () => [{ id: 'M', name: 'Audit projet' }], recordMissionDocuments: async (m, docs) => { saved.push(...docs); }, ...store(),
    // the AI is wrong on the auxiliary ledger (calls it « general »): the code measured only tiers accounts and says so
    ai: async (p, o) => { const inp = JSON.parse(o.input); seen.push(inp); return { provider: 'ia', text: JSON.stringify({ pieces: inp.pieces.map(x => ({ file_id: x.file_id, family: 'grand_livre_general', what: 'grand livre', line_unit: 'une écriture comptable', confidence: 'haute', evidence: 'Date' })) }) }; } };
  const r = await ensureProfiles('O', 'M', [{ id: 'G', name: general.name }, { id: 'X', name: aux.name }], d);
  assert.equal(r.done, 2);
  const g = seen[0].pieces.find(x => x.file_id === 'G').content.sheets[0].shape;
  assert.ok(Object.keys(g.account_classes).length >= 2, 'les classes de comptes de tout le GL sont données à l’IA');
  assert.ok(g.accounts_list.some(a => a.account === '618120' && /Transport/.test(a.title)), 'les comptes et leurs intitulés aussi');
  assert.ok(!r.profiles.G.code_doubt);
  assert.match(r.profiles.X.code_doubt, /tiers/, 'auxiliaire appelé « général » : le code le signale');
  assert.equal(r.profiles.X.family, 'grand_livre_general', 'le code ne change pas la réponse de l’IA : une personne tranche');
  assert.equal(saved.length, 2); assert.equal(saved[0].profile.version, 1);
  // a second call does nothing: the fiches exist for this version of the files
  const again = await ensureProfiles('O', 'M', saved.map(x => ({ id: x.id, name: files[x.id].name, profile: x.profile })), d);
  assert.equal(again.done, 0);
});

test('une correction de l’auditeur reste sur la pièce ET devient une leçon du cabinet donnée à l’IA pour les pièces de même forme', async () => {
  const st = store(), saved = [];
  const memory = [{ id: 'X', name: 'GL AUXIL.xls', profile: { version: 1, family: 'grand_livre_general', signature: { headers: ['date', 'jnl', 'libelle', 'debit', 'credit'], classes: ['4'] } } }];
  const d = { ...st, missionMemory: async () => memory, fetchRows: async () => [{ id: 'M', name: 'm' }], recordMissionDocuments: async (m, docs) => { saved.push(...docs); }, audit: async () => null };
  await correctProfile('O', 'M', { file_id: 'X', family: 'grand_livre_auxiliaire', note: 'GL des fournisseurs' }, { email: 'paul@cabinet' }, d);
  assert.equal(saved[0].profile.family, 'grand_livre_auxiliaire'); assert.equal(saved[0].profile.corrected_by, 'paul@cabinet');
  const lessons = await lessonsFor([{ sheets: [{ headers: ['Date', 'Jnl', 'Libellé', 'Débit', 'Crédit'], shape: { account_classes: { 4: '100 %' } } }] }], st);
  assert.equal(lessons[0].family, 'grand_livre_auxiliaire'); assert.equal(lessons[0].was, 'grand_livre_general');
});

// One mission's context for sheetPlan / acceptSheetPlan.
function missionCtx(files, profiles, extra = {}) {
  let wp = Buffer.from(wpBase), mod = 1;
  const memory = Object.entries(files).map(([id, p]) => ({ id, name: p.name, read: true, uses: [], profile: profiles[id] || null }));
  const view = { editable: true, card: { steps: [{ text: 'x' }] }, workpaper: { file_id: 'WP' }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'PRJ-03' }, mission: { period_label: 'Exercice 2023' } };
  const d = { view: async () => view, missionMemory: async () => memory, sources: async () => memory.map(m => ({ file_id: m.id, name: m.name })), save: async (o, w, c) => Object.assign(view.work, c), audit: async () => null, noteMissionEvent: async () => null,
    drive: { getMeta: async id => (id === 'WP' ? { name: 'WF.xlsx', size: wp.length, modifiedTime: 'v' + mod } : { name: files[id].name, size: files[id].buffer.length, modifiedTime: 'x' }), downloadBuffer: async id => (id === 'WP' ? wp : files[id].buffer), updateBinary: async (id, o) => { wp = o.buffer; mod++; } },
    ...extra };
  return { d, wb: async () => { const b = new ExcelJS.Workbook(); await b.xlsx.load(wp); return b; } };
}
const fiche = (family, columns = [], extra = {}) => ({ version: 1, family, what: family, columns: columns.map(([heading, meaning]) => ({ heading, meaning })), confidence: 'haute', ...extra });

test('le choix de l’IA est CONTRÔLÉ contre les fiches : grand livre pour D3, auxiliaire pour D1 → à confirmer avec la raison, jamais remplacé', async () => {
  const files = { G: general, X: auxLedger('2023') }, profiles = { G: fiche('grand_livre_general'), X: fiche('grand_livre_auxiliaire') };
  const { d } = missionCtx(files, profiles, { ai: async (p, o) => (isVerify(o) || isAccounts(o) ? { text: '{}' } : { provider: 'ia', text: JSON.stringify({ sheet_expects: ['grand_livre_general'], rows_from: { document_id: 'X', which: 'lines' }, columns: JSON.parse(o.input).columns.map(c => ({ col: c.col, document_id: 'X', heading: null })) }) }) });
  const P = await sheetPlan('O', 'M', 'PRJ-03', { sheet: 'D1_GL_PROJET' }, { email: 'p' }, d);
  assert.ok(P.plan.filter(p => p.document_id).every(p => p.document_id === 'X'), 'le choix de l’IA est gardé');
  assert.ok(P.doubts.some(x => /grand_livre_auxiliaire.*attend grand_livre_general/.test(x.why)), JSON.stringify(P.doubts));
  assert.ok(P.plan.filter(p => p.document_id).every(p => p.status !== 'sure'), 'à confirmer');
  assert.equal(P.recognised.fiches.length, 2);
});

test('« B1 » remplacé par le compte que l’IA trouve PAR LE SENS dans le grand livre ; un numéro inventé est écarté', async () => {
  const ptba = { name: 'PTBA projet 2023.xlsx', buffer: await xlsx([['Rubrique', 'Montant'], ['Papier', 200000], ['Encre', 100000], ['Sous-total Petites fournitures de bureau', 300000], ['Billets', 800000], ['Sous-total Missions et voyages', 800000], ['Consultant', 1500000], ['Sous-total Prestations intellectuelles', 1500000], ['TOTAL', 2600000]]) };
  const files = { P: ptba, G: general }, profiles = { P: fiche('budget_previsionnel', [['Rubrique', 'catégorie / activité'], ['Montant', 'montant prévu']]), G: fiche('grand_livre_general') };
  const asked = [];
  const { d } = missionCtx(files, profiles, { ai: async (p, o) => {
    if (isVerify(o)) return { text: '{}' };
    if (isAccounts(o)) { const inp = JSON.parse(o.input); asked.push(inp); const m = { 'petites fournitures de bureau': ['605300'], 'missions et voyages': ['618120'], 'prestations intellectuelles': ['999999'] };
      return { text: JSON.stringify({ lines: inp.lines.map(l => ({ label: l.label, accounts: m[l.label.toLowerCase()] || [], why: 'par le sens' })) }) }; }
    return { provider: 'ia', text: JSON.stringify({ sheet_expects: ['budget_previsionnel', 'execution_budgetaire', 'grand_livre_general'], rows_from: { document_id: 'P', which: 'subtotals' }, gl_document_id: 'G', columns: [{ col: 'A', document_id: 'P', heading: 'Rubrique', account_from_gl: false }, { col: 'B', document_id: 'P', heading: 'Montant' }] }) };
  } });
  const P = await sheetPlan('O', 'M', 'PRJ-03', { sheet: 'D2_BUDGET' }, { email: 'p' }, d);
  assert.ok(asked[0].ledger_accounts.some(a => a.account === '618120' && /Transport/.test(a.title)), 'l’IA voit les comptes du GL avec leurs intitulés');
  const A = P.cells.filter(c => c.address.startsWith('A')).map(c => c.value);
  assert.deepEqual(A, ['605300', '618120', 'Prestations intellectuelles'], 'le numéro inventé (999999) n’existe pas dans le GL : le libellé reste, signalé');
  assert.ok(P.preview.categories.without_account.some(x => /Prestations/.test(x)));
  assert.ok(P.account_map.find(x => /Missions/.test(x.label)).number === '618120');
});

test('mission A validée → recette retenue ; mission B (autres noms, autre présentation, l’IA en panne) : mêmes sortes de pièces retrouvées par leur fiche', async () => {
  const st = store();
  // Mission A
  const A = { T: await tebByAccount(), P: await ptbaByNature(), G: general };
  const pA = { T: fiche('execution_budgetaire', [['Code', 'numéro de compte'], ['Budget révisé', 'budget révisé de l’exercice'], ['Engagement', 'montant engagé']]), P: fiche('budget_previsionnel', [['Désignation', 'catégorie'], ['Montant prévu', 'montant prévu']]), G: fiche('grand_livre_general') };
  const a = missionCtx(A, pA, { ...st, ai: async (p, o) => (isVerify(o) || isAccounts(o) ? { text: '{}' } : { provider: 'ia', text: JSON.stringify({ sheet_expects: ['budget_previsionnel', 'execution_budgetaire', 'grand_livre_general'], rows_from: { document_id: 'P', which: 'subtotals' }, gl_document_id: 'G',
    columns: [{ col: 'A', document_id: 'P', heading: 'Désignation' }, { col: 'B', document_id: 'P', heading: 'Montant prévu' }, { col: 'C', compute: 'D-B' }, { col: 'D', document_id: 'T', heading: 'Budget révisé' }, { col: 'E', document_id: 'T', heading: 'Engagement' }] }) }) });
  const PA = await sheetPlan('O', 'MA', 'PRJ-03', { sheet: 'D2_BUDGET' }, { email: 'p' }, a.d);
  const accA = await acceptSheetPlan('O', 'MA', 'PRJ-03', { sheet: 'D2_BUDGET', rows_from: PA.rows_from, gl_document_id: PA.gl_document_id, account_map: PA.account_map, columns: PA.plan.map(p => ({ col: p.col, document_id: p.document_id, heading: p.heading, compute: p.compute, account_from_gl: p.account_from_gl })) }, { email: 'paul@cabinet' }, a.d);
  assert.equal(accA.learned, true);
  const recipe = Object.values(st.files['OFFICE_MANAGER_FILL_RECIPES.json'].recipes)[0];
  assert.equal(recipe.rows_from.family, 'budget_previsionnel');
  assert.deepEqual(recipe.columns.filter(c => c.family).map(c => [c.col, c.family, c.meaning]), [['A', 'budget_previsionnel', 'catégorie'], ['B', 'budget_previsionnel', 'montant prévu'], ['D', 'execution_budgetaire', 'budget révisé de l’exercice'], ['E', 'execution_budgetaire', 'montant engagé']]);
  assert.ok(!JSON.stringify(recipe).includes('PTBA 2023 approuvé'), 'aucun nom de fichier dans la recette');
  // Mission B : other file names, other presentation (sub-totals ABOVE their lines, other column titles), the AI does not answer
  const B = {
    K: { name: 'Suivi budgetaire fin 2023.xlsx', buffer: await xlsx([['Compte', 'Poste', 'Dotation révisée', 'Montant engagé', 'Payé'], ['605300', 'Fournitures', 320000, 232500, 232500], ['618120', 'Transport', 900000, 805000, 805000], ['632400', 'Honoraires', 1500000, 1200000, 1200000]]) },
    L: { name: 'Budget annuel approuve.xlsx', buffer: await xlsx([['Ligne', 'Prévu'], ['Fournitures non stockables', 300000], ['Papier', 200000], ['Cartouches', 100000], ['Transport des agents en formation', 800000], ['Billets aller', 500000], ['Billets retour', 300000], ['TOTAL', 1100000]]) },
    N: { ...general, name: 'grandlivre_export.xls' } };
  const pB = { K: fiche('execution_budgetaire', [['Compte', 'numéro de compte'], ['Dotation révisée', 'budget révisé de l’exercice'], ['Montant engagé', 'montant engagé']]), L: fiche('budget_previsionnel', [['Ligne', 'catégorie'], ['Prévu', 'montant prévu']]), N: fiche('grand_livre_general') };
  const b = missionCtx(B, pB, { ...st, ai: async () => { throw new Error('AI_DOWN'); } });
  const PB = await sheetPlan('O', 'MB', 'PRJ-03', { sheet: 'D2_BUDGET' }, { email: 'p' }, b.d);
  assert.ok(PB.ai_error);
  const rows = {}; for (const c of PB.cells) { const [, col, r] = c.address.match(/^([A-Z]+)(\d+)$/); (rows[r] ||= {})[col] = c.value; }
  assert.deepEqual(Object.values(rows).map(r => [r.A, r.B, r.C ?? null, r.D ?? null, r.E ?? null]), [['605300', 300000, 20000, 320000, 232500], ['618120', 800000, 100000, 900000, 805000]], JSON.stringify(PB.plan.map(p => [p.col, p.document, p.heading, p.why])));
  assert.ok(PB.plan.filter(p => p.document_id).every(p => /mission précédente/.test(p.why || '')), 'la raison dit que c’est la recette apprise');
  // With the AI answering, it RECEIVES the recipe and the fiches of mission B's pieces
  let payload = null;
  const b2 = missionCtx(B, pB, { ...st, ai: async (p, o) => { if (isVerify(o) || isAccounts(o)) return { text: '{}' }; payload = JSON.parse(o.input); return { text: '{}' }; } });
  await sheetPlan('O', 'MB', 'PRJ-03', { sheet: 'D2_BUDGET' }, { email: 'p' }, b2.d);
  assert.equal(payload.recipe_validated_before.rows_from.family, 'budget_previsionnel');
  assert.deepEqual(payload.documents.map(x => x.fiche?.family).sort(), ['budget_previsionnel', 'execution_budgetaire', 'grand_livre_general']);
});

test('au dépôt dans une mission, chaque pièce reçoit sa fiche avant d’être nommée ; le nom vient de ce qu’elle est', async () => {
  const { startDepositAnalysis, depositStep } = await import('../lib/deposit-analysis.js');
  const mem = { state: null }; let profiled = null, renamedFrom = null;
  const d = { drive: {}, folder: 'mem', fire: async () => true, budgetMs: 5000,
    loadJsonFile: async () => ({ state: mem.state && JSON.parse(JSON.stringify(mem.state)), fileId: 'x' }), saveJsonFile: async (n, dr, f, id, st) => { mem.state = JSON.parse(JSON.stringify(st)); },
    fileForAI: async () => ({ text: 'Date Journal Compte Libellé Débit Crédit' }),
    ai: async () => ({ provider: 't', text: JSON.stringify({ documents: [{ file_id: 'F1', role: 'etat_financier', type: 'État financier' }] }) }),
    engagementMissions: async () => [{ id: 'M1', name: 'Audit projet', phase: 'active' }],
    linkToMissions: async (o, docs) => ({ linked: docs.map(doc => ({ doc, mission: { id: 'M1', name: 'Audit projet' }, dates: {} })), to_attach: [] }),
    applyMissionUpdates: async () => ({ attached: 1, proposals: [] }),
    ensureProfiles: async (o, m, docs) => { profiled = { m, ids: docs.map(x => x.id) }; return { done: 1, left: 0, profiles: { F1: { family: 'grand_livre_general', what: 'Grand livre général 2023', period: '2023', confidence: 'haute' } } }; },
    renamePieces: async (o, st) => { renamedFrom = st.understood.map(u => u.title); return { done: [], unidentified: [] }; },
    prepareMissionFiling: async () => ({ status: 'done', files: [], remaining_ids: [] }), reconcileReceivedDocuments: async () => ({ status: 'done' }) };
  const r = await startDepositAnalysis('O', {}, { purpose: 'pieces', mission_id: 'M1', files: [{ id: 'F1', name: 'export.xlsx' }] }, d);
  let st = await depositStep('O', {}, { id: r.id }, d);
  for (let i = 0; i < 10 && st.status === 'running'; i++) st = await depositStep('O', {}, { id: r.id }, d);
  assert.equal(st.status, 'done', JSON.stringify(st.log));
  assert.deepEqual(profiled, { m: 'M1', ids: ['F1'] });
  assert.deepEqual(renamedFrom, ['Grand livre général'], 'nommé « Grand livre général », pas « État financier »');
  assert.ok(st.log.some(l => /décrite\(s\) en détail/.test(l.m)));
});
