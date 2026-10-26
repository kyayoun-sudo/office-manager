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
import { proposeColumn, columnConcept, columnRole, headerRow, tableRole, combineHeaderRows } from './client-table-understanding.js';
import { flattenLedger } from './ledger-shape.js';
import { tableStructure, describeStructure } from './table-structure.js';
import { fitJson } from './ai-input.js';
import { applyRecipe } from './fill-recipes.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { PROJECT_AUDIT_METHOD } from './filling-methods.js';

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
    if (a?.compute) { const [x, y] = a.compute.split('-'); if (u.columns.some(k => k.col === x) && u.columns.some(k => k.col === y) && x !== c.col && y !== c.col) return { col: c.col, header: c.header, document_id: null, heading: null, compute: a.compute, status: 'sure', by: a.by || 'ia', why: 'calculé : « ' + u.columns.find(k => k.col === x).header + ' » − « ' + u.columns.find(k => k.col === y).header + ' » (méthode du cabinet)' + (a.why ? ' — ' + a.why : '') }; }
    if (!a || !a.document_id) return { col: c.col, header: c.header, document_id: null, heading: null, status: 'missing', why: a?.why || null, missing: a?.missing || null, by: a?.by || null };
    if (!known.has(a.document_id)) return { col: c.col, header: c.header, document_id: null, heading: null, status: 'missing', why: 'document inconnu dans la mission (écarté)', missing: a.missing || null, by: a.by };
    return { col: c.col, header: c.header, document_id: a.document_id, document: known.get(a.document_id).name, heading: a.heading || null, account_from_gl: a.account_from_gl === true, status: a.by === 'personne' || a.by === 'confirmé' ? 'sure' : (a.sure === false ? 'to_confirm' : 'sure'), why: a.why || null, by: a.by || 'ia', missing: null };
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
const asDate = v => {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5);
  const t = String(v).trim(); let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return new Date(Date.UTC(y, m[2] - 1, +m[1])); }
  return null;
};
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
const TOTAL = /^(sous[- ]?)?(total|totaux)\b|^report\b|^a reporter|^cumul\b|^ensemble\b/;
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
      // Tables that carry the account number found in the grand livre meet on it first (the PTBA's labels, the TEB's codes).
      if (driver.accounts && o.accounts) { const a = r[r.length - 1]; if (a) { const f = ok.filter(x => x[x.length - 1] === a); if (f.length === 1) hit = f[0];
        // several lines of the other table on the SAME account (a TEB in detail): their amounts are added up for this account (Paul, 2026-10-25 :
        // « mettre les montants d'engagement correspondants à ses comptes »)
        else if (f.length > 1) { hit = Object.assign(f[0].map((v, i) => (f.every(x => x[i] == null || x[i] === '' || numberOf(x[i]) != null) && f.some(x => x[i] != null && x[i] !== '') && i !== f[0].length - 1 && columnConcept(o.headers[i]) !== 'code' ? Math.round(f.reduce((t, x) => t + (numberOf(x[i]) || 0), 0) * 100) / 100 : v)), { orig: f[0].orig || f[0], summed: f.length }); } } }
      if (!hit) for (const c of ['code', 'label']) {
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
documents[].fiche = la FICHE de la pièce, faite en lisant TOUTE la pièce : sa famille (grand_livre_general, grand_livre_auxiliaire,
budget_previsionnel, execution_budgetaire, releve_bancaire…), ce qu'elle est, ce qu'est UNE ligne, sa clé, le sens de CHAQUE colonne.
C'est ta référence pour choisir. Une fiche "corrected_by_an_auditor" a été corrigée par un auditeur du cabinet : c'est la vérité. Une fiche
avec "code_doubt" : le code a mesuré quelque chose qui la contredit — tiens-en compte.
"recipe_validated_before" = comment CETTE feuille de CE modèle de working file a été remplie et validée par un auditeur dans une mission
précédente, en familles de pièces et en sens de colonnes (jamais en noms de fichiers) : retrouve parmi les pièces de CETTE mission celles de
la même famille et suis la recette, sauf si les pièces ou l'auditeur disent autre chose (dis-le dans "summary").
"lessons_from_trainers" = ce que des auditeurs t'ont appris en t'entraînant à remplir cette feuille : applique-le.
Donne aussi "sheet_expects" : les familles de pièces que cette feuille attend, d'après ses tests, son titre et ses consignes.
Pour CHAQUE colonne, dis quel document de la mission contient CETTE information, au MÊME niveau de détail que la feuille (par catégorie si
la feuille est par catégorie : un plan de travail par activité n'est pas un budget par catégorie), et sous quel titre de colonne si tu le
vois. Règles :
- Une colonne recalculée et la colonne à laquelle elle est comparée ne viennent JAMAIS de la même colonne d'un document : sinon le test est
  juste d'office. Le budget initial vient de la convention ou du premier budget, les amendements des avenants / no-objections, le budget
  final du dernier budget approuvé ou du tableau d'exécution.
- Juge par le CONTENU de chaque document (content : titres et premières lignes d'un tableur, début du texte d'un PDF), jamais par son
  nom ni par son titre seul. content.sheets[].shape est mesuré par le code : "grand livre (date, compte, débit / crédit)" = c'est un grand
  livre, quel que soit son nom (donne-le en "gl_document_id" s'il sert au numéro de compte) ; "categories_proved_by_sum" = les lignes dont
  le montant est PROUVÉ égal à la somme des lignes qu'elles couvrent (les catégories / sous-totaux du budget) : si la feuille est par
  catégorie, ses lignes sont celles-là ("rows_from.which" = "subtotals"). Un document qui mentionne, approuve ou transmet un budget (lettre d'avis, no-objection, courrier) sans en
  contenir les montants ligne par ligne ne remplit pas une colonne de montants. Un tableau d'exécution budgétaire contient en général,
  par ligne budgétaire, le budget de l'exercice, les engagements, les décaissements et le réalisé.
- Si « auditor_says » est donné, c'est ce que l'auditeur te dit : suis-le.
- Une colonne pour laquelle aucun document ne convient reste vide : "document_id": null et "missing" = la pièce à demander (nom court).
- Si la personne a désigné un document pour cette feuille, utilise-le pour les colonnes qu'il contient vraiment, pas pour les autres.
- N'invente aucun document ni aucun titre.
Opérations possibles (méthode du cabinet) : "compute": "D-B" pour une colonne qui se calcule depuis deux autres colonnes de la feuille
(amendements = budget final − budget initial) ; "account_from_gl": true pour une colonne de catégorie qui doit recevoir le NUMÉRO DE COMPTE
retrouvé en rapprochant le libellé de la ligne des libellés du grand livre (donne alors "gl_document_id") ; "rows_from" dit quel document
donne les LIGNES de la feuille et lesquelles ("lines" = lignes de détail, "subtotals" = les sous-totaux / catégories, "credits" = les
montants au crédit — encaissements — de relevés bancaires ou d'un grand livre, "debits" = les montants au débit, "one_per_document" = une
ligne par document, quand chaque pièce est UNE opération : avis de crédit, reçu, bordereau) ; plusieurs documents possibles dans
"document_ids" (les relevés de chaque mois, tous les avis de crédit).
JSON STRICT : {"sheet_expects":["famille","…"],"rows_from":{"document_id":"…","document_ids":["…"],"which":"lines|subtotals|credits|debits|one_per_document"},"gl_document_id":"…|null","columns":[{"col":"A","document_id":"…|null","heading":"titre de la colonne dans le document|null","compute":null,"account_from_gl":false,"sure":true,"why":"…","missing":"…|null"}],"summary":"…"}`;

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
    const extra = { is: m.title || m.type || null, period: m.period || null, summary: (m.summary || '').slice(0, 260) || null, uses: m.uses || [], history: m.history || [], profile: m.profile || null };
    if (x) Object.assign(x, Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null && v !== ''))); else if (m.read && m.name && m.id !== view.workpaper.file_id) docs.push({ id: m.id, name: m.name, ...extra });
  }
  return { view, drive, wb, map, sheet, u, memory, docs };
}
const isPdf = n => /\.pdf$/i.test(n || ''), isSheet = n => /\.(xlsx|xls|csv)$/i.test(n || '');

// What a document CONTAINS, shown to the AI before it chooses (Paul, 2026-10-25 : « pour lui le budget est la lettre d'avis d'approbation » —
// the AI only had titles). A spreadsheet: its sheets, first rows; a PDF: the beginning of its text (no OCR here: a scan is said to be a scan).
export async function peekDocument(doc, drive, d = {}) {
  const meta = await drive.getMeta(doc.id).catch(() => null);
  if (!meta || meta.trashed || Number(meta.size || 0) > 40 * 1024 * 1024) return { unreadable: meta ? 'plus de 40 Mo : à extraire en morceaux' : 'absent' };
  const bytes = Buffer.from(await drive.downloadBuffer(doc.id));
  if (isPdf(doc.name)) {
    const r = await (d.pdfText || (async b => (await import('./pdf-reading.js')).extractPdfText(b, { limit: 3000 })))(bytes).catch(() => null);
    const text = String(r?.text || '').replace(/\s+/g, ' ').trim();
    return text.length > 80 ? { text: text.slice(0, 2500) } : { scan: true };
  }
  let sheets = [];
  if (/\.csv$/i.test(doc.name)) { const { parseClientCsv } = await import('./workfile-table-import.js'); sheets = [{ name: null, rows: parseClientCsv(bytes.toString('utf8').replace(/^\uFEFF/, '')) }]; }
  else if (/\.xls$/i.test(doc.name)) sheets = (await import('./legacy-xls.js')).legacySheets(bytes).slice(0, 4);
  else if (/\.xlsx$/i.test(doc.name)) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
    sheets = wb.worksheets.filter(x => x.state === 'visible' && x.actualRowCount > 1).slice(0, 4).map(ws => {
      const rows = []; ws.eachRow({ includeEmpty: false }, (row, n) => { if (n > (d.maxRows || 6000)) return; const v = []; row.eachCell((c, i) => { if (i <= 30 && !(c.isMerged && c.master && c.master.address !== c.address)) { const x = c.value; v[i - 1] = x && typeof x === 'object' ? (x.result ?? x.text ?? (x.richText ? x.richText.map(t => t.text).join('') : x instanceof Date ? x : null)) : x; } }); rows.push(Array.from(v, y => y ?? null)); });
      return { name: ws.name, rows };
    });
  } else return {};
  return { sheets: sheets.map(sh => describeTable(sh.name, sh.rows)) };
}
// One sheet of a client file as a person sees it at a glance: its title lines, its column titles, a few lines, how many lines, and how it is
// BUILT (categories proved by their sums, or the grand-livre shape) — so the AI can tell a PTBA from a TEB or a grand livre by its content.
// What the sheet itself says it expects (its title and instructions, written by the firm in the working file).
export function sheetWants(u) {
  const t = fold([u.title, ...(u.instructions || [])].join(' '));
  return { statements: /releve|avis de credit|encaissement|fonds recus/.test(t), ledger: /grand livre|\bgl\b/.test(t),
    expenses: /depense/.test(t) && /grand livre|\bgl\b|analytique/.test(t), tiers: /auxiliaire|\btiers\b|fournisseurs|comptes? clients/.test(t) && !/general/.test(t),
    said: [u.title, ...(u.instructions || [])].join(' ').slice(0, 120) };
}
// A sheet of ENTRIES by its own columns (dated lines with an amount), whatever its title says.
export function isLedgerSheet(u) {
  const roles = new Set(u.columns.map(c => columnRole(c.header)).filter(Boolean));
  return roles.has('date') && u.columns.some(c => c.amount) && (roles.has('account') || roles.has('description') || roles.has('category') || u.columns.length >= 4);
}
function isBankStatement(headers, titleRows) {
  const h = headers.map(x => fold(x)), t = fold(titleRows.flat().filter(Boolean).join(' '));
  const money = h.some(x => /debit|retrait/.test(x)) && h.some(x => /credit|depot|versement/.test(x)) || h.some(x => /montant/.test(x));
  const bank = /releve|extrait de compte|iban|rib|banque|bank|date valeur|date de valeur/.test(t + ' ' + h.join(' '));
  // one account only (no account column) with a running balance (« Solde ») = the signature of a statement, even without a bank title
  const running = h.some(x => /^solde\b/.test(x));
  return money && (bank || running) && !h.some(x => columnRole(x) === 'account');
}
// A header on two rows where the SECOND row carries the sub-titles (« Report à nouveau » over « Débit | Crédit »): the group title is carried
// over its columns and joined to each sub-title, and the sub-title row leaves the body.
export function combineSubHeader(rows, h) {
  const top = (rows[h] || []).map(v => (v == null ? '' : String(v).trim())), sub = (rows[h + 1] || []).map(v => (v == null ? '' : String(v).trim()));
  const filled = sub.filter(Boolean);
  if (filled.length < 2 || filled.some(v => v.length > 40 || /^-?[\d\s.,]+$/.test(v))) return rows;
  if (!sub.some((v, i) => v && !top[i]) && !sub.some((v, i) => v && top[i] && i > 0)) return rows;
  const width = Math.max(top.length, sub.length), out = []; let group = '';
  for (let i = 0; i < width; i++) { if (top[i]) group = top[i]; else if (!sub[i]) group = ''; out[i] = sub[i] ? ((top[i] || group) ? (top[i] || group) + ' ' + sub[i] : sub[i]) : top[i] || ''; }
  const copy = rows.slice(); copy[h] = out; copy.splice(h + 1, 1); return copy;
}
// The accounts of a table read by account (a balance, a list of accounts): the column of account numbers — by its title, else by its
// values (Paul : « les numéros de comptes existent en colonne A ») — their classes, titles and lines. null when the table has none.
export function measureAccounts(headers, body) {
  const isAcc = v => /^\d{3,12}$/.test(String(v ?? '').trim());
  let ac = headers.findIndex(x => columnRole(x) === 'account');
  if (ac < 0) {
    const width = Math.max(headers.length, ...body.slice(0, 50).map(r => r.length));
    for (let c = 0; c < Math.min(width, 12) && ac < 0; c++) { const vals = body.map(r => r[c]).filter(v => v != null && String(v).trim() !== ''); const ok = vals.filter(isAcc); if (vals.length >= 5 && ok.length / vals.length >= 0.6 && new Set(ok.map(String)).size >= 5) ac = c; }
  }
  if (ac < 0) return null;
  const rowsOk = body.filter(r => isAcc(r[ac]));
  if (rowsOk.length < 3 || rowsOk.length < body.filter(r => r[ac] != null && String(r[ac]).trim()).length * 0.5) return null;
  const tc = (() => { const t = headers.findIndex((x, i) => i !== ac && /intitule|libelle/.test(fold(x))); if (t >= 0) return t; for (let c = 0; c < 6; c++) if (c !== ac && rowsOk.slice(0, 20).filter(r => typeof r[c] === 'string' && /[a-z]/i.test(r[c])).length >= rowsOk.slice(0, 20).length * 0.6) return c; return -1; })();
  const classes = {}, list = new Map();
  for (const r of rowsOk) { const a = String(r[ac]).trim(); classes[a[0]] = (classes[a[0]] || 0) + 1; const e = list.get(a) || { account: a, title: tc >= 0 ? String(r[tc] ?? '').slice(0, 60) : null, lines: 0 }; e.lines++; list.set(a, e); }
  const n = rowsOk.length, h = headers.map(fold).join(' ');
  // dated lines (by a column's title, or by its VALUES: dates in most lines) = entries of a ledger, not a balance
  const isDate = v => v instanceof Date || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$|^\d{4}-\d{2}-\d{2}/.test(String(v ?? '').trim());
  let dc = headers.findIndex(x => columnRole(x) === 'date');
  if (dc < 0) for (let c = 0; c < 12 && dc < 0; c++) if (c !== ac && rowsOk.slice(0, 200).filter(r => isDate(r[c])).length >= rowsOk.slice(0, 200).length * 0.6) dc = c;
  const dated = dc >= 0;
  if (dated) {
    const years = new Set(rowsOk.map(r => String(r[dc] instanceof Date ? r[dc].toISOString() : r[dc] ?? '').match(/(19|20)\d\d/)?.[0]).filter(Boolean));
    const cls = Object.keys(classes), nonTiers = cls.filter(c => c !== '4').length;
    return { looks_like: nonTiers >= 2 ? 'grand livre GÉNÉRAL (plusieurs classes de comptes)' : 'grand livre (une ou deux classes de comptes)', entries: n,
      account_column: headers[ac] || ('colonne ' + String.fromCharCode(65 + ac)), date_column: headers[dc] || ('colonne ' + String.fromCharCode(65 + dc)), accounts: list.size, years: [...years].sort(),
      account_classes: Object.fromEntries(cls.sort().map(c => [c, Math.round(100 * classes[c] / n) + ' %'])), expenses_share: Math.round(100 * (classes['6'] || 0) / n) + ' %',
      accounts_list: [...list.values()].sort((a, b) => a.account.localeCompare(b.account)).slice(0, 400) };
  }
  const balance = !dated && /solde|mouvement|report|a nouveau|debit|credit/.test(h);
  return { looks_like: balance ? 'balance des comptes (un compte par ligne, avec ses montants : report, mouvements, solde — pas d’écritures datées)' : 'liste par compte',
    account_column: headers[ac] || ('colonne ' + String.fromCharCode(65 + ac)), accounts: list.size, total_lines: body.length - n,
    account_classes: Object.fromEntries(Object.keys(classes).sort().map(c => [c, Math.round(100 * classes[c] / n) + ' %'])),
    accounts_list: [...list.values()].sort((a, b) => a.account.localeCompare(b.account)).slice(0, 400) };
}
export function describeTable(name, allRows) {
  let acc = null;
  const cell = x => (x instanceof Date ? x.toISOString().slice(0, 10) : x == null ? '' : String(x).slice(0, 40));
  let rows = allRows.filter(r => r && r.some(v => v != null && String(v).trim() !== ''));
  const h = headerRow(rows); rows = combineHeaderRows(rows, h); rows = combineSubHeader(rows, h);
  const headers = (rows[h] || []).map(v => String(v ?? '').trim());
  const body = rows.slice(h + 1), out = { name, title_lines: rows.slice(Math.max(0, h - 4), h).map(r => r.filter(v => v != null && v !== '').map(cell).slice(0, 6)),
    headers: headers.slice(0, 30), first_lines: body.slice(0, 6).map(r => r.slice(0, 16).map(cell)),
    // a few lines from the MIDDLE too: the AI sees the body of the document, not only its head (a GL's later accounts, a PTBA's lower categories)
    middle_lines: body.length > 20 ? [0.33, 0.5, 0.66].map(f => body[Math.floor(body.length * f)]).filter(Boolean).map(r => r.slice(0, 16).map(cell)) : [],
    last_lines: body.slice(-2).map(r => r.slice(0, 16).map(cell)), lines: body.length };
  const role = tableRole(headers);
  const flatFirst = flattenLedger(rows, h);
  if (!flatFirst?.flattened?.sections && isBankStatement(headers, rows.slice(0, h))) {
    out.shape = { looks_like: 'relevé bancaire (un compte en banque : date, libellé, débit / crédit, solde)' };
  } else if (role === 'gl' || flatFirst) {
    const flat = flattenLedger(rows, h);
    const years = new Set(), accounts = new Set();
    const t = flat || { rows: [headers, ...body], header_row: 0 };
    const hd = (t.rows[t.header_row] || []).map(String), dc = hd.findIndex(x => columnRole(x) === 'date'), ac = hd.findIndex(x => columnRole(x) === 'account');
    const classes = {}; let n = 0;
    for (const r of t.rows.slice(t.header_row + 1)) {
      const y = String(r[dc] instanceof Date ? r[dc].toISOString() : r[dc] ?? '').match(/(19|20)\d\d/); if (y) years.add(y[0]);
      if (ac >= 0 && r[ac]) { const a = String(r[ac]).trim(); accounts.add(a); n++; const c = /^\d/.test(a) ? a[0] : 'tiers'; classes[c] = (classes[c] || 0) + 1; }
    }
    // The accounts and their titles (what the AI needs to match a budget's categories to the GL's accounts): number, title, lines.
    const lc = hd.findIndex(x => /intitule du compte|libelle du compte|intitule compte/.test(fold(x)));
    const accTitles = new Map(); if (ac >= 0) for (const r of t.rows.slice(t.header_row + 1)) { const a = String(r[ac] ?? '').trim(); if (!a) continue; const e = accTitles.get(a) || { account: a, title: lc >= 0 ? String(r[lc] ?? '').slice(0, 60) : null, lines: 0 }; e.lines++; accTitles.set(a, e); }
    // WHICH ledger, measured: a GENERAL ledger runs over several account classes (charges 6, banque 5, immobilisations 2…); an AUXILIARY
    // ledger is the detail of third parties (suppliers 40x, customers 41x, or codes « FOU001 »); a bank statement is one bank account.
    const cls = Object.keys(classes), share = c => (n ? (classes[c] || 0) / n : 0);
    const tiersOnly = n > 0 && (share('tiers') > 0.6 || [...accounts].every(a => /^4[01]/.test(a) || !/^\d/.test(a)));
    const kind = tiersOnly ? 'grand livre AUXILIAIRE (tiers : fournisseurs / clients) — pas le grand livre général'
      : cls.filter(c => c !== 'tiers').length >= 2 ? 'grand livre GÉNÉRAL (plusieurs classes de comptes)' : 'grand livre';
    out.shape = { looks_like: kind, entries: flat ? flat.flattened.entries : body.length, by_account_sections: Boolean(flat?.flattened?.sections), accounts: accounts.size,
      account_classes: Object.fromEntries(cls.map(c => [c, Math.round(100 * share(c)) + ' %'])), expenses_share: Math.round(100 * share('6')) + ' %', years: [...years].sort(),
      accounts_list: [...accTitles.values()].sort((a, b) => String(a.account).localeCompare(String(b.account))).slice(0, 400) };
  } else if (isBankStatement(headers, rows.slice(0, h))) {
    out.shape = { looks_like: 'relevé bancaire (un compte en banque : date, libellé, débit / crédit, solde)' };
  } else if (body.length <= 3000) {
    const st = describeStructure(tableStructure(headers, body));
    // EXECUTION (TEB : budget + engagé / décaissé / réalisé) or FORECAST (PTBA : budget by category, no execution column) — by its columns.
    const concepts = headers.map(x => columnConcept(x));
    const execution = concepts.some(c => ['committed', 'disbursed', 'realised'].includes(c)) && concepts.includes('budget');
    if (execution) out.shape = { looks_like: "tableau d'exécution budgétaire (TEB : budget, engagements / réalisations)", ...(st || {}) };
    else if (st) out.shape = { looks_like: (st.categories_proved_by_sum || []).length >= 2 ? 'budget prévisionnel par catégorie (PTBA : prévision, sans exécution)' : role === 'budget' ? 'budget' : 'tableau', ...st };
  }
  // Not a budget, not a ledger: a BALANCE (or any list by account: numbers + titles + amounts, no dated entries) — its accounts are measured
  // like a ledger's (2026-10-26, Paul : « il ne voit toujours pas les comptes, il accuse le code » : a balance fell into the budget branch,
  // its account numbers were read as amounts and no account was ever measured).
  if ((!out.shape || out.shape.looks_like === 'tableau' || (out.shape.entries && !Object.keys(out.shape.account_classes || {}).length)) && (acc = measureAccounts(headers, body))) out.shape = acc;
  return out;
}
async function peekAll(ctx, d) {
  // Every spreadsheet of the mission first (the grand livre, the PTBA, the TEB are tables), then the PDFs — not the first 30 in list order,
  // which left out the pieces deposited last (« le GL y est, il ne sait même pas »).
  const list = [...ctx.docs.filter(x => isSheet(x.name)), ...ctx.docs.filter(x => isPdf(x.name))].slice(0, 80);
  const out = {};
  for (let i = 0; i < list.length; i += 5) await Promise.all(list.slice(i, i + 5).map(async x => { out[x.id] = await peekDocument(x, ctx.drive, d).catch(() => ({ unreadable: 'lecture impossible' })); }));
  return out;
}
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
  let aiError = null, retried = null;
  let ai = 'not_needed', summary = null, rowsFrom = body.rows_from || null, glDoc = body.gl_document_id || null;  // reassigned after the AI's check of the opened tables
  const open = u.columns.filter(c => !confirmed[c.col]);
  // The FICHE of each piece (lib/piece-profile.js), made at deposit by reading the whole piece; the pieces without one get it now (as many
  // as the time allows — the others are seen through their measured content below).
  const profiles = {}; for (const x of docs) if (x.profile) profiles[x.id] = x.profile;
  let profilesLeft = 0;
  const unprofiled = docs.filter(x => !x.profile && (isSheet(x.name) || isPdf(x.name)));
  if (open.length && unprofiled.length && d.profiles !== false) {
    const r = await (d.ensureProfiles || (await import('./piece-profile.js')).ensureProfiles)(org, mission, unprofiled, { ...d, profileBudgetMs: d.profileBudgetMs ?? 45000 }).catch(() => null);
    Object.assign(profiles, r?.profiles || {}); profilesLeft = r ? r.left : unprofiled.length;
  }
  const fiche = id => { const p = profiles[id]; return p ? { family: p.family, what: p.what, period: p.period, line_unit: p.line_unit, key: p.key, columns: p.columns, categories: p.categories, confidence: p.confidence, corrected_by_an_auditor: p.corrected_by || null, code_doubt: p.code_doubt || null } : null; };
  // How this same sheet of this same working-file model was filled and validated before (lib/fill-recipes.js) — learned, not coded.
  const recipe = await (d.recipeFor || (await import('./fill-recipes.js')).recipeFor)(ctx.map.key, sheet, d).catch(() => null);
  const peeks = open.length ? await peekAll(ctx, d) : {};
  // what auditors taught on this step in the agents' training (lib/agent-gym.js) — validated lessons only, in the application
  const taughtFill = open.length ? (d.trainerLessons ?? await (async () => (await import('./agent-gym.js')).lessonsFor('remplissage', { sheet }, d))().catch(() => [])) : [];
  let expects = [];
  if (open.length) {
    try {
      const payload = {
        sheet: { name: sheet, title: u.title, instructions: u.instructions },
        columns: open.map(c => ({ col: c.col, header: c.header, what_the_tests_do: c.says, key: c.key, amount: c.amount })),
        tests: u.tests.map(t => ({ code: t.code, title: t.title, how: t.how })),
        pieces_the_file_asks: u.pieces,
        lessons_from_trainers: taughtFill?.length ? taughtFill : undefined,
        recipe_validated_before: recipe ? { rows_from: recipe.rows_from, gl: recipe.gl, columns: recipe.columns, validated_by: recipe.validated_by, at: recipe.at } : null,
        chosen_by_a_person_for_this_sheet: chosen,
        already_confirmed: assignments.map(a => ({ col: a.col, document_id: a.document_id, heading: a.heading })),
        auditor_says: body.hint ? String(body.hint).slice(0, 800) : null,
        documents: [...docs].sort((a, b) => Number(chosen.includes(b.id)) - Number(chosen.includes(a.id)) || Number(Boolean(profiles[b.id])) - Number(Boolean(profiles[a.id])) || Number(isSheet(b.name)) - Number(isSheet(a.name))).slice(0, 150).map(x => ({ id: x.id, name: x.name, fiche: fiche(x.id), is: x.is || null, period: x.period || null, summary: profiles[x.id] ? null : (x.summary || null), format: isPdf(x.name) ? 'pdf' : isSheet(x.name) ? 'tableur' : 'autre', content: peeks[x.id] || null,
          extract_of_pdf: (x.uses || []).find(y => y.what === 'extrait_de')?.where || null, refused_for_this_sheet: (x.history || []).some(h => /écarté/.test(h.what || '') && String(h.detail || '').includes(sheet)) }))
      };
      // Made smaller without ever cutting the JSON: the measured content of pieces that HAVE a fiche goes first (the fiche says it), then
      // PDF text, then sample lines.
      const input = fitJson(payload, 90000, [
        o => o.documents.forEach(x => { if (x.fiche && x.content) x.content = { sheets: (x.content.sheets || []).map(sh => ({ name: sh.name, headers: sh.headers, lines: sh.lines, shape: sh.shape ? { ...sh.shape, accounts_list: (sh.shape.accounts_list || []).slice(0, 60) } : null })) }; }),
        o => o.documents.forEach(x => { if (x.content?.text) x.content.text = x.content.text.slice(0, 800); }),
        o => o.documents.forEach(x => (x.content?.sheets || []).forEach(sh => { sh.first_lines = (sh.first_lines || []).slice(0, 3); sh.middle_lines = []; sh.last_lines = []; })),
        o => o.documents.forEach(x => { if (x.content?.text) delete x.content.text; x.summary = x.summary ? x.summary.slice(0, 120) : null; }),
        o => o.documents.forEach(x => (x.content?.sheets || []).forEach(sh => { if (sh.shape?.categories_proved_by_sum) sh.shape.categories_proved_by_sum = sh.shape.categories_proved_by_sum.slice(0, 15); if (sh.shape?.accounts_list) sh.shape.accounts_list = sh.shape.accounts_list.slice(0, 20); }))
      ]);
      // The AI is what makes the filling right (Paul) : when it does not answer, it is asked AGAIN with a lighter input (each document's
      // fiche and titles, without sample lines nor PDF text) before anything else is shown.
      const ask = inp => (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: ASSIGN + '\n\n' + PROJECT_AUDIT_METHOD, input: inp, maxTokens: 3000 });
      let r;
      try { r = await ask(input); }
      catch (first) {
        const light = JSON.parse(input);
        for (const x of light.documents || []) { if (x.content?.text) x.content.text = x.content.text.slice(0, 400); for (const sh of x.content?.sheets || []) { sh.first_lines = (sh.first_lines || []).slice(0, 2); sh.middle_lines = []; sh.last_lines = []; } }
        retried = String(first?.message || first).slice(0, 120);
        r = await ask(fitJson(light, 40000));
      }
      const out = parseJsonLoose(r?.text ?? r) || {}; ai = r?.provider || 'ai'; summary = out.summary ? String(out.summary).slice(0, 600) : null;
      expects = (Array.isArray(out.sheet_expects) ? out.sheet_expects : []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 8);
      const known = id => docs.some(x => x.id === id);
      const ids = [...new Set([out.rows_from?.document_id, ...(Array.isArray(out.rows_from?.document_ids) ? out.rows_from.document_ids : [])].map(x => String(x || '')).filter(known))].slice(0, 40);
      const which = ['subtotals', 'credits', 'debits', 'one_per_document'].includes(out.rows_from?.which) ? out.rows_from.which : 'lines';
      if (ids.length) rowsFrom = { document_id: ids[0], document_ids: ids, which };
      if (out.gl_document_id && known(String(out.gl_document_id))) glDoc = String(out.gl_document_id);
      for (const c of Array.isArray(out.columns) ? out.columns : []) {
        if (!open.some(o => o.col === c.col)) continue;
        let id = c.document_id ? String(c.document_id) : null;
        // A PDF named by the AI: its verified extract (if made) is the table that will be read.
        if (id && isPdf(docs.find(x => x.id === id)?.name)) { const ex = extractOf(docs, id); if (ex) id = ex.id; }
        const compute = /^\s*[A-Z]{1,3}\s*-\s*[A-Z]{1,3}\s*$/.test(String(c.compute || '')) ? String(c.compute).replace(/\s/g, '') : null;
        if (compute) { assignments.push({ col: c.col, document_id: null, compute, by: 'ia', why: String(c.why || '').slice(0, 300) }); continue; }
        assignments.push({ col: c.col, document_id: id, heading: c.heading ? String(c.heading).slice(0, 160) : null, account_from_gl: c.account_from_gl === true, sure: c.sure !== false, why: String(c.why || '').slice(0, 300), missing: c.missing ? String(c.missing).slice(0, 160) : null, by: 'ia' });
      }
    } catch (e) { ai = 'unavailable'; aiError = String(e?.message || e).slice(0, 200); }
  }
  const shapes = id => peeks[id]?.sheets || [];
  const kindOf = id => [profiles[id]?.family || '', ...shapes(id).map(sh => sh.shape?.looks_like || '')].join(' | ');
  const year = String(ctx.view?.mission?.period_label || '').match(/(19|20)\d\d/g) || [];
  // Without the AI (Paul, 2026-10-12 : « si l'IA ne passe pas, l'application fonctionne-t-elle ? ») — a SECOURS, everything « à confirmer »:
  // the recipe learned on a previous mission, applied to this mission's pieces by their family; else the document a person chose; else the
  // piece whose fiche / measured shape fits (a general ledger for a sheet of entries, a budget whose categories are proved by their sums for
  // a sheet by category).
  const fromRecipe = ai === 'unavailable' ? applyRecipe(recipe, docs, profiles, year) : null;
  if (fromRecipe && (fromRecipe.columns.length || fromRecipe.rowsFrom)) {
    for (const c of fromRecipe.columns) if (!assignments.some(a => a.col === c.col)) assignments.push(c);
    if (fromRecipe.rowsFrom) rowsFrom = fromRecipe.rowsFrom;
    if (fromRecipe.gl && !glDoc) glDoc = fromRecipe.gl;
  } else if (ai === 'unavailable') {
    const ledgerSheet = isLedgerSheet(u);
    const rowsCol = u.columns.find(c => c.col === u.rows_from);
    const byCategory = !ledgerSheet && rowsCol && /categor|rubrique|ligne budgetaire/.test(fold(rowsCol.header)) && u.columns.some(c => c.amount);
    const rank = id => { const f = profiles[id]?.family || ''; return f === 'grand_livre_general' ? 0 : /GÉNÉRAL/.test(kindOf(id)) ? 1 : /AUXILIAIRE|auxiliaire/.test(kindOf(id)) ? 3 : 2; };
    const gl = docs.filter(x => /grand livre|grand_livre/.test(kindOf(x.id))).sort((a, b) => rank(a.id) - rank(b.id) || Number(shapes(b.id).some(sh => (sh.shape?.years || []).some(y => year.includes(y)))) - Number(shapes(a.id).some(sh => (sh.shape?.years || []).some(y => year.includes(y)))));
    const budget = docs.filter(x => shapes(x.id).some(sh => (sh.shape?.categories_proved_by_sum || []).length >= 2));
    // a sheet whose own words speak of bank statements / credit advices: the credits of the pieces the code measured as statements (a hint, to confirm)
    const wants = sheetWants(u), statements = docs.filter(x => /relevé bancaire|releve_bancaire/.test(kindOf(x.id)));
    if (wants.statements && !chosen.length && statements.length) { rowsFrom = { document_id: statements[0].id, document_ids: statements.map(x => x.id).slice(0, 40), which: 'credits' }; for (const c of open) if (!assignments.some(a => a.col === c.col) && c.col !== u.rows_from) assignments.push({ col: c.col, document_id: statements[0].id, heading: null, sure: false, why: 'crédits des relevés bancaires (code seul, l’IA n’a pas répondu) ; à vérifier', by: 'code' }); }
    const pickDoc = wants.statements ? null : chosen[0] || (ledgerSheet ? gl[0]?.id : byCategory ? budget[0]?.id : null);
    if (pickDoc) {
      if (byCategory && !chosen.length) rowsFrom = { document_id: pickDoc, document_ids: [pickDoc], which: 'subtotals' };
      for (const c of open) if (!assignments.some(a => a.col === c.col) && !(c.col === u.rows_from && !byCategory)) assignments.push({ col: c.col, document_id: pickDoc, heading: null, sure: false, why: chosen.length ? 'document choisi pour la feuille ; colonne à vérifier' : 'proposé par le code seul (l’IA n’a pas répondu) ; à vérifier', by: 'code' });
    }
  }
  // What the CODE checks on the AI's choice (never a decision in its place — a question to the person): the piece's fiche against what the
  // AI itself said the sheet expects, and the doubts the code measured on the piece (only tiers accounts in a « grand livre général »…).
  const doubts = [];
  const checkFiche = (a, id, label) => {
    const f = profiles[id]?.family;
    if (profiles[id]?.code_doubt) doubts.push({ col: a?.col || null, why: '« ' + (docs.find(x => x.id === id)?.name || id) + ' » : ' + profiles[id].code_doubt });
    if (f && expects.length && !expects.includes(f)) doubts.push({ col: a?.col || null, why: label + ' : la pièce « ' + (docs.find(x => x.id === id)?.name || id) + ' » est « ' + f + ' » alors que la feuille attend ' + expects.join(' / ') });
  };
  for (const a of assignments) if (a.document_id && a.by !== 'confirmé' && a.by !== 'personne') checkFiche(a, a.document_id, 'colonne ' + a.col);
  for (const id of rowsFrom?.document_ids || []) checkFiche(null, id, 'lignes');
  for (const x of doubts) { const a = x.col && assignments.find(y => y.col === x.col); if (a) Object.assign(a, { sure: false, why: (a.why ? a.why + ' — ' : '') + x.why }); }
  let plan = checkAssignments(u, assignments, docs);
  // Open the tables of the documents kept and find each column's heading in them (the AI's title if it exists, else the code's reading).
  // Méthode du cabinet (Paul, 2026-10-25) : l'opérande manquant d'un recalcul « initial + amendements = final » se calcule (amendements =
  // final − initial) quand les deux autres viennent de pièces.
  for (const k of u.comparisons) {
    if (k.left.length !== 2 || k.right.length !== 1) continue;
    const miss = k.left.filter(c => !plan.find(p => p.col === c)?.document_id && !plan.find(p => p.col === c)?.compute);
    if (miss.length !== 1 || columnConcept(u.columns.find(c => c.col === miss[0])?.header) !== 'amendment') continue;
    const other = k.left.find(c => c !== miss[0]), right = k.right[0];
    if (!plan.find(p => p.col === other)?.document_id || !plan.find(p => p.col === right)?.document_id) continue;
    Object.assign(plan.find(p => p.col === miss[0]), { compute: right + '-' + other, document_id: null, status: 'sure', by: 'méthode', missing: null,
      why: 'calculé : « ' + u.columns.find(c => c.col === right).header + ' » − « ' + u.columns.find(c => c.col === other).header + ' » (méthode du cabinet)' });
  }
  const tables = await readTables(ctx, plan, body, account, d, org, mission, code);
  // The grand livre used as a table of correspondence (libellé → numéro de compte), when the AI named it or a column needs it.
  // Recognised by its SHAPE (date, compte, débit / crédit) as measured on its content, the name only as a last hint.
  // (its fiche says « grand_livre_general » first; then what the code measured; an auxiliary ledger last — it has no expense accounts)
  const glRank = id => (profiles[id]?.family === 'grand_livre_general' ? 0 : /GÉNÉRAL/.test(kindOf(id)) ? 1 : /auxiliaire|AUXILIAIRE/.test(kindOf(id)) ? 3 : 2);
  const glShaped = ctx.docs.filter(x => /grand livre|grand_livre/.test(kindOf(x.id))).sort((a, b) => glRank(a.id) - glRank(b.id));
  const byCat = u.columns.some(c => /categor|rubrique|ligne budgetaire|poste budgetaire/.test(fold(c.header)) && c.key) && !u.columns.some(c => columnRole(c.header) === 'date');
  if (!glDoc && (plan.some(p => p.account_from_gl) || byCat)) glDoc = glShaped[0]?.id || ctx.docs.find(x => isSheet(x.name) && /grand livre|general ledger|\bgl\b/i.test(String(x.is || '') + ' ' + x.name))?.id || null;
  const glMap = glDoc ? await ledgerAccounts(ctx, glDoc, tables, d, org, mission, code, account) : null;
  for (const p of plan) {
    if (!p.document_id) continue;
    const t = tables[p.document_id];
    if (!t || t.error || !t.headers) { Object.assign(p, { pdf: t?.pdf || null, status: t?.needs_extraction ? 'needs_extraction' : 'unreadable', why: (p.why ? p.why + ' — ' : '') + (t?.needs_extraction ? 'PDF à transformer en tableau' : 'tableau illisible : ' + (t?.error || '?')) }); continue; }
    const heads = t.headers;
    let i = p.heading ? heads.findIndex(h => key(h) === key(p.heading)) : -1;
    const net = i < 0 ? netPair(p.header, heads, p.heading) : null;
    if (net) { Object.assign(p, { heading: net.heading, source_index: net.i, minus_index: net.minus, headings: [...heads, net.heading], why: (p.why ? p.why + ' — ' : '') + 'montant = « ' + heads[net.i] + ' » moins « ' + heads[net.minus] + ' »' }); continue; }
    if (i < 0) { if (t.main === undefined) t.main = tableStructure(heads, t.rows.slice(0, 3000)).amount_index ?? -1; const g = proposeColumn(p.header, heads, t.rows, { main: t.main, amount: Boolean(u.columns.find(c => c.col === p.col)?.amount) }); if (g.source != null) { i = g.source; if (!p.heading) p.why = (p.why ? p.why + ' — ' : '') + g.why; if (!g.sure) p.status = 'to_confirm'; } }
    // a column the code proposed on its own and finds nothing for: left empty (said), not a list of headings to choose from
    if (i < 0 && p.by === 'code') { Object.assign(p, { document_id: null, document: null, status: 'missing', why: 'aucune colonne de « ' + (t.name || 'la pièce') + ' » ne correspond (code seul)' }); continue; }
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
    if (doubt && p.status !== 'heading_to_choose' && p.by !== 'méthode') Object.assign(p, { status: 'to_confirm', why: (p.why ? p.why + ' — ' : '') + doubt });
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
  // Several documents give the lines (each month's bank statement, every credit advice): the rows are COLLECTED from all of them.
  const collected = collectMode(rowsFrom) ? await collectRows(ctx, plan, rowsFrom, body, account, d, org, mission, code) : null;
  let accountMap = null, accountList = null;
  if (!collected && glMap) {
    const labels = new Set(); await buildCombined(ctx, plan, tables, { rowsFrom, glMap, labels }).catch(() => null);
    if (labels.size) { const m = await aiAccountMap([...labels], glMap, d).catch(() => null); if (m) { accountMap = m.map; accountList = m.list; } }
  }
  const preview = collected ? collected.built : await buildCombined(ctx, plan, tables, { rowsFrom, glMap, accountMap });
  // What will be written, cell by cell, shown IN the sheet (dotted, with its source) — not in another panel.
  const cells = [];
  if (preview.table) preview.table.rows.slice(1).forEach((row, r) => u.columns.forEach((c, k) => {
    const v = row[k]; if (v == null || v === '' || cells.length >= 3000) return;
    const pv = preview.table.provenance[r]?.[k];
    cells.push({ sheet, address: c.col + (u.first_row + r), value: v, label: c.header, source: pv ? pv.name + ' — « ' + pv.heading + ' », ligne ' + pv.line : 'pièce de la mission' });
  }));
  if (collected?.cache) await saveCollected(org, mission, code, ctx, collected.cache, account, d).catch(() => null);
  // What the agent recognised in the mission's pieces, by their content (shown in one line: « Grand livre : … ; budget par catégorie : … »).
  const recognised = { fiches: docs.filter(x => profiles[x.id]).map(x => ({ id: x.id, name: x.name, family: profiles[x.id].family, what: profiles[x.id].what, confidence: profiles[x.id].confidence, corrected_by: profiles[x.id].corrected_by || null, code_doubt: profiles[x.id].code_doubt || null })), fiches_left: profilesLeft,
    ledgers: glShaped.map(x => x.name + (glRank(x.id) <= 1 ? ' (général)' : glRank(x.id) === 3 ? ' (auxiliaire)' : '')), statements: docs.filter(x => /relevé bancaire|releve_bancaire/.test(kindOf(x.id))).map(x => x.name), budgets_with_categories: ctx.docs.filter(x => (peeks[x.id]?.sheets || []).some(sh => (sh.shape?.categories_proved_by_sum || []).length >= 2)).map(x => x.name), seen: Object.keys(peeks).length, documents: ctx.docs.length };
  return { sheet, cells, recognised, doubts, sheet_expects: expects, recipe: recipe ? { validated_by: recipe.validated_by, at: recipe.at, times: recipe.times || 1 } : null, account_map: accountList, ai_error: aiError, ai_retried: retried, problem: preview.public?.problem || null, collect: collected ? collected.report : null, rows_from: rowsFrom, gl_document_id: glDoc, understanding: publicUnderstanding(u), plan: plan.map(publicPlan), ai, summary, preview: { ...preview.public, capacity: Math.max(0, u.last_row - u.first_row + 1) },
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
        if ((body.extract !== undefined && body.extract !== id) || extractions >= 1) { out[id] = { needs_extraction: true, pdf: id }; continue; }
        extractions++;
        const r = await (d.extractPdf || (await import('./workfile-sources.js')).extractPdfTable)(org, mission, code, { sheet: ctx.sheet, file_id: id }, account, d);
        out[id] = await tableOf(r.file_id, 'TABLEAU'); out[id].via = r.file_id;
        continue;
      }
      if (!isSheet(doc?.name)) { out[id] = { error: 'format non tabulaire' }; continue; }
      out[id] = await tableOf(id, null);
    } catch (e) { const m = String(e.message || e); out[id] = { error: ({ NO_TABLE_IN_PDF: 'ce PDF ne contient pas de tableau (c’est un document à lire, pas un tableau à recopier)', PDF_UNREADABLE: 'PDF illisible', AI_UNAVAILABLE_FOR_PDF: 'l’IA n’a pas répondu pour lire ce PDF' })[m] || m.slice(0, 80) }; }
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

// Libellé → numéro de compte, read in a grand livre (its « Intitulé du compte » after flattening, else the entry labels of each account).
async function ledgerAccounts(ctx, glDoc, tables, d, org, mission, code, account) {
  let t = tables[glDoc];
  if (!t) { const r = await readTables(ctx, [{ document_id: glDoc }], {}, account, d, org, mission, code); t = r[glDoc]; tables[glDoc] = t; }
  if (!t?.headers) return null;
  const acc = t.headers.findIndex(h => columnRole(h) === 'account');
  if (acc < 0) return null;
  const labelCols = [t.headers.findIndex(h => /intitule du compte|libelle du compte|intitule compte/.test(fold(h))), t.headers.findIndex(h => columnRole(h) === 'description')].filter(i => i >= 0);
  const map = new Map(), numbers = new Set();
  for (const r of t.rows) {
    const n = String(r[acc] ?? '').trim(); if (!/^\d{3,12}$/.test(n)) continue;
    numbers.add(n);
    for (const i of labelCols) { const k = key(r[i]); if (k && !map.has(k)) map.set(k, n); }
  }
  // each account's title (the « Intitulé du compte », else its most frequent entry label) and how many entries — what the AI sees to match
  const titles = new Map(), counts = new Map();
  for (const r of t.rows) { const n = String(r[acc] ?? '').trim(); if (!/^\d{3,12}$/.test(n)) continue; counts.set(n, (counts.get(n) || 0) + 1); if (!titles.has(n)) { const v = labelCols.map(i => r[i]).find(x => x != null && String(x).trim()); if (v) titles.set(n, String(v).trim().slice(0, 80)); } }
  return { map, numbers, titles, counts, name: t.name, id: glDoc };
}
// (Paul, 2026-10-26 : « on a préféré écrire B1 au lieu de chercher le numéro de compte ou le poste de dépense associé ») The AI matches each
// line label (a budget's categories, a TEB's lines) to the GL's accounts BY MEANING — « Transport des agents en formation » ↔ 618120
// « Voyages et déplacements » — the code keeps only numbers that exist in the GL. The closest-title match of the code is given as a hint.
const ACCOUNTS = `Tu es l'Enhanced Auditor. Voici des libellés de lignes (catégories d'un budget, lignes d'un tableau d'exécution) et les comptes du
grand livre de la mission (numéro, intitulé, nombre d'écritures). Pour CHAQUE libellé, donne le ou les numéros de compte du grand livre qui
correspondent à cette dépense ou ressource, par le SENS (pas seulement les mots communs) ; "hint" = la proposition du code par les mots, que
tu peux contredire. Aucun compte ne correspond (la dépense n'a pas eu lieu, ou c'est un regroupement) : [] et dis pourquoi. N'invente aucun
numéro : seulement des numéros de la liste. "lessons_from_trainers" = ce que des auditeurs t'ont appris sur cette étape : applique-le.
JSON STRICT : {"lines":[{"label":"…","accounts":["…"],"why":"…"}]}`;
export async function aiAccountMap(labels, glMap, d = {}) {
  const list = [...new Set(labels)].filter(Boolean).slice(0, 300);
  if (!list.length || !glMap?.numbers?.size) return null;
  const accounts = [...glMap.numbers].sort().slice(0, 600).map(n => ({ account: n, title: glMap.titles?.get(n) || null, entries: glMap.counts?.get(n) || null }));
  const taught = d.trainerLessons ?? await (async () => (await import('./agent-gym.js')).lessonsFor('correspondance', {}, d))().catch(() => []);
  const payload = { lessons_from_trainers: taught?.length ? taught : undefined, lines: list.map(l => ({ label: l, hint: accountOf(l, null, glMap)?.number || null })), ledger_accounts: accounts };
  const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: ACCOUNTS, input: fitJson(payload, 70000, [o => { o.ledger_accounts.forEach(a => { a.entries = undefined; }); }]), maxTokens: 4000 });
  const out = parseJsonLoose(r?.text ?? r) || {}, map = {};
  for (const x of Array.isArray(out.lines) ? out.lines : []) {
    const label = list.find(l => key(l) === key(x.label)); if (!label) continue;
    const ok = (Array.isArray(x.accounts) ? x.accounts : []).map(v => String(v).trim()).filter(v => glMap.numbers.has(v));
    map[key(label)] = ok.length ? { number: ok[0], others: ok.slice(1), how: 'selon l’IA', why: String(x.why || '').slice(0, 200) } : null;
  }
  return { map, provider: r?.provider || 'ai', list: list.map(l => ({ label: l, ...(map[key(l)] ? { number: map[key(l)].number, others: map[key(l)].others, why: map[key(l)].why } : { number: null, why: Object.prototype.hasOwnProperty.call(map, key(l)) ? 'aucun compte selon l’IA' : 'non traité par l’IA' }) })) };
}
// The account number of a line: its own code when the GL knows it, else its label found among the GL's labels (exact, then the closest
// label sharing most words, only when unique).
function accountOf(label, code, glMap) {
  if (!glMap) return null;
  const c = String(code ?? '').trim(); if (c && glMap.numbers.has(c)) return { number: c, how: 'code' };
  const k = key(label); if (!k) return null;
  if (glMap.map.has(k)) return { number: glMap.map.get(k), how: 'libellé identique' };
  const words = w => fold(w).split(/[^a-z0-9]+/).filter(x => x.length > 2);
  const mine = new Set(words(label)); if (!mine.size) return null;
  const scored = [...glMap.map.entries()].map(([lk, n]) => { const theirs = new Set(lk.match(/[a-z]{3,}/g) || []); let common = 0; for (const x of mine) if ([...theirs].some(t => t.startsWith(x.slice(0, 6)))) common++; return { n, score: common / Math.max(mine.size, theirs.size || 1) }; })
    .filter(x => x.score >= 0.6).sort((a, b) => b.score - a.score);
  if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score || scored[0].n === scored[1].n)) return { number: scored[0].n, how: 'libellé proche' };
  return null;
}
const SUBTOTAL = /^(sous[- ]?total|total)\s*(categorie|rubrique|ligne|poste|compte|chapitre)?\s*[:\-–]?\s*/;

// ———— Lines collected from several documents (Paul, 2026-10-25 : « fonds reçus : chercher dans les relevés bancaires ce qui est au crédit,
// utiliser l'IA pour chercher dans les avis de crédit aussi ; avances : chercher les financements avancés au GL et aux relevés ») ————
export const collectMode = rf => Boolean(rf && ((rf.document_ids || []).length > 1 || ['credits', 'debits', 'one_per_document'].includes(rf.which)));
const ROLE_OF = { date: 'date', reference: 'reference', description: 'description', account: 'account' };
// The heading of a sheet column in one document: the plan's heading if this document was named for the column, else what the column means
// (date, référence, libellé, tiers), and for the amount of a « credits » / « debits » collection, the credit / debit column.
function headingIn(t, col, plan, which) {
  const p = plan.find(x => x.col === col.col);
  if (p?.document_id === t.id && p.heading) { const i = t.headers.findIndex(h => key(h) === key(p.heading)); if (i >= 0) return i; }
  const role = columnRole(col.header);
  if ((col.amount || role === 'amount' || /montant/.test(fold(col.header))) && (which === 'credits' || which === 'debits') && !/attendu|budget|prevu/.test(fold(col.header))) { const i = t.headers.findIndex(h => columnRole(h) === (which === 'credits' ? 'credit' : 'debit')); if (i >= 0) return i; }
  if (role && ROLE_OF[role]) { const i = t.headers.findIndex(h => columnRole(h) === role); if (i >= 0) return i; }
  if (/tiers|bailleur|contributeur|donneur|beneficiaire|fournisseur/.test(fold(col.header))) { const i = t.headers.findIndex(h => /tiers|bailleur|donneur|emetteur|beneficiaire|fournisseur|contrepartie/.test(fold(h))); if (i >= 0) return i; }
  const g = proposeColumn(col.header, t.headers, t.rows); return g.source ?? -1;
}
const COLLECT = `Tu es l'Enhanced Auditor. Chaque document ci-joint est UNE opération (avis de crédit, reçu, bordereau, ordre de virement). Pour chacun,
donne la ligne à écrire dans la feuille, une valeur par colonne demandée, recopiée EXACTEMENT du document (montant, date, référence, donneur
d'ordre / bénéficiaire, libellé). Si une valeur n'est pas dans le document : null. N'invente rien. Ne retiens que les opérations qui
répondent à ce que la feuille attend (titre et consignes).
JSON STRICT : {"rows":[{"document_id":"…","values":{"A":"…","B":"…"},"quote":"passage du document qui porte le montant"}]}`;
async function collectRows(ctx, plan, rf, body, account, d, org, mission, code) {
  const { u } = ctx, ids = rf.document_ids?.length ? rf.document_ids : [rf.document_id];
  const rows = [], provenance = [], report = { which: rf.which, documents: ids.length, read: 0, rows: 0, pending_pdfs: [], unreadable: [], to_check: [] };
  if (rf.which === 'one_per_document') {
    const read = d.fileForAI || (await import('./agent-outputs.js')).fileForAI;
    const docs = [];
    for (const id of ids.slice(0, 20)) { try { docs.push({ ...(await read(id, { maxChars: 12000 })), id }); } catch { report.unreadable.push(ctx.docs.find(x => x.id === id)?.name || id); } }
    report.read = docs.length;
    if (docs.length) {
      const cols = u.columns.map(c => ({ col: c.col, header: c.header, what_the_tests_do: c.says }));
      const payloadC = { sheet: { name: u.sheet, title: u.title, instructions: u.instructions }, columns: cols, documents: docs.filter(x => !x.visual).map(x => ({ document_id: x.id, name: x.name, text: String(x.text || '').slice(0, 12000) })), scans: docs.filter(x => x.visual).map(x => ({ document_id: x.id, name: x.name })) };
      const input = fitJson(payloadC, 90000, [o => o.documents.forEach(x => { x.text = x.text.slice(0, Math.max(2000, Math.floor(80000 / Math.max(1, o.documents.length)))); })]);
      const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: COLLECT + '\n\n' + PROJECT_AUDIT_METHOD, input, files: docs.filter(x => x.visual), maxTokens: 6000 });
      const out = parseJsonLoose(r?.text ?? r) || {};
      const { digitStream, amountFound, parseNumber } = await import('./workfile-sources.js');
      for (const x of Array.isArray(out.rows) ? out.rows : []) {
        const doc = docs.find(y => y.id === String(x.document_id || '')); if (!doc) continue;
        const values = x.values || {}, stream = digitStream(doc.text || ''), body = fold(doc.text || '');
        const row = u.columns.map(c => (values[c.col] == null || values[c.col] === '' ? null : values[c.col]));
        // Code check: on a text document every amount and text must be in it; a scan is a reading to re-read (said).
        const bad = doc.visual ? [] : row.map((v, i) => ({ v, c: u.columns[i] })).filter(({ v, c }) => v != null && (c.amount ? !(parseNumber(v) != null && amountFound(parseNumber(v), stream)) : typeof v === 'string' && v.length > 3 && !body.includes(fold(v).slice(0, 40))));
        if (bad.length) { report.to_check.push(doc.name + ' : ' + bad.map(b => b.c.header).join(', ') + ' non retrouvé(s) dans le document'); continue; }
        u.columns.forEach((c, i) => { if (c.amount && row[i] != null && parseNumber(row[i]) != null) row[i] = parseNumber(row[i]); });
        if (doc.visual) report.to_check.push(doc.name + ' : lu sur un scan, à relire');
        rows.push(row); provenance.push(u.columns.map(() => ({ file_id: doc.id, name: doc.name, heading: 'document entier', line: 0 })));
      }
    }
  } else {
    const tables = await readTables(ctx, ids.map(id => ({ document_id: id })), body, account, d, org, mission, code);
    for (const id of ids) {
      const t0 = tables[id];
      if (!t0 || t0.needs_extraction) { report.pending_pdfs.push(id); continue; }
      if (t0.error || !t0.headers) { report.unreadable.push((ctx.docs.find(x => x.id === id)?.name || id) + (t0?.error ? ' (' + t0.error + ')' : '')); continue; }
      const t = { ...t0, id }; report.read++;
      const idx = u.columns.map(c => headingIn(t, c, plan, rf.which));
      const credit = t.headers.findIndex(h => columnRole(h) === (rf.which === 'debits' ? 'debit' : 'credit'));
      for (const r of t.rows) {
        if (r.some(v => typeof v === 'string' && TOTAL.test(fold(v)))) continue;
        if ((rf.which === 'credits' || rf.which === 'debits') && !(credit >= 0 && Number(numberOf(r[credit])) > 0)) continue;
        const row = idx.map(i => (i >= 0 ? (r[i] ?? null) : null));
        if (!row.some(v => v != null && v !== '')) continue;
        rows.push(row); provenance.push(idx.map(i => (i >= 0 ? { file_id: t.via || id, name: t.name, heading: t.headers[i], line: t.rows.indexOf(r) + t.first } : null)));
      }
    }
  }
  // Computed columns, as in the other mode.
  for (let k = 0; k < rows.length; k++) plan.filter(p => p.compute).forEach(p => {
    const [x, y] = p.compute.split('-'), ix = u.columns.findIndex(c => c.col === x), iy = u.columns.findIndex(c => c.col === y), at = u.columns.findIndex(c => c.col === p.col);
    const a = numberOf(rows[k][ix]), b = numberOf(rows[k][iy]); if (at >= 0 && a != null && b != null && rows[k][ix] != null && rows[k][iy] != null) rows[k][at] = Math.round((a - b) * 100) / 100;
  });
  report.rows = rows.length;
  const headers = u.columns.map(c => c.header || c.col);
  const fingerprint = createHash('sha256').update(JSON.stringify([ids, rf.which, rows])).digest('hex');
  const table = rows.length ? { meta: { id: provenance[0]?.find(Boolean)?.file_id || ids[0], name: 'Pièces de la mission → ' + ctx.sheet, source_sheet: null, modifiedTime: null, fingerprint }, rows: [headers, ...rows], header_row: 0, provenance } : null;
  return { built: { public: { rows: rows.length, columns: headers, sample: rows.slice(0, 6), unmatched: {}, rows_from: ids.length + ' document(s)' }, table, driver: table?.meta.id || null },
    report, cache: rf.which === 'one_per_document' && rows.length ? { sheet: ctx.sheet, ids, rows, provenance, fingerprint } : null };
}
// What the AI read in one-operation documents is kept server-side with the plan: « Oui, remplis » writes exactly what was shown.
async function saveCollected(org, mission, code, ctx, cache, account, d) {
  const { patch } = await import('./procedure-work.js'), { rest } = await import('./supabase.js');
  const keep = (ctx.view.work?.walkthrough || []).filter(r => !(r.kind === 'sheet-plan-rows' && r.sheet === cache.sheet));
  await (d.save || patch)(org, ctx.view.work, { walkthrough: [...keep, { kind: 'sheet-plan-rows', ...cache, at: new Date().toISOString() }] }, account, d.fetchRows || rest);
}

// The table the import writes: one column per column of the sheet (titles = the sheet's titles), rows from the document that defines the
// rows, the other documents aligned on them. Each cell keeps where it comes from.
async function buildCombined(ctx, plan, tables, opts = {}) {
  const { u } = ctx, glMap = opts.glMap || null;
  // The account of a line: its own code when the GL has it; else what the AI said for its label (opts.accountMap, checked against the GL);
  // only without an AI answer, the closest GL title (secours). A dry run (opts.labels) collects the labels to ask the AI about.
  const acct = (label, code) => {
    if (!glMap) return null;
    const c = String(code ?? '').trim(); if (c && glMap.numbers.has(c)) return { number: c, how: 'code' };
    const k = key(label); if (!k) return null;
    if (opts.labels) opts.labels.add(String(label).trim().slice(0, 120));
    if (opts.accountMap && Object.prototype.hasOwnProperty.call(opts.accountMap, k)) return opts.accountMap[k];
    const f = accountOf(label, code, glMap); return f ? { ...f, how: f.how + (opts.accountMap ? '' : ', sans l’IA') } : null;
  };
  const filled = plan.filter(p => p.document_id && p.source_index != null && tables[p.document_id]?.headers && !tables[p.document_id].error);
  if (!filled.length) return { public: { rows: 0, columns: [], unmatched: {}, sample: [] }, table: null };
  const asked = opts.rowsFrom && filled.some(p => p.document_id === opts.rowsFrom.document_id) ? opts.rowsFrom.document_id : null;
  const drv = asked || filled.find(p => p.col === u.rows_from)?.document_id || filled.find(p => u.columns.find(c => c.col === p.col)?.key)?.document_id || filled[0].document_id;
  let driver = { ...tables[drv], id: drv };
  // « Il prend le sous-total dans le PTBA » : the lines of the sheet are the document's sub-totals (the « Sous-total » words removed).
  // Méthode du cabinet (Paul) : a sheet kept BY CATEGORY takes the budget's categories — when the code proves them by their sums, even if the
  // AI did not say "subtotals".
  // the sheet is BY CATEGORY only when its category column is the one that defines its lines (D2), not when it is one column among others (D1)
  const categoryCol = u.columns.find(c => c.col === u.rows_from && /categor|rubrique|ligne budgetaire|poste budgetaire/.test(fold(c.header)));
  const proven = categoryCol && !collectMode(opts.rowsFrom) && opts.rowsFrom?.which !== 'subtotals' ? tableStructure(driver.headers, driver.rows) : null;
  const byMethod = proven && proven.categories.length >= 2;
  if ((opts.rowsFrom?.which === 'subtotals' && asked) || byMethod) {
    // The category lines are PROVED by arithmetic (their amount = the sum of the lines they cover), whatever words the client used; the
    // word « Sous-total » is only a second way. None found = said, never the detail lines silently instead.
    const st = proven || tableStructure(driver.headers, driver.rows);
    const proved = st.categories.map(c => driver.rows[c.row]);
    const sub = proved.length ? proved : driver.rows.filter(r => r.some(v => typeof v === 'string' && SUBTOTAL.test(fold(v)) && !/^total general|^total$/.test(fold(v))));
    if (!sub.length) return { public: { rows: 0, columns: [], unmatched: {}, sample: [], problem: 'aucune ligne de catégorie trouvée dans « ' + (driver.name || 'la pièce') + ' » : aucune ligne n’est la somme des lignes qu’elle couvre' }, table: null };
    driver = { ...driver, structure: st, rows: sub.map(r => Object.assign(r.map(v => (typeof v === 'string' && SUBTOTAL.test(fold(v)) ? v.replace(/^\s*(sous[- ]?total|total)\s*(cat[ée]gorie|rubrique|ligne|poste|compte|chapitre)?\s*[:\-–]?\s*/i, '').trim() : v)), { orig: r })), subtotals: proved.length ? 'somme' : 'mot' };
  }
  const others = [...new Set(filled.map(p => p.document_id))].filter(x => x !== drv).map(x => ({ ...tables[x], id: x }));
  // With a grand livre: each table gets the account number of its lines (its code, or its label found in the GL), and the tables are
  // aligned on it first — the PTBA's labels and the TEB's codes meet through the GL.
  const withAccounts = t => {
    if (!glMap) return t;
    // a column of account numbers (« Compte », « N° compte ») is the line's code as much as a « Code » column
    const codeCol = [t.headers.findIndex(h => columnRole(h) === 'account'), t.headers.findIndex(h => columnConcept(h) === 'code')].find(i => i >= 0) ?? -1,
      // the line's label: a column titled like one (libellé, désignation, poste…), else the column that holds text on most lines
      labelCol = (() => { const i = t.headers.findIndex(h => columnConcept(h) === 'label'); if (i >= 0) return i; let best = -1, n = 0; t.headers.forEach((h, k) => { if (k === codeCol) return; const c = t.rows.filter(r => typeof r[k] === 'string' && /[a-z]{3}/i.test(r[k])).length; if (c > n) { n = c; best = k; } }); return best; })();
    const acc = t.rows.map(r => acct(labelCol >= 0 ? r[labelCol] : null, codeCol >= 0 ? r[codeCol] : null)?.number || null);
    return { ...t, headers: [...t.headers, 'N° de compte (GL)'], rows: t.rows.map((r, i) => Object.assign([...r, acc[i]], { orig: r.orig || r })), accounts: true };
  };
  const D2 = withAccounts(driver), O2 = others.map(withAccounts);
  const { joined, unmatched } = alignRows(D2, O2);
  const headers = u.columns.map(c => c.header || c.col);
  const rows = [], provenance = [];
  let nonNumeric = 0, titlesSkipped = 0; const noAccount = [];
  const idPrefix = (String(tables[drv]?.name || '').match(/(19|20)\d\d/)?.[0] || '') ? String(tables[drv].name).match(/(19|20)\d\d/)[0] + '-' : '';
  for (const j of joined) {
    const row = [], prov = [];
    for (const c of u.columns) {
      const p = filled.find(x => x.col === c.col);
      const src = !p ? null : p.document_id === drv ? j.row : j.from[p.document_id];
      if (src && p.minus_index != null) { const a = numberOf(src[p.source_index]), b = numberOf(src[p.minus_index]); row.push(a == null || b == null ? null : Math.round((a - b) * 100) / 100); }
      else if (src && p.account_from_gl && glMap) { const n = src[src.length - 1]; row.push(n || null); }   // the account number found in the GL
      else row.push(src ? (src[p.source_index] ?? null) : null);
      const t = p ? tables[p.document_id] : null;
      prov.push(src && t ? { file_id: t.via || p.document_id, name: t.name, heading: p.heading, line: t.rows.indexOf(src.orig || src) + t.first } : null);
    }
    // The category column, when no document was given for it: the account number found in the GL for the category's label (Paul : « catégorie
    // = numéro de compte »), else the category's own label — said in its provenance.
    if (categoryCol && driver.subtotals && !filled.some(x => x.col === categoryCol.col)) {
      const at = u.columns.indexOf(categoryCol), st = driver.structure, lab = st && st.label_index >= 0 ? (j.row.orig || j.row)[st.label_index] : null;
      const text = String(lab ?? '').replace(/^\s*(sous[- ]?total|total)\s*[:\-–]?\s*/i, '').trim();
      const acc = acct(text, null);
      if (text && row[at] == null && !acc) noAccount.push(text.slice(0, 60));
      if (text && row[at] == null) { row[at] = acc ? acc.number : text; prov[at] = { file_id: driver.via || drv, name: tables[drv]?.name, heading: acc ? 'n° de compte trouvé dans le GL (' + acc.how + ')' : 'libellé de la catégorie', line: (tables[drv]?.rows || []).indexOf(j.row.orig || j.row) + (tables[drv]?.first || 0) }; }
    }
    // The same when a document gave the category's LABEL (a budget): the account number found in the grand livre replaces it (méthode du
    // cabinet : D1 and D2 must speak the same language — the account), the label is kept when no account is found, and that is said.
    if (categoryCol && glMap && filled.some(x => x.col === categoryCol.col && !x.account_from_gl)) {
      const at = u.columns.indexOf(categoryCol), v = row[at];
      if (typeof v === 'string' && v.trim() && !/^\d{3,12}$/.test(v.trim())) { const acc = acct(v.replace(/^\s*(sous[- ]?total|total)\s*[:\-–]?\s*/i, ''), null); if (acc) { row[at] = acc.number; prov[at] = { ...(prov[at] || {}), heading: 'n° de compte trouvé dans le GL pour « ' + v.slice(0, 50) + ' » (' + acc.how + ')' }; } else noAccount.push(v.slice(0, 60)); }
    }
    // The column that DEFINES the lines for the tests (« ID ligne » : a line without it is ignored by PRJ-05, PRJ-09…) and that no document
    // gives: an identifier made from where the line comes from (document, line), so each line is counted and can be traced back.
    const idCol = u.columns.find(c => c.col === u.rows_from);
    if (idCol && idCol !== categoryCol && !filled.some(x => x.col === idCol.col)) {
      const at = u.columns.indexOf(idCol), line = (tables[drv]?.rows || []).indexOf(j.row.orig || j.row) + (tables[drv]?.first || 0);
      if (row[at] == null && line > 0) { const n = idPrefix + 'L' + line; row[at] = n; prov[at] = { file_id: driver.via || drv, name: tables[drv]?.name, heading: 'identifiant de ligne généré (ligne ' + line + ' du document)', line }; }
    }
    // An amount column only ever receives a number: a title or a word is never written there (counted, said); « 562 280 » becomes 562280.
    u.columns.forEach((c, k) => {
      if (!c.amount || row[k] == null || row[k] === '') return;
      const n = numberOf(row[k]);
      if (n == null) { row[k] = null; prov[k] = null; nonNumeric++; } else if (typeof row[k] === 'string') row[k] = n;
    });
    // A date column receives a date (« 10/01/2023 », « 2023-01-10 », an Excel day number), never a text that Excel would not sort.
    u.columns.forEach((c, k) => { if (columnRole(c.header) === 'date' && row[k] != null && !(row[k] instanceof Date)) { const dt = asDate(row[k]); if (dt) row[k] = dt; } });
    // Computed columns (« amendements = final − initial »), from the values just placed on the row.
    plan.filter(p => p.compute).forEach(p => {
      const [x, y] = p.compute.split('-'), ix = u.columns.findIndex(c => c.col === x), iy = u.columns.findIndex(c => c.col === y), at = u.columns.findIndex(c => c.col === p.col);
      const a = numberOf(row[ix]), b = numberOf(row[iy]);
      if (at >= 0 && a != null && b != null && row[ix] != null && row[iy] != null) { row[at] = Math.round((a - b) * 100) / 100; prov[at] = { file_id: prov[ix]?.file_id || null, name: 'calcul', heading: x + ' − ' + y, line: 0 }; }
    });
    // A line with no amount at all where the sheet expects amounts is a title / section heading of the document, not a line of the sheet.
    const amountCols = u.columns.map((c, k) => (c.amount && filled.some(x => x.col === c.col) ? k : -1)).filter(k => k >= 0);
    if (amountCols.length && !amountCols.some(k => row[k] != null && row[k] !== '' && numberOf(row[k]) != null)) { titlesSkipped++; continue; }
    if (row.some(v => v != null && v !== '')) { rows.push(row); provenance.push(prov); }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([filled.map(p => [p.col, p.document_id, p.heading]), Object.values(tables).map(t => t.fingerprint || t.modified || null)])).digest('hex');
  const table = { meta: { id: driver.via || drv, name: 'Pièces de la mission → ' + ctx.sheet, source_sheet: null, modifiedTime: null, fingerprint }, rows: [headers, ...rows], header_row: 0, provenance };
  const names = Object.fromEntries(Object.keys(unmatched).map(k => [tables[k]?.name || k, unmatched[k].slice(0, 8)]));
  return { public: { rows: rows.length, columns: headers, sample: rows.slice(0, 6), unmatched: names, rows_from: tables[drv]?.name || null,
    categories: driver.subtotals ? { how: driver.subtotals, count: driver.rows.length, by_method: Boolean(byMethod), without_account: noAccount } : null, titles_skipped: titlesSkipped, non_numeric_dropped: nonNumeric,
    problem: categoryCol && driver.subtotals && noAccount.length ? noAccount.length + ' catégorie(s) sans numéro de compte retrouvé dans le grand livre (' + noAccount.slice(0, 3).join(' ; ') + (noAccount.length > 3 ? '…' : '') + ') : écrites par leur libellé, le grand livre (D1) ne s’y rapportera pas tant que le compte n’est pas donné' + (glMap ? '' : ' — aucun grand livre lu pour retrouver les comptes') : undefined }, table, driver: driver.via || drv };
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
  const payload = {
    sheet: { name: u.sheet, title: u.title, instructions: u.instructions },
    columns: plan.map(p => ({ col: p.col, header: p.header, what_the_tests_do: u.columns.find(c => c.col === p.col)?.says || [], document_id: p.document_id, heading: p.heading, status: p.status, code_doubt: p.status === 'to_confirm' || p.status === 'heading_to_choose' ? p.why : null })),
    documents: used.map(id => ({ document_id: id, name: tables[id].name, headings: tables[id].headers, first_rows: tables[id].rows.slice(0, 6).map(r => r.slice(0, 20)), structure: describeStructure(tableStructure(tables[id].headers, tables[id].rows.slice(0, 3000))) })),
  };
  const input = fitJson(payload, 60000, [o => o.documents.forEach(x => { x.first_rows = x.first_rows.slice(0, 3); if (x.structure?.categories_proved_by_sum) x.structure.categories_proved_by_sum = x.structure.categories_proved_by_sum.slice(0, 15); })]);
  const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: VERIFY + '\n\n' + PROJECT_AUDIT_METHOD, input, maxTokens: 2500 });
  const out = parseJsonLoose(r?.text ?? r) || {};
  for (const v of Array.isArray(out.columns) ? out.columns : []) {
    const p = plan.find(x => x.col === v.col); if (!p) continue;
    const why = String(v.why || '').slice(0, 300);
    if (v.verdict === 'ok' && p.document_id && p.heading) Object.assign(p, { status: p.by === 'règle' ? p.status : 'sure', why: (p.why ? p.why + ' — ' : '') + 'vérifié par l’IA' + (why ? ' : ' + why : '') });
    else if (v.verdict === 'heading' && p.document_id && tables[p.document_id]?.headers) {
      const t = tables[p.document_id], i = t.headers.findIndex(h => key(h) === key(v.heading));
      if (i >= 0) Object.assign(p, { heading: t.headers[i], source_index: i, minus_index: undefined, status: 'sure', why: 'corrigé par l’IA : « ' + t.headers[i] + ' »' + (why ? ' — ' + why : '') });
      else p.why = (p.why ? p.why + ' — ' : '') + 'l’IA propose « ' + String(v.heading || '').slice(0, 80) + ' », absent du document (ignoré)';
    } else if (v.verdict === 'empty' && p.by === 'méthode') Object.assign(p, { status: 'to_confirm', why: (p.why ? p.why + ' — ' : '') + 'l’IA doute de cette colonne : ' + (why || String(v.missing || '')).slice(0, 300) });
    else if (v.verdict === 'empty') Object.assign(p, { document_id: null, document: null, heading: null, source_index: undefined, status: 'missing', by: 'ia', why: 'selon l’IA' + (why ? ' : ' + why : ''), missing: v.missing ? String(v.missing).slice(0, 160) : p.missing || null });
    else if (v.verdict === 'doubt') Object.assign(p, { status: p.document_id ? 'to_confirm' : p.status, why: (p.why ? p.why + ' — ' : '') + 'question de l’IA : ' + String(v.question || why).slice(0, 300) });
  }
  return { provider: r?.provider || 'ai', summary: out.summary ? String(out.summary).slice(0, 400) : null };
}

const publicUnderstanding = u => ({ sheet: u.sheet, first_row: u.first_row, last_row: u.last_row, title: u.title, instructions: u.instructions, tests: u.tests.map(t => ({ code: t.code, title: t.title })), pieces: u.pieces,
  columns: u.columns.map(c => ({ col: c.col, header: c.header, says: c.says, key: c.key, amount: c.amount, must_match: c.must_match })), comparisons: u.comparisons.map(k => ({ test: k.test, at: k.at, left: k.left, right: k.right })) });
const publicPlan = p => ({ compute: p.compute || null, account_from_gl: p.account_from_gl || false, pdf: p.pdf || null, col: p.col, header: p.header, document_id: p.document_id, document: p.document || null, heading: p.heading || null, headings: p.headings || null, status: p.status, why: p.why || null, missing: p.missing || null, by: p.by || null });

// « Oui, remplis » (with the person's changes): the plan is rebuilt by the server from the person's choices, the code rules applied again,
// then written by the existing import (same checks, receipt, undo). Each confirmed column is remembered in the mission's memory.
export async function acceptSheetPlan(org, mission, code, body = {}, account, d = {}) {
  if (!account?.email) throw fail('HUMAN_IDENTITY_REQUIRED');
  const ctx = await loadContext(org, mission, code, body, account, d);
  const choices = Array.isArray(body.columns) ? body.columns.slice(0, 100) : [];
  if (!choices.length) throw fail('COLUMN_MAPPING_REQUIRED', 400);
  const assignments = choices.map(c => ({ col: String(c.col), document_id: c.document_id ? String(c.document_id) : null, heading: c.heading ? String(c.heading) : null, compute: /^[A-Z]{1,3}-[A-Z]{1,3}$/.test(String(c.compute || '')) ? String(c.compute) : null, account_from_gl: c.account_from_gl === true, by: 'personne', why: 'choisi par ' + account.email }));
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
  const rfIds = [...new Set([body.rows_from?.document_id, ...(Array.isArray(body.rows_from?.document_ids) ? body.rows_from.document_ids : [])].map(x => String(x || '')).filter(id => ctx.docs.some(x => x.id === id)))].slice(0, 40);
  const rowsFrom = rfIds.length ? { document_id: rfIds[0], document_ids: rfIds, which: ['subtotals', 'credits', 'debits', 'one_per_document'].includes(body.rows_from?.which) ? body.rows_from.which : 'lines' } : null;
  const glDoc = body.gl_document_id && ctx.docs.some(x => x.id === String(body.gl_document_id)) ? String(body.gl_document_id) : null;
  const glMap = glDoc ? await ledgerAccounts(ctx, glDoc, tables, d, org, mission, code, account) : null;
  let built;
  if (rowsFrom?.which === 'one_per_document') {
    const c = (ctx.view.work?.walkthrough || []).filter(r => r.kind === 'sheet-plan-rows' && r.sheet === ctx.sheet).at(-1);
    if (!c || c.ids.join() !== rfIds.join()) throw fail('PREPARE_AGAIN');
    const headers = ctx.u.columns.map(k => k.header || k.col);
    built = { public: { rows: c.rows.length }, table: { meta: { id: c.provenance[0]?.find(Boolean)?.file_id || rfIds[0], name: 'Pièces de la mission → ' + ctx.sheet, source_sheet: null, modifiedTime: null, fingerprint: c.fingerprint }, rows: [headers, ...c.rows], header_row: 0, provenance: c.provenance }, driver: c.provenance[0]?.find(Boolean)?.file_id || rfIds[0] };
  } else if (collectMode(rowsFrom)) built = (await collectRows(ctx, plan, rowsFrom, { extract: false }, account, d, org, mission, code)).built;
  else {
    // the accounts the person saw (proposed by the AI), kept only when they exist in the GL
    let accountMap = null;
    if (glMap && Array.isArray(body.account_map)) { accountMap = {}; for (const x of body.account_map.slice(0, 400)) { const n = x?.number != null ? String(x.number).trim() : null; if (x?.label) accountMap[key(x.label)] = n && glMap.numbers.has(n) ? { number: n, how: 'selon l’IA, vu par ' + account.email } : null; } }
    built = await buildCombined(ctx, plan, tables, { rowsFrom, glMap, accountMap });
  }
  if (!built.table || !built.public.rows) throw fail('POPULATION_EMPTY');
  // every column that received values: from a document, computed, or made by the code (line identifier, category from the GL)
  const hasValues = i => built.table.rows.slice(1).some(r => r[i] != null && r[i] !== '');
  const cols = ctx.u.columns.map((c, i) => ({ c, i })).filter(({ c, i }) => collectMode(rowsFrom) ? hasValues(i) : (plan.find(p => p.col === c.col)?.document_id || plan.find(p => p.col === c.col)?.compute || hasValues(i)));
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
  // « Oui, remplis » was the person's approval of these exact cells, given BEFORE the write: once they are written and read back, that same
  // approval closes the receipt — otherwise the next sheet (D2 after D1) was refused with « confirmation humaine requise ».
  let confirmed = false;
  if (r?.verified && r.plan_id) { try { await (d.review || (await import('./workpaper-dialogue.js')).reviewWorkpaper)(org, mission, code, { plan_id: r.plan_id, decision: 'confirm', note: 'Remplissage de ' + ctx.sheet + ' approuvé avant écriture (« Oui, remplis »)' }, account, d); confirmed = true; } catch { confirmed = false; } }
  // What was validated becomes the RECIPE of this sheet of this working-file model, for the next missions (families and meanings, no data).
  let learned = false;
  if (r?.verified) {
    try {
      const fr = await import('./fill-recipes.js'), profiles = {}; for (const x of ctx.docs) if (x.profile) profiles[x.id] = x.profile;
      await (d.saveRecipe || fr.saveRecipe)(ctx.map.key, fr.recipeFrom({ sheet: ctx.sheet, u: ctx.u, plan, rowsFrom, glDoc, profiles }, account), d);
      learned = true;
    } catch { learned = false; }
  }
  return { ...r, confirmed, learned, unmatched: built.public.unmatched, filled: plan.filter(x => x.document_id).map(x => ({ col: x.col, header: x.header, document: x.document, heading: x.heading })), left_empty: plan.filter(x => !x.document_id).map(x => ({ col: x.col, header: x.header })) };
}
