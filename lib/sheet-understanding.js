// Comprendre une feuille de données du working file, et la remplir avec les bonnes pièces (Paul, 2026-10-25 : « l'agent est censé comprendre
// le working file et comment le remplir ; peu importe la mission et les pièces, il doit comprendre, analyser et remplir parfaitement »).
//
// Une personne remplit D2 en regardant CE QUE LES TESTS FONT de chaque colonne, pas les titres seuls. C'est ce que fait ce module, pour
// n'importe quel working file, sans rien d'écrit en dur pour un modèle :
//   1. COMPRENDRE (code, sans IA) : chaque formule du classeur qui lit la feuille est suivie jusqu'aux tests. Pour chaque colonne : quel test
//      la lit, comment (recopiée, additionnée, comparée, clé de recherche, définit les lignes), avec quelles autres colonnes elle est
//      recalculée ou comparée, et à quelle colonne d'une autre feuille ses valeurs doivent correspondre (PRJ-11 cherche la catégorie de D2
//      dans la colonne « Catégorie budgétaire » du grand livre). Plus les pièces que le fichier demande pour ces tests (liste PBC, matrice).
//   2. ANALYSER (IA, vérifiée par le code) : pour chaque colonne, quel document de la mission contient CETTE information, au même niveau de
//      détail que la feuille, et sous quel titre. Règles du code, quoi que dise l'IA : un document qui n'est pas dans la mission est écarté ;
//      une même colonne d'un document ne remplit jamais deux colonnes que le test recalcule l'une contre l'autre (le test serait juste
//      d'office) ; une colonne sans document reste vide et la pièce manquante est nommée ; ce qu'une personne a confirmé passe d'abord.
//   3. REMPLIR (code) : les tableaux des documents retenus sont lus (un PDF est d'abord transformé en tableau vérifié), alignés ligne à ligne
//      sur la colonne qui définit les lignes (par code, sinon par libellé), et la feuille est remplie par l'import existant (cases de saisie
//      vides seulement, tableau agrandi sur demande, relu, reçu, annulable). Rien n'est écrit sans « Oui, remplis ». La provenance de
//      chaque case est gardée (document, colonne, ligne).
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { mapWorkingFile, testCode, formulaRefs } from './workfile-map.js';
import { proposeColumn, columnConcept, columnRole } from './client-table-understanding.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';

const fail = (code, status = 409, extra = {}) => Object.assign(new Error(code), { statusCode: status, ...extra });
const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const key = v => fold(v).replace(/[^a-z0-9]+/g, '');
const QUOTED = /"(?:[^"]|"")*"/g;
const CROSS = /(?:'((?:[^']|'')+)'|([A-Za-z0-9_.]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;
const colNum = l => String(l).split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLet = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const span = (a, b) => { const out = []; for (let i = Math.min(colNum(a), colNum(b)); i <= Math.max(colNum(a), colNum(b)); i++) out.push(colLet(i)); return out; };
const mainTable = s => (s?.tables || [])[s?.main >= 0 ? s.main : 0] || null;
const isInput = c => ['fact', 'free'].includes(c.role);

// The innermost function around position `at` of a formula (strings blanked), and which argument the position is in.
export function enclosing(formula, at) {
  const f = String(formula).replace(QUOTED, m => '"' + ' '.repeat(m.length - 2) + '"');
  let depth = 0, arg = 0;
  for (let j = at - 1; j >= 0; j--) {
    const ch = f[j];
    if (ch === ')') depth++;
    else if (ch === '(') { if (depth === 0) { const name = (f.slice(0, j).match(/([A-Z][A-Z0-9.]*)\s*$/) || [])[1] || ''; return { name: name.toUpperCase(), arg }; } depth--; }
    else if (ch === ',' && depth === 0) arg++;
  }
  return { name: '', arg: 0 };
}
// How a reference is used, from the function around it.
function useOf(fn) {
  const { name, arg } = fn;
  if (name === 'INDEX' && arg === 0) return 'copy';
  if (name === 'MATCH' && arg === 1) return 'lookup';
  if (name === 'SUMIFS' || name === 'COUNTIFS' || name === 'AVERAGEIFS') return name === 'SUMIFS' && arg === 0 ? 'summed' : arg % 2 === (name === 'SUMIFS' ? 1 : 0) ? 'criteria_range' : 'read';
  if (name === 'SUMIF' || name === 'COUNTIF') return arg === 0 ? 'criteria_range' : name === 'SUMIF' && arg === 2 ? 'summed' : 'read';
  if (['SUM', 'SUMPRODUCT', 'SUBTOTAL', 'AGGREGATE'].includes(name)) return 'summed';
  if (['LEN', 'COUNTA', 'ISBLANK', 'COUNTBLANK'].includes(name)) return 'rows';
  return 'read';
}
// The arguments of the first call of `fn` in a formula, split at depth 0.
function callArgs(formula, fn) {
  const f = String(formula), i = f.toUpperCase().search(new RegExp('\\b' + fn + '\\s*\\('));
  if (i < 0) return null;
  const start = f.indexOf('(', i) + 1, args = [];
  let depth = 0, cur = '', q = false;
  for (let j = start; j < f.length; j++) {
    const ch = f[j];
    if (ch === '"') q = !q;
    if (!q && ch === '(') depth++;
    if (!q && ch === ')') { if (depth === 0) { args.push(cur); return args; } depth--; }
    if (!q && ch === ',' && depth === 0) { args.push(cur); cur = ''; continue; }
    cur += ch;
  }
  return null;
}
// Pairs « left op right » between local columns of one formula (N(D11) read as D11; cross-sheet references left out).
function localOps(formula) {
  const f = String(formula).replace(QUOTED, '""').replace(CROSS, ' X ').replace(/\$/g, '').replace(/\bN\(([A-Z]{1,3}\d+)\)/g, '$1');
  const out = [], re = /([A-Z]{1,3})\d+\s*\)?\s*([-+*\/])\s*\(?\s*(?=([A-Z]{1,3})\d+)/g;
  let m; while ((m = re.exec(f))) out.push({ left: m[1], op: m[2], right: m[3] });
  const sum = /\bSUM\(\s*([A-Z]{1,3})\d+\s*:\s*([A-Z]{1,3})\d+\s*\)/.exec(f);
  if (sum) out.push({ sum: span(sum[1], sum[2]) });
  return out;
}

// 1. Understanding of one data sheet, from the workbook's own formulas.
export function understandSheet(wb, map, sheetName) {
  const s = map.sheets.find(x => x.name === sheetName), t = mainTable(s);
  if (!t) throw fail('SHEET_WITHOUT_TABLE');
  const inputs = t.columns.filter(isInput), inputSet = new Set(inputs.map(c => c.col));
  const cols = Object.fromEntries(inputs.map(c => [c.col, { col: c.col, header: c.header, uses: [], related: [], must_match: [], total: false }]));
  const readers = new Map();
  const note = (test, sheet) => { if (test && !readers.has(test)) readers.set(test, { code: test, sheet }); };
  // a. Every formula of the workbook reading this sheet: which column, how, from which sheet / column.
  const links = [];
  for (const ws of wb.worksheets) {
    if ((ws.state && ws.state !== 'visible' && /list/i.test(ws.name)) || ws.name === sheetName) continue;
    const sm = map.sheets.find(x => x.name === ws.name), st = mainTable(sm), seen = new Set();
    const max = Math.min(ws.rowCount, (st ? st.first_row + 1 : 60), 400);
    for (let r = 1; r <= max; r++) ws.getRow(r).eachCell(cell => {
      const f = cell.value && typeof cell.value === 'object' ? cell.value.formula : null;
      if (!f || !f.includes(sheetName)) return;
      const sig = cell.col + '|' + f.replace(/\d+/g, '#');
      if (seen.has(sig)) return; seen.add(sig);
      const blank = String(f).replace(QUOTED, m => '"' + ' '.repeat(m.length - 2) + '"');
      let m; const re = new RegExp(CROSS.source, 'g');
      while ((m = re.exec(blank))) {
        const name = (m[1] || m[2] || '').replace(/''/g, "'");
        if (name !== sheetName) continue;
        const use = useOf(enclosing(f, m.index));
        const header = st && r > st.header_row ? (st.columns.find(c => c.col === colLet(cell.col))?.header || '') : String(ws.getRow(r).getCell(1).value ?? '');
        for (const col of span(m[3], m[5] || m[3])) if (inputSet.has(col)) links.push({ sheet: ws.name, test: sm?.test_code || testCode(ws.name), at: colLet(cell.col), row: r, header, use, col, formula: f, in_table: !!st && r > st.header_row });
      }
    });
  }
  // b. The sheet's own formulas (« Élig PRJ-03 » = LEN(A)>0: column A decides which rows the test takes; a total row sums D).
  for (const c of t.columns.filter(x => x.kind === 'calc' && x.formula)) {
    const fr = formulaRefs(c.formula);
    for (const r of fr.cols) if (inputSet.has(r.col)) { const test = testCode(c.header); note(test, null); const mm = new RegExp('(^|[^A-Z$])\\$?' + r.col + '\\$?\\d').exec(c.formula), at = mm ? mm.index + mm[1].length : 0; links.push({ sheet: sheetName, test, at: c.col, header: c.header, use: useOf(enclosing(c.formula, Math.max(0, at))), col: r.col, own: true }); }
  }
  const ws = wb.getWorksheet(sheetName);
  for (let r = 1; r < t.header_row; r++) ws.getRow(r).eachCell(cell => {
    const f = cell.value?.formula; if (!f) return;
    const sm = /\bSUM\(\s*(?:[^!]+!)?\$?([A-Z]{1,3})\$?\d+:\$?([A-Z]{1,3})\$?\d+\s*\)/.exec(f);
    if (sm) for (const col of span(sm[1], sm[2])) if (cols[col]) cols[col].total = true;
  });
  // c. Inside each test: copies of our columns, then what is computed from them (sums, differences) and what is matched elsewhere.
  const comparisons = [];
  const bySheet = {};
  for (const l of links.filter(x => !x.own)) (bySheet[l.sheet] ||= []).push(l);
  for (const [sheet, ls] of Object.entries(bySheet)) {
    const sm = map.sheets.find(x => x.name === sheet), st = mainTable(sm);
    const test = sm?.test_code || testCode(sheet);
    note(test, sheet);
    for (const l of ls) cols[l.col].uses.push({ test, sheet, use: l.use, as: l.header || null, in_table: l.in_table });
    if (!st) continue;
    // Our column used as the criteria range of a SUMIFS (the GL's « Catégorie budgétaire », summed for each category of D2): its values must
    // be written like the values the test looks up with.
    for (const l of ls.filter(x => x.use === 'criteria_range' && x.formula)) {
      const fn = /SUMIFS/i.test(l.formula) ? 'SUMIFS' : /COUNTIFS/i.test(l.formula) ? 'COUNTIFS' : null; if (!fn) continue;
      const args = callArgs(l.formula, fn) || [];
      const i = args.findIndex(a => a.includes(sheetName) && new RegExp('!\\$?' + l.col + '\\$?\\d').test(a));
      const crit = i >= 0 ? /^\s*\$?([A-Z]{1,3})\$?\d+\s*$/.exec(args[i + 1] || '') : null;
      const src = crit && st.columns.find(c => c.col === crit[1]);
      for (const r of src?.formula ? formulaRefs(src.formula).sheets : []) {
        if (r.sheet === sheet || r.sheet === sheetName || !/INDEX/i.test(src.formula)) continue;
        const om = mainTable(map.sheets.find(x => x.name === r.sheet)), oh = om?.columns.find(x => x.col === r.from)?.header || r.from;
        if (!cols[l.col].must_match.some(x => x.sheet === r.sheet && x.col === r.from)) cols[l.col].must_match.push({ sheet: r.sheet, col: r.from, header: oh, test, by: l.header });
      }
    }
    const copyOf = {};
    for (const l of ls.filter(x => x.in_table && x.use === 'copy')) (copyOf[l.at] ||= new Set()).add(l.col);
    const byCol = Object.fromEntries(st.columns.map(c => [c.col, c]));
    const memo = {};
    // A computed column depends on the columns of its ARITHMETIC (D + E, F − G, SUM), never on those of its conditions (IF(C="",…)).
    const arith = c => { const f = byCol[c]?.formula; if (!f) return []; const ops = localOps(f); const out = new Set(); for (const o of ops) (o.sum || [o.left, o.right]).forEach(x => out.add(x)); return [...out].filter(x => x !== c && byCol[x]); };
    const anc = (c, seen = new Set()) => {
      if (memo[c]) return memo[c];
      if (copyOf[c]) return (memo[c] = new Set(copyOf[c]));
      if (seen.has(c)) return new Set();
      seen.add(c);
      const out = new Set();
      for (const u of arith(c)) for (const x of anc(u, seen)) out.add(x);
      return (memo[c] = out);
    };
    const via = {};   // data column -> the recomputed test column it is part of
    for (const c of st.columns.filter(x => x.formula)) {
      for (const op of localOps(c.formula)) {
        if (op.sum) { const parts = op.sum.flatMap(x => [...anc(x)]); parts.forEach(p => (via[p] ||= c.header)); continue; }
        const L = [...anc(op.left)], R = [...anc(op.right)];
        if (!L.length || !R.length) continue;
        if (op.op === '+') [...L, ...R].forEach(p => (via[p] ||= c.header));
        if (op.op === '-' && !L.some(x => R.includes(x))) {
          const ecart = /ecart|difference|variance|delta|compar/.test(fold(c.header));
          const left = [...anc(op.left)], right = [...anc(op.right)];
          if (!comparisons.some(k => k.test === test && k.left.join() === left.join() && k.right.join() === right.join())) comparisons.push({ test, sheet, at: c.header, comparison: ecart, left, right });
        }
      }
      // SUMIFS(other!amount, other!category, <copy of our column>): our column's values must be found in that other column.
      const args = callArgs(c.formula, 'SUMIFS') || callArgs(c.formula, 'COUNTIFS');
      if (args) for (let i = /SUMIFS/i.test(c.formula) ? 1 : 0; i + 1 < args.length; i += 2) {
        const range = new RegExp(CROSS.source).exec(args[i]), crit = /^\s*\$?([A-Z]{1,3})\$?\d+\s*$/.exec(args[i + 1]);
        if (!range || !crit || !copyOf[crit[1]]) continue;
        const other = (range[1] || range[2] || '').replace(/''/g, "'"), om = mainTable(map.sheets.find(x => x.name === other));
        const oh = om?.columns.find(x => x.col === range[3])?.header || range[3];
        for (const p of copyOf[crit[1]]) if (!cols[p].must_match.some(x => x.sheet === other && x.col === range[3])) cols[p].must_match.push({ sheet: other, col: range[3], header: oh, test });
      }
    }
    for (const [p, h] of Object.entries(via)) if (cols[p]) cols[p].related.push({ test, recomputed_as: h });
  }
  for (const l of links.filter(x => x.own)) if (l.use === 'rows' && cols[l.col]) cols[l.col].uses.push({ test: l.test, sheet: sheetName, use: 'rows', as: l.header });
  // d. Sentences a person can read, and what each column is for.
  const H = c => '« ' + (cols[c]?.header || c) + ' »';
  for (const c of Object.values(cols)) {
    const says = [];
    for (const k of comparisons.filter(k => k.left.includes(c.col) || k.right.includes(c.col))) {
      const mine = k.left.includes(c.col) ? k.left : k.right, other = k.left.includes(c.col) ? k.right : k.left;
      const rec = c.related.find(r => r.test === k.test)?.recomputed_as;
      says.push(k.test + ' : ' + (mine.length > 1 || rec ? mine.map(H).join(' + ') + (rec ? ' = « ' + rec + ' »' : '') : H(c.col)) + (k.comparison ? ' comparé à ' : ' moins ') + other.map(H).join(' + ') + ' (« ' + k.at + ' »)');
    }
    for (const m of c.must_match) says.push(m.by ? m.test + ' totalise cette feuille par cette colonne (« ' + m.by + ' ») pour chaque « ' + m.header + ' » de ' + m.sheet + ' : écrire les valeurs exactement comme dans ' + m.sheet : m.test + ' cherche chaque valeur dans « ' + m.header + ' » de ' + m.sheet + ' : elles doivent y être écrites pareil');
    if (c.uses.some(u => u.use === 'rows')) says.push('définit les lignes prises par ' + [...new Set(c.uses.filter(u => u.use === 'rows').map(u => u.test).filter(Boolean))].join(', '));
    if (c.total) says.push('additionnée dans le total de la feuille');
    const read = [...new Set(c.uses.map(u => u.test).filter(Boolean))];
    const summedBy = [...new Set(c.uses.filter(u => u.use === 'summed').map(u => u.test).filter(Boolean))];
    if (summedBy.length) says.push('additionnée par ' + summedBy.join(', '));
    for (const tc of read.filter(x => !says.some(y => y.includes(x)))) { const as = c.uses.find(u => u.test === tc && u.as)?.as; says.push('lue par ' + tc + (as && key(as) !== key(c.header) ? ' (« ' + as + ' »)' : '')); }
    if (!read.length && !c.total) says.push('aucun test ne la lit');
    c.says = [...new Set(says)];
    c.key = c.uses.some(u => u.use === 'rows' || u.use === 'lookup') || c.must_match.length > 0 || columnConcept(c.header) === 'label' || columnConcept(c.header) === 'code';
    c.amount = !c.key && (c.total || c.related.length > 0 || comparisons.some(k => k.left.includes(c.col) || k.right.includes(c.col)) || c.uses.some(u => u.use === 'summed'));
    c.read_by = read;
  }
  // e. The tests that read the sheet, what they say they do, and the pieces the file asks for them.
  const testsInfo = [...readers.values()].filter(r => r.code).map(r => {
    const tm = map.tests.find(x => x.code === r.code), tsheet = map.sheets.find(x => x.name === (tm?.sheet || r.sheet));
    return { code: r.code, sheet: tm?.sheet || r.sheet, title: tsheet?.title || null, how: (tsheet?.instructions || []).map(i => i.text).slice(0, 3), pieces: [...(tm?.pbc_required || []), ...(tm?.pbc_optional || [])] };
  });
  const wanted = new Set(testsInfo.flatMap(x => x.pieces));
  const pieces = (map.pbc?.items || []).filter(p => wanted.has(String(p.id))).map(p => ({ id: String(p.id), name: p.name, type: p.type || null, for_tests: testsInfo.filter(x => x.pieces.includes(String(p.id))).map(x => x.code) }));
  const rows_from = Object.values(cols).find(c => c.uses.some(u => u.use === 'rows'))?.col || Object.values(cols).find(c => c.key)?.col || inputs[0]?.col;
  return { sheet: sheetName, title: s.title || null, instructions: (s.instructions || []).map(i => i.text).slice(0, 4), header_row: t.header_row, first_row: t.first_row, last_row: t.last_row,
    columns: inputs.map(c => cols[c.col]), comparisons, tests: testsInfo, pieces, rows_from };
}

// The compared sides of each test, as pairs of columns that must never be filled from the SAME column of the same document.
export function forbiddenPairs(u) {
  const out = [];
  for (const k of u.comparisons) for (const a of k.left) for (const b of k.right) out.push([a, b, k]);
  return out;
}

// 2. Code rules applied to any assignment (from the AI, from memory or from a person): nothing outside the mission, nothing that makes a
//    test right by construction, an amount from amounts.
export function checkAssignments(u, assignments, docs) {
  const known = new Map(docs.map(x => [x.id, x]));
  const out = u.columns.map(c => {
    const a = assignments.find(x => x.col === c.col) || null;
    if (!a || !a.document_id) return { col: c.col, header: c.header, document_id: null, heading: null, status: 'missing', why: a?.why || null, missing: a?.missing || null, by: a?.by || null };
    if (!known.has(a.document_id)) return { col: c.col, header: c.header, document_id: null, heading: null, status: 'missing', why: 'document inconnu dans la mission (écarté)', missing: a.missing || null, by: a.by };
    return { col: c.col, header: c.header, document_id: a.document_id, document: known.get(a.document_id).name, heading: a.heading || null, status: a.by === 'personne' || a.by === 'confirmé' ? 'sure' : (a.sure === false ? 'to_confirm' : 'sure'), why: a.why || null, by: a.by || 'ia', missing: null };
  });
  return enforce(u, out);
}

export function enforce(u, out) {
  // Same document AND same heading on both sides of a recomputation: the test would pass whatever the truth. The side with ONE column (the
  // amount the others are compared to) keeps it; the other side is emptied, with the reason.
  for (const [a, b, k] of forbiddenPairs(u)) {
    const A = out.find(x => x.col === a), B = out.find(x => x.col === b);
    if (!A?.document_id || !B?.document_id || A.document_id !== B.document_id || key(A.heading) !== key(B.heading) || !A.heading) continue;
    const drop = k.left.length >= k.right.length ? (k.left.includes(a) ? A : B) : (k.left.includes(a) ? B : A);
    const keep = drop === A ? B : A;
    Object.assign(drop, { document_id: null, document: null, heading: null, status: 'missing', by: 'règle', why: 'même colonne du même document que « ' + keep.header + ' » : ' + k.test + ' recalcule l’une contre l’autre, le test serait juste d’office. Cette valeur doit venir de sa propre source.' });
  }
  return out;
}

// One amount from a grand livre's « Débit » and « Crédit » (« Montant » = Débit − Crédit), said in the heading, never hidden.
export const NET = ' − ';
function netPair(header, heads, wanted) {
  if (columnRole(header) !== 'amount') return null;
  const deb = heads.findIndex(h => columnRole(h) === 'debit'), cre = heads.findIndex(h => columnRole(h) === 'credit');
  if (deb < 0 || cre < 0) return null;
  const name = heads[deb] + NET + heads[cre];
  return !wanted || key(wanted) === key(name) || /debit.*credit/.test(key(wanted)) ? { i: deb, minus: cre, heading: name } : null;
}
const numberOf = v => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; const n = Number(String(v).replace(/\s/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

// What a heading is ABOUT (the rows' unit): a category, an activity, an account… « Libellé », « Désignation » say nothing and fit anything.
const NOUNS = [['categorie', /categorie|rubrique|ligne budgetaire|poste budgetaire/], ['activite', /activite|action|tache/], ['compte', /compte|account/], ['projet', /projet|sous projet|composante/],
  ['tiers', /fournisseur|beneficiaire|tiers|client|bailleur|donateur/], ['personne', /employe|salarie|agent|personnel/], ['bien', /immobilisation|bien|article|produit|stock/], ['banque', /banque|caisse|tresorerie/], ['periode', /mois|trimestre|periode|^t[1-4]$/]];
const nounOf = h => (NOUNS.find(([, re]) => re.test(fold(h))) || [null])[0];
export function meaningDoubt(header, heading, u) {
  const dc = columnConcept(header), sc = columnConcept(heading), dn = nounOf(header), sn = nounOf(heading);
  if (dn && sn && dn !== sn) return 'la pièce est par « ' + heading + ' », la feuille par « ' + header + ' » : pas le même niveau de détail' + (u?.title ? ' (' + u.title + ')' : '');
  if (dc && sc && dc !== sc && !(['label', 'code'].includes(dc) && ['label', 'code'].includes(sc))) return '« ' + heading + ' » ne veut pas dire la même chose que « ' + header + ' »';
  if (dc && !sc && !['label', 'code'].includes(dc)) return 'le titre « ' + heading + ' » ne dit pas que c’est ' + ({ budget: 'un budget', committed: 'des engagements', disbursed: 'des décaissements', realised: 'du réalisé', available: 'un disponible', amendment: 'des amendements', rate: 'un taux' }[dc] || 'la même chose');
  return null;
}

// 3. Rows of several tables put side by side on the key column (code first, then label), total lines left out.
const TOTAL = /^(sous[- ]?)?totaux?\b|^total\b|^report\b|^a reporter|^cumul\b|^ensemble\b/;
export function alignRows(driver, others) {
  const keyCols = t => t.headers.map((h, i) => ({ i, c: columnConcept(h) })).filter(x => x.c === 'code' || x.c === 'label');
  const rowKey = (t, row) => keyCols(t).map(x => ({ c: x.c, v: key(row[x.i]) })).filter(x => x.v);
  const rows = driver.rows.filter(r => r.some(v => v != null && v !== '') && !r.some(v => typeof v === 'string' && TOTAL.test(fold(v))));
  const unmatched = {};
  const joined = rows.map(r => {
    const k = rowKey(driver, r), out = { row: r, from: {} };
    for (const o of others) {
      const ok = o.rows.filter(x => !x.some(v => typeof v === 'string' && TOTAL.test(fold(v))));
      let hit = null;
      for (const c of ['code', 'label']) {
        const mine = k.find(x => x.c === c); if (!mine) continue;
        const found = ok.filter(x => rowKey(o, x).some(y => y.c === c && y.v === mine.v));
        if (found.length === 1) { hit = found[0]; break; }
      }
      if (hit) out.from[o.id] = hit; else (unmatched[o.id] ||= []).push(r.slice(0, 3).filter(v => v != null).join(' · '));
    }
    return out;
  });
  return { joined, unmatched };
}

// ———— The actions ————

const ASSIGN = `Tu es l'Enhanced Auditor d'un cabinet d'audit. Une feuille de données d'un working file doit être remplie. Le code a déjà compris
la feuille en suivant ses formules : pour chaque colonne tu as ce que les tests en font (recalculée, comparée, clé de recherche, lignes,
total) et les pièces que le working file demande pour ces tests. Tu as aussi les documents de la mission (ce que chacun EST, d'après sa
lecture) et ce qu'une personne a déjà dit.
Pour CHAQUE colonne, dis quel document de la mission contient CETTE information, au MÊME niveau de détail que la feuille (par catégorie si
la feuille est par catégorie : un plan de travail par activité n'est pas un budget par catégorie), et sous quel titre de colonne si tu le
vois. Règles :
- Une colonne recalculée et la colonne à laquelle elle est comparée ne viennent JAMAIS de la même colonne d'un document : sinon le test est
  juste d'office. Le budget initial vient de la convention ou du premier budget, les amendements des avenants / no-objections, le budget
  final du dernier budget approuvé ou du tableau d'exécution.
- Une colonne pour laquelle aucun document ne convient reste vide : "document_id": null et "missing" = la pièce à demander (nom court).
- Si la personne a désigné un document pour cette feuille, utilise-le pour les colonnes qu'il contient vraiment, pas pour les autres.
- N'invente aucun document ni aucun titre.
JSON STRICT : {"columns":[{"col":"A","document_id":"…|null","heading":"titre de la colonne dans le document|null","sure":true,"why":"…","missing":"…|null"}],"summary":"…"}`;

async function loadContext(org, mission, code, body, account, d) {
  const { procedureView } = await import('./procedure-work.js');
  const view = await (d.view || procedureView)(org, mission, code, account, d);
  if (!view.workpaper?.file_id) throw fail('NO_WORKPAPER_FOR_CYCLE');
  const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await drive.downloadBuffer(view.workpaper.file_id)));
  const map = mapWorkingFile(wb);
  const sheet = String(body.sheet || '');
  if (!map.sheets.some(x => x.name === sheet && x.role === 'data')) throw fail('DATA_SHEET_REQUIRED');
  const u = understandSheet(wb, map, sheet);
  const memory = await (d.missionMemory || (async () => (await import('./mission-files.js')).missionMemory(mission, d)))().catch(() => []);
  const sources = await (d.sources || (await import('./step-runner.js')).stepSources)(org, mission, { ...d, strictSources: false }).catch(() => []);
  // The mission's documents: what the memory knows of them, and the files the procedure can read (the working file itself left out).
  const docs = [];
  for (const s of sources) if (s.file_id !== view.workpaper.file_id && !/^~\$/.test(s.name || '')) docs.push({ id: s.file_id, name: s.name, is: s.document || null });
  for (const m of memory) {
    const x = docs.find(y => y.id === m.id);
    const extra = { is: m.title || m.type || null, period: m.period || null, summary: (m.summary || '').slice(0, 260) || null, uses: m.uses || [], history: m.history || [] };
    if (x) Object.assign(x, Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null && v !== ''))); else if (m.read && m.name && m.id !== view.workpaper.file_id) docs.push({ id: m.id, name: m.name, ...extra });
  }
  return { view, drive, wb, map, sheet, u, memory, docs };
}
const isPdf = n => /\.pdf$/i.test(n || ''), isSheet = n => /\.(xlsx|xls|csv)$/i.test(n || '');
const extractOf = (docs, pdfId) => docs.find(x => (x.uses || []).some(y => y.what === 'extrait_de' && y.where === pdfId && y.method === 'document_columns'));

// What people already settled for this sheet: a column confirmed from a document (mission memory), a document chosen for the sheet.
function settled(sheet, docs) {
  const cols = {}, chosen = [];
  for (const x of docs) for (const y of x.uses || []) {
    if (y.what === 'colonne' && String(y.where || '').startsWith(sheet + '!') && y.active !== false) cols[String(y.where).split('!')[1]] = { document_id: x.id, heading: y.heading || null, by: 'confirmé', why: 'confirmé par ' + (y.by || 'une personne') };
    if (y.what === 'feuille' && y.where === sheet && y.active !== false) chosen.push(x.id);
  }
  return { cols, chosen };
}

export async function sheetPlan(org, mission, code, body = {}, account, d = {}) {
  const ctx = await loadContext(org, mission, code, body, account, d);
  const { u, docs, sheet } = ctx;
  const { cols: confirmed, chosen } = settled(sheet, docs);
  // The person's current choices on the screen (a column moved to another document, or left empty on purpose) come before everything.
  for (const c of Array.isArray(body.columns) ? body.columns.slice(0, 100) : []) confirmed[String(c.col)] = { document_id: c.document_id ? String(c.document_id) : null, heading: c.heading ? String(c.heading) : null, by: 'personne', why: c.document_id ? 'choisi par vous' : 'laissée vide par vous' };
  let assignments = Object.entries(confirmed).map(([col, a]) => ({ col, ...a }));
  let ai = 'not_needed', summary = null;  // reassigned after the AI's check of the opened tables
  const open = u.columns.filter(c => !confirmed[c.col]);
  if (open.length) {
    try {
      const input = JSON.stringify({
        sheet: { name: sheet, title: u.title, instructions: u.instructions },
        columns: open.map(c => ({ col: c.col, header: c.header, what_the_tests_do: c.says, key: c.key, amount: c.amount })),
        tests: u.tests.map(t => ({ code: t.code, title: t.title, how: t.how })),
        pieces_the_file_asks: u.pieces,
        chosen_by_a_person_for_this_sheet: chosen,
        already_confirmed: assignments.map(a => ({ col: a.col, document_id: a.document_id, heading: a.heading })),
        documents: docs.slice(0, 120).map(x => ({ id: x.id, name: x.name, is: x.is || null, period: x.period || null, summary: x.summary || null, format: isPdf(x.name) ? 'pdf' : isSheet(x.name) ? 'tableur' : 'autre',
          extract_of_pdf: (x.uses || []).find(y => y.what === 'extrait_de')?.where || null, refused_for_this_sheet: (x.history || []).some(h => /écarté/.test(h.what || '') && String(h.detail || '').includes(sheet)) }))
      }).slice(0, 60000);
      const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: ASSIGN, input, maxTokens: 3000 });
      const out = parseJsonLoose(r?.text ?? r) || {}; ai = r?.provider || 'ai'; summary = out.summary ? String(out.summary).slice(0, 600) : null;
      for (const c of Array.isArray(out.columns) ? out.columns : []) {
        if (!open.some(o => o.col === c.col)) continue;
        let id = c.document_id ? String(c.document_id) : null;
        // A PDF named by the AI: its verified extract (if made) is the table that will be read.
        if (id && isPdf(docs.find(x => x.id === id)?.name)) { const ex = extractOf(docs, id); if (ex) id = ex.id; }
        assignments.push({ col: c.col, document_id: id, heading: c.heading ? String(c.heading).slice(0, 160) : null, sure: c.sure !== false, why: String(c.why || '').slice(0, 300), missing: c.missing ? String(c.missing).slice(0, 160) : null, by: 'ia' });
      }
    } catch { ai = 'unavailable'; }
  }
  // Without the AI: only what people settled; a document chosen for the sheet is proposed column by column by the code (to confirm).
  if (ai === 'unavailable' && chosen.length) for (const c of open) if (!assignments.some(a => a.col === c.col)) assignments.push({ col: c.col, document_id: chosen[0], heading: null, sure: false, why: 'document choisi pour la feuille ; colonne à vérifier', by: 'code' });
  let plan = checkAssignments(u, assignments, docs);
  // Open the tables of the documents kept and find each column's heading in them (the AI's title if it exists, else the code's reading).
  const tables = await readTables(ctx, plan, body, account, d, org, mission, code);
  for (const p of plan) {
    if (!p.document_id) continue;
    const t = tables[p.document_id];
    if (!t || t.error || !t.headers) { Object.assign(p, { pdf: t?.pdf || null, status: t?.needs_extraction ? 'needs_extraction' : 'unreadable', why: (p.why ? p.why + ' — ' : '') + (t?.needs_extraction ? 'PDF à transformer en tableau' : 'tableau illisible : ' + (t?.error || '?')) }); continue; }
    const heads = t.headers;
    let i = p.heading ? heads.findIndex(h => key(h) === key(p.heading)) : -1;
    const net = i < 0 ? netPair(p.header, heads, p.heading) : null;
    if (net) { Object.assign(p, { heading: net.heading, source_index: net.i, minus_index: net.minus, headings: [...heads, net.heading], why: (p.why ? p.why + ' — ' : '') + 'montant = « ' + heads[net.i] + ' » moins « ' + heads[net.minus] + ' »' }); continue; }
    if (i < 0) { const g = proposeColumn(p.header, heads, t.rows); if (g.source != null) { i = g.source; if (!p.heading) p.why = (p.why ? p.why + ' — ' : '') + g.why; if (!g.sure) p.status = 'to_confirm'; } }
    if (i < 0) { Object.assign(p, { status: 'heading_to_choose', heading: null, headings: heads }); continue; }
    p.heading = heads[i]; p.source_index = i; p.headings = [...heads, ...(netPair(p.header, heads) ? [netPair(p.header, heads).heading] : [])];
    // An amount column filled from text, or a key from amounts: the code refuses (the person can choose another heading).
    const vals = t.rows.slice(0, 40).map(r => r[i]).filter(v => v != null && v !== '');
    const nums = vals.filter(v => typeof v === 'number' || /^\s*-?[\d\s.,]+\s*$/.test(String(v))).length;
    const col = u.columns.find(c => c.col === p.col);
    if (col.amount && vals.length && nums / vals.length < 0.6) Object.assign(p, { status: 'heading_to_choose', why: '« ' + heads[i] + ' » ne contient pas des montants' });
    // Same meaning, same level of detail — checked by the code whatever the AI said (a PTBA « Activité » is not a « Catégorie budgétaire »,
    // « T1 » is not « Engagements »).
    const doubt = meaningDoubt(p.header, heads[i], u);
    if (doubt && p.status !== 'heading_to_choose') Object.assign(p, { status: 'to_confirm', why: (p.why ? p.why + ' — ' : '') + doubt });
  }
  enforce(u, plan);
  // A document whose ROWS are not at the sheet's level (its key column doubted) cannot be trusted for the other columns either.
  for (const k of plan.filter(x => x.status === 'to_confirm' && /niveau de détail/.test(x.why || '') && u.columns.find(c => c.col === x.col)?.key))
    for (const o of plan.filter(x => x.document_id === k.document_id && x.col !== k.col && x.status === 'sure')) Object.assign(o, { status: 'to_confirm', why: (o.why ? o.why + ' — ' : '') + 'les lignes de cette pièce ne sont pas au niveau de la feuille (voir « ' + k.header + ' »)' });
  // A column left empty: the piece the working file names for it (its PBC list), so the person knows what to ask for.
  for (const x of plan.filter(y => !y.document_id && !y.missing)) {
    const w = t => fold(t).split(/[^a-z0-9]+/).filter(v => v.length > 3).map(v => v.slice(0, 6));
    const hw = w(x.header), best = u.pieces.map(pc => ({ pc, n: w(pc.name).filter(v => hw.includes(v)).length })).sort((a, b) => b.n - a.n)[0];
    if (best?.n) x.missing = best.pc.id + ' — ' + best.pc.name;
  }
  // A key the tests look up in another sheet (D2's category in the GL's category): the document's code or label whose values are found
  // there is the one to write. Checked on what the other sheet already holds; said when it is still empty.
  for (const p of plan.filter(x => x.document_id && x.source_index != null)) {
    const c = u.columns.find(x => x.col === p.col), t = tables[p.document_id];
    for (const m of c.must_match) {
      const other = ctx.wb.getWorksheet(m.sheet), om = mainTable(ctx.map.sheets.find(x => x.name === m.sheet));
      const have = new Set(); if (other && om) for (let r = om.first_row; r <= om.last_row; r++) { const v = other.getCell(m.col + r).value; const k = key(v?.result ?? v); if (k) have.add(k); }
      if (!have.size) { p.why = (p.why ? p.why + ' — ' : '') + m.sheet + ' encore vide : les valeurs devront y être écrites pareil (« ' + m.header + ' »)'; continue; }
      const share = i => { const vs = t.rows.filter(r => !r.some(v => typeof v === 'string' && TOTAL.test(fold(v)))).map(r => key(r[i])).filter(Boolean); return vs.length ? vs.filter(v => have.has(v)).length / vs.length : 0; };
      const cands = t.headers.map((h, i) => ({ h, i, s: share(i) })).filter(x => ['code', 'label'].includes(columnConcept(x.h)) || x.i === p.source_index).sort((a, b) => b.s - a.s);
      const best = cands[0];
      if (best && best.i !== p.source_index && best.s > share(p.source_index)) Object.assign(p, { source_index: best.i, heading: best.h, why: '« ' + best.h + ' » : ' + Math.round(100 * best.s) + ' % des valeurs retrouvées dans « ' + m.header + ' » de ' + m.sheet });
      else p.why = (p.why ? p.why + ' — ' : '') + Math.round(100 * share(p.source_index)) + ' % des valeurs retrouvées dans « ' + m.header + ' » de ' + m.sheet;
      if ((best?.s || 0) < 0.8) p.status = 'to_confirm';
    }
  }
  // (Paul, 2026-10-25 : « on doit utiliser l'IA pour avoir les choses justes, elle est centrale ») The AI now SEES the opened tables (titles
  // and first rows) next to what the tests do with each column, and checks the whole plan: it confirms, corrects the heading, or empties a
  // column — with its reason. The code keeps only the hard rules (document of the mission, real heading, never the same column on both sides).
  const check = await verifyWithAi(u, plan, tables, d).catch(() => null);
  if (check) { ai = ai === 'not_needed' ? check.provider : ai; if (check.summary) summary = summary ? summary + ' — ' + check.summary : check.summary; }
  enforce(u, plan);
  const preview = await buildCombined(ctx, plan, tables);
  return { sheet, understanding: publicUnderstanding(u), plan: plan.map(publicPlan), ai, summary, preview: { ...preview.public, capacity: Math.max(0, u.last_row - u.first_row + 1) },
    documents: docs.filter(x => isSheet(x.name) || isPdf(x.name)).slice(0, 150).map(x => ({ id: x.id, name: x.name, is: x.is || null })), missing: plan.filter(p => !p.document_id).map(p => ({ col: p.col, header: p.header, piece: p.missing || null, why: p.why || null })) };
}

async function readTables(ctx, plan, body, account, d, org, mission, code) {
  const out = {}, ids = [...new Set(plan.map(p => p.document_id).filter(Boolean))];
  const { clientTable, tableImportOptions } = await import('./workfile-table-import.js');
  let extractions = 0;
  for (const id of ids) {
    const doc = ctx.docs.find(x => x.id === id);
    try {
      if (isPdf(doc?.name)) {
        const ex = extractOf(ctx.docs, id);
        if (ex) { out[id] = await tableOf(ex.id, 'TABLEAU'); out[id].via = ex.id; continue; }
        // A PDF is turned into a verified table only on request (one long AI reading per PDF: never several hidden in one call).
        if (body.extract !== id || extractions >= 1) { out[id] = { needs_extraction: true, pdf: id }; continue; }
        extractions++;
        const r = await (d.extractPdf || (await import('./workfile-sources.js')).extractPdfTable)(org, mission, code, { sheet: ctx.sheet, file_id: id }, account, d);
        out[id] = await tableOf(r.file_id, 'TABLEAU'); out[id].via = r.file_id;
        continue;
      }
      if (!isSheet(doc?.name)) { out[id] = { error: 'format non tabulaire' }; continue; }
      out[id] = await tableOf(id, null);
    } catch (e) { out[id] = { error: String(e.message || e).slice(0, 80) }; }
  }
  return out;
  async function tableOf(fileId, sheet) {
    const read = d.readTable || clientTable;
    let t;
    try { t = await read(fileId, ctx.drive, sheet); }
    catch (e) {
      if (!/SOURCE_SHEET_REQUIRED/.test(e.message)) throw e;
      // Several sheets: the one whose columns best answer the plan's headings.
      const o = await (d.options || tableImportOptions)(org, mission, code, { sheet: ctx.sheet, source_file_id: fileId }, account, d);
      const best = (o.sheets || []).map(s => ({ s, n: plan.filter(p => p.document_id === fileId && p.heading && (s.headers || []).some(h => key(h) === key(p.heading))).length + (s.headers || []).filter(Boolean).length / 100 })).sort((a, b) => b.n - a.n)[0];
      if (!best) throw e;
      t = await read(fileId, ctx.drive, best.s.name);
    }
    return { id: fileId, sheet: t.meta?.source_sheet || sheet, name: t.meta?.name, headers: (t.rows[t.header_row] || []).map(v => String(v ?? '').trim()), rows: t.rows.slice(t.header_row + 1).filter(r => r && r.some(v => v != null && v !== '')), first: t.header_row + 2, fingerprint: t.meta?.fingerprint || null, modified: t.meta?.modifiedTime || null };
  }
}

// The table the import writes: one column per column of the sheet (titles = the sheet's titles), rows from the document that defines the
// rows, the other documents aligned on them. Each cell keeps where it comes from.
async function buildCombined(ctx, plan, tables) {
  const { u } = ctx;
  const filled = plan.filter(p => p.document_id && p.source_index != null && tables[p.document_id]?.headers && !tables[p.document_id].error);
  if (!filled.length) return { public: { rows: 0, columns: [], unmatched: {}, sample: [] }, table: null };
  const drv = filled.find(p => p.col === u.rows_from)?.document_id || filled.find(p => u.columns.find(c => c.col === p.col)?.key)?.document_id || filled[0].document_id;
  const driver = { ...tables[drv], id: drv }, others = [...new Set(filled.map(p => p.document_id))].filter(x => x !== drv).map(x => ({ ...tables[x], id: x }));
  const { joined, unmatched } = alignRows(driver, others);
  const headers = u.columns.map(c => c.header || c.col);
  const rows = [], provenance = [];
  for (const j of joined) {
    const row = [], prov = [];
    for (const c of u.columns) {
      const p = filled.find(x => x.col === c.col);
      const src = !p ? null : p.document_id === drv ? j.row : j.from[p.document_id];
      if (src && p.minus_index != null) { const a = numberOf(src[p.source_index]), b = numberOf(src[p.minus_index]); row.push(a == null || b == null ? null : Math.round((a - b) * 100) / 100); }
      else row.push(src ? (src[p.source_index] ?? null) : null);
      const t = p ? tables[p.document_id] : null;
      prov.push(src && t ? { file_id: t.via || p.document_id, name: t.name, heading: p.heading, line: t.rows.indexOf(src) + t.first } : null);
    }
    if (row.some(v => v != null && v !== '')) { rows.push(row); provenance.push(prov); }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([filled.map(p => [p.col, p.document_id, p.heading]), Object.values(tables).map(t => t.fingerprint || t.modified || null)])).digest('hex');
  const table = { meta: { id: driver.via || drv, name: 'Pièces de la mission → ' + ctx.sheet, source_sheet: null, modifiedTime: null, fingerprint }, rows: [headers, ...rows], header_row: 0, provenance };
  const names = Object.fromEntries(Object.keys(unmatched).map(k => [tables[k]?.name || k, unmatched[k].slice(0, 8)]));
  return { public: { rows: rows.length, columns: headers, sample: rows.slice(0, 6), unmatched: names, rows_from: tables[drv]?.name || null }, table, driver: driver.via || drv };
}

const VERIFY = `Tu es l'Enhanced Auditor. Tu vérifies le plan de remplissage d'une feuille de données d'un working file, colonne par colonne,
comme un auditeur expérimenté qui regarde les deux tableaux. Pour chaque colonne tu as : ce que les tests du fichier en font, le document
et la colonne proposés, les doutes du code, et les vrais titres et premières lignes de chaque document ouvert.
Pour chaque colonne réponds : "ok" (le plan est juste ; si le code doutait, dis pourquoi c'est juste quand même), "heading" (une autre
colonne du MÊME document convient mieux : donne son titre exact), "empty" (aucune colonne de ces documents ne contient cette information
au bon niveau de détail : dis quelle pièce demander), ou "doubt" (tu ne peux pas trancher : la question à poser à l'auditeur).
Une colonne recalculée et celle à laquelle elle est comparée ne viennent jamais de la même colonne d'un document. N'invente aucun titre.
JSON STRICT : {"columns":[{"col":"A","verdict":"ok|heading|empty|doubt","heading":null,"why":"…","missing":null,"question":null}],"summary":"…"}`;
export async function verifyWithAi(u, plan, tables, d = {}) {
  const used = [...new Set(plan.map(p => p.document_id).filter(id => id && tables[id]?.headers))];
  if (!used.length) return null;
  const input = JSON.stringify({
    sheet: { name: u.sheet, title: u.title, instructions: u.instructions },
    columns: plan.map(p => ({ col: p.col, header: p.header, what_the_tests_do: u.columns.find(c => c.col === p.col)?.says || [], document_id: p.document_id, heading: p.heading, status: p.status, code_doubt: p.status === 'to_confirm' || p.status === 'heading_to_choose' ? p.why : null })),
    documents: used.map(id => ({ document_id: id, name: tables[id].name, headings: tables[id].headers, first_rows: tables[id].rows.slice(0, 6).map(r => r.slice(0, 20)) })),
  }).slice(0, 40000);
  const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: VERIFY, input, maxTokens: 2500 });
  const out = parseJsonLoose(r?.text ?? r) || {};
  for (const v of Array.isArray(out.columns) ? out.columns : []) {
    const p = plan.find(x => x.col === v.col); if (!p) continue;
    const why = String(v.why || '').slice(0, 300);
    if (v.verdict === 'ok' && p.document_id && p.heading) Object.assign(p, { status: p.by === 'règle' ? p.status : 'sure', why: (p.why ? p.why + ' — ' : '') + 'vérifié par l’IA' + (why ? ' : ' + why : '') });
    else if (v.verdict === 'heading' && p.document_id && tables[p.document_id]?.headers) {
      const t = tables[p.document_id], i = t.headers.findIndex(h => key(h) === key(v.heading));
      if (i >= 0) Object.assign(p, { heading: t.headers[i], source_index: i, minus_index: undefined, status: 'sure', why: 'corrigé par l’IA : « ' + t.headers[i] + ' »' + (why ? ' — ' + why : '') });
      else p.why = (p.why ? p.why + ' — ' : '') + 'l’IA propose « ' + String(v.heading || '').slice(0, 80) + ' », absent du document (ignoré)';
    } else if (v.verdict === 'empty') Object.assign(p, { document_id: null, document: null, heading: null, source_index: undefined, status: 'missing', by: 'ia', why: 'selon l’IA' + (why ? ' : ' + why : ''), missing: v.missing ? String(v.missing).slice(0, 160) : p.missing || null });
    else if (v.verdict === 'doubt') Object.assign(p, { status: p.document_id ? 'to_confirm' : p.status, why: (p.why ? p.why + ' — ' : '') + 'question de l’IA : ' + String(v.question || why).slice(0, 300) });
  }
  return { provider: r?.provider || 'ai', summary: out.summary ? String(out.summary).slice(0, 400) : null };
}

const publicUnderstanding = u => ({ sheet: u.sheet, title: u.title, instructions: u.instructions, tests: u.tests.map(t => ({ code: t.code, title: t.title })), pieces: u.pieces,
  columns: u.columns.map(c => ({ col: c.col, header: c.header, says: c.says, key: c.key, amount: c.amount, must_match: c.must_match })), comparisons: u.comparisons.map(k => ({ test: k.test, at: k.at, left: k.left, right: k.right })) });
const publicPlan = p => ({ pdf: p.pdf || null, col: p.col, header: p.header, document_id: p.document_id, document: p.document || null, heading: p.heading || null, headings: p.headings || null, status: p.status, why: p.why || null, missing: p.missing || null, by: p.by || null });

// « Oui, remplis » (with the person's changes): the plan is rebuilt by the server from the person's choices, the code rules applied again,
// then written by the existing import (same checks, receipt, undo). Each confirmed column is remembered in the mission's memory.
export async function acceptSheetPlan(org, mission, code, body = {}, account, d = {}) {
  if (!account?.email) throw fail('HUMAN_IDENTITY_REQUIRED');
  const ctx = await loadContext(org, mission, code, body, account, d);
  const choices = Array.isArray(body.columns) ? body.columns.slice(0, 100) : [];
  if (!choices.length) throw fail('COLUMN_MAPPING_REQUIRED', 400);
  const assignments = choices.map(c => ({ col: String(c.col), document_id: c.document_id ? String(c.document_id) : null, heading: c.heading ? String(c.heading) : null, by: 'personne', why: 'choisi par ' + account.email }));
  const plan = checkAssignments(ctx.u, assignments, ctx.docs);
  const broken = plan.filter(p => p.by === 'règle');
  if (broken.length) throw fail('SAME_SOURCE_ON_BOTH_SIDES', 409, { columns: broken.map(p => ({ col: p.col, why: p.why })) });
  const tables = await readTables(ctx, plan, { extract: false }, account, d, org, mission, code);
  for (const p of plan.filter(x => x.document_id)) {
    const t = tables[p.document_id]; if (!t || t.error || t.needs_extraction) throw fail('SOURCE_TABLE_UNREADABLE', 409, { col: p.col });
    const i = t.headers.findIndex(h => key(h) === key(p.heading)), net = i < 0 ? netPair(p.header, t.headers, p.heading) : null;
    if (i < 0 && !net) throw fail('SOURCE_HEADING_NOT_FOUND', 409, { col: p.col, heading: p.heading });
    if (net) { p.source_index = net.i; p.minus_index = net.minus; } else p.source_index = i;
  }
  const built = await buildCombined(ctx, plan, tables);
  if (!built.table || !built.public.rows) throw fail('POPULATION_EMPTY');
  const cols = ctx.u.columns.map((c, i) => ({ c, i })).filter(({ c }) => plan.find(p => p.col === c.col)?.document_id);
  const readTable = async () => built.table;
  const imp = await import('./workfile-table-import.js');
  const base = { sheet: ctx.sheet, step: Number(body.step) || 1, source_file_id: built.driver, source_sheet: null };
  const dd = { ...d, combined: true, readTable, sources: async () => [{ file_id: built.driver, name: built.table.meta.name }], view: async () => ctx.view };
  const p = await (d.preview || imp.previewTableImport)(org, mission, code, base, account, dd);
  const mapping = cols.map(({ c, i }) => ({ column: colNum(c.col), source: i })).filter(m => p.columns.some(x => x.column === m.column));
  if (!mapping.length) throw fail('COLUMN_MAPPING_REQUIRED');
  const r = await (d.run || imp.runTableImport)(org, mission, code, { ...base, revision: p.revision, mapping, extend: body.extend === true }, account, dd);
  const note = d.noteMissionEvent || (await import('./mission-files.js')).noteMissionEvent;
  for (const pl of plan.filter(x => x.document_id)) {
    await note(org, mission, pl.document_id, { agent: 'enhanced-auditor', what: 'remplit une colonne du working file', detail: ctx.sheet + '!' + pl.col + ' (' + pl.header + ') ← « ' + pl.heading + ' »', by: account.email,
      uses: [{ what: 'colonne', where: ctx.sheet + '!' + pl.col, heading: pl.heading, by: account.email, at: new Date().toISOString(), active: true }] }, d).catch(() => null);
  }
  return { ...r, unmatched: built.public.unmatched, filled: plan.filter(x => x.document_id).map(x => ({ col: x.col, header: x.header, document: x.document, heading: x.heading })), left_empty: plan.filter(x => !x.document_id).map(x => ({ col: x.col, header: x.header })) };
}
