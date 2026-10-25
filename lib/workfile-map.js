// La carte du working file (Paul, 2026-10-24 : « l'interface et le travail se mettent en place en fonction du working
// file ; même si on change le working file demain, il garde la même logique »).
//
// Lecture STRUCTURELLE d'un classeur, par le code, sans IA : AUDIT_META, rôle de chaque feuille, tableaux et leurs
// en-têtes, rôle de chaque colonne (saisie / calcul / jugement / clé / résultat) déduit des couleurs, des formules et
// des listes déroulantes, dépendances entre colonnes et entre feuilles, capacités des tableaux, programme, risques,
// pièces (PBC) par test, ordre de travail du guide. Rien n'est écrit, rien n'est envoyé à une IA : ce module ne fait
// que lire. Ce qu'il ne peut pas déduire devient une QUESTION (jamais une supposition).
//
// La carte est la même forme pour tout modèle ; seul son contenu change. Les écrans et les écritures pourront s'en
// servir au lieu de deviner les colonnes chacun de leur côté.

import crypto from 'node:crypto';
import { yellowInput } from './workbook-inputs.js';
import { classifySheet } from './working-file-understanding.js';

export const MAP_VERSION = 1;

const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const cut = (v, n = 300) => String(v ?? '').trim().slice(0, n);

export function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return String(value);
  if (value.result != null) return cellText(value.result);
  if (value.richText) return value.richText.map(x => x?.text || '').join('');
  if (value.text != null) return cellText(value.text);
  return '';
}

export function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
export function colNumber(l) { let n = 0; for (const ch of String(l).toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

function formulaOf(cell) {
  const v = cell?.value;
  if (cell?.formula) return String(cell.formula);
  if (v && typeof v === 'object' && (v.formula || v.sharedFormula)) return String(v.formula || cell.formula || '');
  return '';
}
const hasFormula = cell => !!formulaOf(cell) || !!(cell?.value && typeof cell.value === 'object' && cell.value.sharedFormula);

function rgbOf(cell) {
  const f = cell?.fill;
  if (!f || f.type !== 'pattern' || f.pattern !== 'solid') return null;
  const rgb = String(f.fgColor?.argb || '').slice(-6);
  return /^[0-9a-f]{6}$/i.test(rgb) ? rgb.toUpperCase() : null;
}
// The visual convention of the template, read from the cell itself (never from its name).
export function fillKind(cell) {
  const rgb = rgbOf(cell);
  if (!rgb || rgb === 'FFFFFF') return 'none';
  if (yellowInput(cell)) return 'yellow';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(rgb.slice(i, i + 2), 16));
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum < 0.6) return 'header';
  if (Math.max(r, g, b) - Math.min(r, g, b) <= 14) return 'grey';
  return 'tint:' + rgb;
}

const QUOTED = /"(?:[^"]|"")*"/g;
const CROSS = /(?:'((?:[^']|'')+)'|([A-Za-z0-9_.]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;
const LOCAL = /(^|[^A-Za-z0-9_!'$.:])\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(])/g;

// References of one formula: other sheets (with their columns) and columns of the same sheet.
export function formulaRefs(formula) {
  const f = String(formula || '');
  const literals = (f.match(QUOTED) || []).map(s => s.slice(1, -1).replace(/""/g, '"'));
  const noStrings = f.replace(QUOTED, '""');
  const sheets = [];
  const stripped = noStrings.replace(CROSS, (m, q, plain, c1, r1, c2) => {
    const name = (q || plain || '').replace(/''/g, "'");
    sheets.push({ sheet: name, from: c1, to: c2 || c1, row: Number(r1) });
    return ' ';
  });
  const cols = [];
  stripped.replace(LOCAL, (m, pre, c1, r1, c2) => {
    const a = colNumber(c1), b = colNumber(c2 || c1);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) cols.push({ col: colLetter(i), row: Number(r1) });
    return m;
  });
  return { sheets, cols, literals };
}

function rowStrings(ws, r, maxCol) {
  const out = [];
  const row = ws.getRow(r);
  for (let c = 1; c <= maxCol; c++) {
    const cell = row.getCell(c);
    const t = !hasFormula(cell) && typeof cell.value === 'string' ? cell.value.trim() : (cell.value?.richText ? cellText(cell.value).trim() : '');
    if (t) out.push({ c, text: t, cell });
  }
  return out;
}

const lastCol = ws => Math.min(Math.max(ws.actualColumnCount || 0, ws.columnCount || 0, 1), 80);
const lastRow = ws => Math.min(Math.max(ws.actualRowCount || 0, ws.rowCount || 0, 1), 5000);

// A row is part of a table's body when, under the header's columns, it carries a formula, an input colour or a value.
function bodyRow(ws, r, cols) {
  const row = ws.getRow(r);
  let structure = 0;
  for (const c of cols) {
    const cell = row.getCell(c);
    if (hasFormula(cell) || fillKind(cell) !== 'none' || cellText(cell.value) !== '') structure++;
  }
  return structure > 0;
}

// Header rows: at least 3 texts, written on a dark fill or in bold (the two conventions found in firms' templates).
function headerRows(ws) {
  const out = [], mc = lastCol(ws), mr = lastRow(ws);
  for (let r = 1; r <= Math.min(mr, 400); r++) {
    const s = rowStrings(ws, r, mc);
    if (s.length < 3) continue;
    const styled = s.filter(x => fillKind(x.cell) === 'header' || x.cell.font?.bold).length;
    if (styled >= Math.max(3, Math.ceil(s.length * 0.6))) out.push({ row: r, cells: s });
  }
  return out;
}

const OUTCOME = /\b(pass|exception|ok|ecart|non conforme|conforme|en cours|a faire|non commence|error|erreur|revu|signe|en attente|fait)\b/;
const RESULT_HEAD = /resultat|result|conclusion|statut|status|verdict/;
// Words that name a professional judgment whatever the sheet; « ? » counts only on a test sheet, for a column the result reads.
const JUDG_HEAD = /^conforme|(^|\s)conforme ?\?|^retenu|accept|decision|approuv|jugement|correct period|bon exercice|eligible ?\?|satisfaisant/;
// (2026-10-25) « Budget final approuvé (document) » is an AMOUNT copied from the donor's document, not the auditor's decision: an amount
// title, or one marked « (document) », without a « ? », is a fact (the TOTAL under D2 sums it).
export const DOCUMENT_FACT = h => !/\?/.test(h) && (/\(document|\(piece|\(source|selon (le )?document/.test(h) || /^(budget|montant|cout|total|valeur|engagement|credit)\b/.test(fold(h)) && !/retenu|accept|decision|jugement|conforme/.test(fold(h)));

function readTable(ws, h, names, role) {
  const cols = h.cells.map(x => x.c);
  const mr = lastRow(ws);
  const headerAt = new Set(headerRows(ws).map(x => x.row));
  let last = h.row;
  for (let r = h.row + 1; r <= mr; r++) {
    if (headerAt.has(r) || !bodyRow(ws, r, cols)) break;
    last = r;
  }
  const first = h.row + 1;
  const rows = [];
  for (let r = first; r <= last; r++) rows.push(r);
  const columns = h.cells.map(x => {
    const letter = colLetter(x.c);
    let formulas = 0, inputs = 0, values = 0, list = null, sample = '';
    const fills = {};
    for (const r of rows.slice(0, 300)) {
      const cell = ws.getRow(r).getCell(x.c);
      const k = fillKind(cell); fills[k] = (fills[k] || 0) + 1;
      if (hasFormula(cell)) { formulas++; if (!sample) sample = formulaOf(cell); }
      else if (cellText(cell.value) !== '') values++;
      if (!hasFormula(cell) && (k === 'yellow' || k.startsWith('tint:'))) inputs++;
      if (!list && cell.dataValidation?.type === 'list') list = String(cell.dataValidation.formulae?.[0] || '').replace(/^"|"$/g, '').split(',').map(s => s.trim()).filter(Boolean);
    }
    const n = Math.max(Math.min(rows.length, 300), 1);
    const fill = Object.entries(fills).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';
    const kind = formulas / n > 0.5 ? 'calc' : inputs / n > 0.5 ? 'input' : values / n > 0.5 ? 'fixed' : (fill === 'none' ? 'free' : (fill === 'grey' ? 'fixed' : 'input'));
    return { col: letter, header: cut(x.text, 160), kind, fill, list, formula: cut(sample, 400) };
  });
  // Dependencies, read on the first body row (template rows repeat the same formula).
  const byCol = Object.fromEntries(columns.map(c => [c.col, c]));
  const readsSheets = new Set();
  for (const c of columns) {
    if (c.kind !== 'calc' || !c.formula) { c.uses = []; c.reads = []; c.literals = []; continue; }
    const fr = formulaRefs(c.formula);
    c.uses = [...new Set(fr.cols.filter(x => byCol[x.col] && x.col !== c.col).map(x => x.col))];
    c.reads = [...new Set(fr.sheets.map(x => x.sheet).filter(s => s && s !== ws.name))];
    c.reads.forEach(s => readsSheets.add(s));
    c.literals = fr.literals.filter(Boolean).slice(0, 12);
    c.names = names.filter(nm => new RegExp('(^|[^A-Za-z0-9_])' + nm + '([^A-Za-z0-9_(]|$)').test(c.formula.replace(QUOTED, '""')));
  }
  // Roles: result, judgment (an input the result tests directly, with a list), key (fixed value read by the row), fact.
  for (const c of columns) {
    c.role = c.kind === 'calc' ? 'calc' : c.kind === 'input' ? 'fact' : c.kind === 'fixed' ? 'fixed' : 'free';
    if (c.kind === 'calc' && (RESULT_HEAD.test(fold(c.header)) || c.literals.some(l => OUTCOME.test(fold(l))))) c.role = 'result';
  }
  const results = columns.filter(c => c.role === 'result');
  const usedBy = col => columns.filter(c => (c.uses || []).includes(col));
  for (const c of columns) {
    if (c.kind === 'input' || c.kind === 'free') {
      const direct = results.some(r => r.uses.includes(c.col));
      const h2 = fold(c.header);
      if (JUDG_HEAD.test(h2) && !DOCUMENT_FACT(String(c.header || '').toLowerCase())) c.role = 'judgment';
      else if (direct && (c.list || (role === 'test' && /\?\s*$/.test(h2)))) c.role = 'judgment';
      else if (c.kind === 'free') c.role = 'free';
      c.feeds_result = direct;
    }
    if (c.kind === 'fixed' && usedBy(c.col).length) c.role = 'key';
    c.used_by = usedBy(c.col).map(x => x.col);
    c.writable = c.role === 'fact' || c.role === 'free';
  }
  // Rows the template already fills in its input columns: examples to replace with the person's agreement, never silently.
  const inputs = columns.filter(c => c.kind === 'input').map(c => colNumber(c.col));
  const prefilled = rows.filter(r => inputs.some(c => { const cell = ws.getRow(r).getCell(c); return !hasFormula(cell) && cellText(cell.value) !== ''; }));
  return { header_row: h.row, first_row: first, last_row: last, capacity: last >= first ? last - first + 1 : 0, columns, reads_sheets: [...readsSheets], prefilled_rows: prefilled.slice(0, 200) };
}

function auditMeta(wb) {
  const ws = wb.worksheets.find(w => fold(w.name) === 'audit_meta');
  if (!ws) return null;
  const out = {};
  ws.eachRow(row => {
    const k = cellText(row.getCell(1).value).trim(), cell = row.getCell(2);
    if (!k || k === 'AUDIT_META') return;
    out[k] = hasFormula(cell) ? (cell.value?.result != null ? cellText(cell.value.result) : null) : cellText(cell.value).trim();
  });
  return out;
}
const listOf = v => String(v || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);

export function testCode(text) {
  const m = String(text || '').toUpperCase().match(/\b([A-Z]{2,6})[-_ ]?(\d{1,2})\b/);
  return m ? `${m[1]}-${String(Number(m[2])).padStart(2, '0')}` : null;
}

// Sheets the application itself adds to the working file (preparations, step results): never the firm's own sheets.
const AGENT_MARKS = ['office manager — preparation documentaire', 'office manager — resultat d’etape', "office manager — resultat d'etape"];
function sheetRole(ws, meta) {
  const n = ws.name;
  if (fold(n) === 'audit_meta') return 'meta';
  if (AGENT_MARKS.includes(fold(cellText(ws.getCell('A1').value)))) return 'agent';
  if (meta) {
    if (listOf(meta.Test_sheets).includes(n)) return 'test';
    if (listOf(meta.Data_sheets).includes(n)) return 'data';
  }
  if (ws.state && ws.state !== 'visible' && /list/i.test(n)) return 'lists';
  const r = classifySheet(n);
  if (r === 'population') return 'data';
  if (r === 'other' && /\blead|leadsheet|lead schedule/i.test(n)) return 'lead';
  if (r === 'other' && /\b(tb|trial balance|balance)\b/i.test(fold(n))) return 'data';
  if (r === 'other' && /^instructions?$/i.test(fold(n))) return 'guide';
  if (r === 'other' && /\brequests?\b/i.test(fold(n))) return 'pbc';
  if (r === 'other' && /sign[- ]?off/i.test(fold(n))) return 'signoff';
  return r || 'other';
}

const pick = (cols, re) => cols.find(c => re.test(fold(c.header)))?.col || null;
function tableRows(ws, t) {
  const out = [];
  for (let r = t.first_row; r <= t.last_row; r++) {
    const row = ws.getRow(r), o = { _row: r };
    for (const c of t.columns) { const cell = row.getCell(colNumber(c.col)); o[c.col] = hasFormula(cell) ? (cell.value?.result != null ? cellText(cell.value.result) : null) : cellText(cell.value).trim(); }
    out.push(o);
  }
  return out;
}

function guideOrder(ws, sheets) {
  if (!ws) return { order: [], source: null };
  const names = sheets.map(s => s.name).filter(n => n !== ws.name).sort((a, b) => b.length - a.length);
  const tests = sheets.filter(s => s.role === 'test').map(s => s.name);
  const order = [];
  const add = n => { if (n && !order.includes(n)) order.push(n); };
  ws.eachRow(row => {
    const text = (row.values || []).slice(1).map(cellText).join(' ');
    if (!text.trim()) return;
    let rest = text; const found = [];
    for (const n of names) { const i = rest.indexOf(n); if (i >= 0) { found.push([i, n]); rest = rest.slice(0, i) + ' '.repeat(n.length) + rest.slice(i + n.length); } }
    if (found.length && found.some(([, n]) => tests.includes(n))) { const firstTest = Math.min(...found.filter(([, n]) => tests.includes(n)).map(([i]) => i)); found.push([firstTest, '@tests']); }
    else if (/feuilles? de test|test sheets?/i.test(text)) found.push([0, '@tests']);
    found.sort((a, b) => a[0] - b[0]).forEach(([, n]) => (n === '@tests' ? tests.forEach(add) : add(n)));
  });
  return { order, source: ws.name };
}

const FIELD_KINDS = [
  ['reviewer', /^(revu|reviewed|revise|approuv|valide par|signe par|signature|date (de )?revue|review)/],
  ['conclusion', /^conclusion (de l.?auditeur|du senior|du manager|de l.?associe)/],
  ['preparer', /^(prepare|prepared|etabli|redige)( par)?/],
  ['mission', /^(mission|engagement)/],
  ['firm', /^(cabinet|firm|auditeur externe)$/],
  ['entity', /^(entite|client|organisation|association|ong|projet audite)/],
  ['period', /^(exercice|periode|period|annee|fiscal year)/]
];
// A label (« Préparé par / date », « Mission / Engagement ID »…) in the first rows, never a table's header row, followed (same row,
// next 1-2 cells) by an input cell: empty, or yellow (the template's input colour), never a formula.
export function headerFields(ws, headerRows = new Set()) {
  const out = [];
  for (let r = 1; r <= 20; r++) {
    if (headerRows.has(r)) continue;
    const row = ws.getRow(r);
    for (let c = 1; c <= 6; c++) {
      const label = cut(cellText(row.getCell(c).value), 80);
      if (!label || label.length > 60) continue;
      const kind = (FIELD_KINDS.find(([, re]) => re.test(fold(label))) || [])[0];
      if (!kind) continue;
      for (let k = c + 1; k <= c + 2; k++) {
        const cell = row.getCell(k);
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) continue;
        const v = cell.value;
        if (v && typeof v === 'object' && (v.formula || v.sharedFormula)) break;
        const t = cellText(v).trim();
        if (t && fillKind(cell) !== 'yellow') break;
        out.push({ kind, label, address: colLetter(k) + r, value: t, writable: !['reviewer', 'conclusion'].includes(kind), with_date: /date/i.test(label) });
        break;
      }
    }
  }
  return out;
}

// Read the whole workbook into one map. `workbook` is an ExcelJS workbook already loaded.
export function mapWorkingFile(workbook, options = {}) {
  const meta = auditMeta(workbook);
  const names = (workbook.definedNames?.model || []).map(n => n.name).filter(n => n && !n.startsWith('_xlnm'));
  const questions = [], warnings = [];
  const sheets = workbook.worksheets.map(ws => {
    const role = sheetRole(ws, meta);
    const s = { name: ws.name, role, hidden: !!ws.state && ws.state !== 'visible', title: cut(cellText(ws.getCell('A1').value), 200), test_code: role === 'test' ? testCode(ws.name) : null };
    if (role === 'meta' || role === 'lists' || role === 'agent') return s;
    const intro = [];
    for (let r = 2; r <= 4; r++) { const t = cut(cellText(ws.getCell(r, 1).value), 600); if (t) intro.push({ row: r, text: t }); }
    s.instructions = intro;
    const tables = headerRows(ws).map(h => readTable(ws, h, names, role)).filter(t => t.capacity > 0);
    s.tables = tables;
    s.main = tables.reduce((best, t, i) => (best < 0 || t.capacity > tables[best].capacity ? i : best), -1);
    const params = [];
    ws.eachRow((row, r) => { if (r > 30 || params.length) return; if (/^param/i.test(fold(cellText(row.getCell(1).value)))) params.push({ row: r, cells: (row.values || []).slice(2).map(v => (v && typeof v === 'object' && v.formula ? '=' + v.formula : cellText(v))).map(x => cut(x, 300)).filter(Boolean) }); });
    if (params.length) s.params = params[0];
    // Identity fields above the work (« Préparé par / date », « Mission », « Entité auditée », « Exercice »…): a label, and the empty
    // cell next to it. What the application already knows goes there; « Revu par » / signatures are never the agent's.
    const fields = headerFields(ws, new Set(tables.map(t => t.header_row)));
    if (fields.length) s.fields = fields;
    if (role === 'test') {
      const main = tables[s.main];
      if (!main) questions.push({ sheet: ws.name, question: 'Je ne trouve pas le tableau de travail de cette feuille de test : où commence-t-il ?' });
      else if (!main.columns.some(c => c.role === 'result')) questions.push({ sheet: ws.name, question: 'Quelle colonne donne le résultat de chaque élément ?' });
      else if (!main.columns.some(c => c.role === 'judgment') && main.columns.some(c => c.feeds_result && c.role === 'fact'))
        questions.push({ sheet: ws.name, question: 'Ces colonnes alimentent le résultat : ' + main.columns.filter(c => c.feeds_result && c.role === 'fact').map(c => c.col + ' « ' + c.header + ' »').join(', ') + '. Sont-elles un jugement de l’auditeur ?' });
    }
    return s;
  });
  const bySheet = Object.fromEntries(sheets.map(s => [s.name, s]));
  const main = s => (s?.tables && s.main >= 0 ? s.tables[s.main] : null);

  // Programme (tests, type, activation).
  const progSheet = sheets.find(s => s.role === 'programme');
  const programme = [];
  if (progSheet && main(progSheet)) {
    const t = main(progSheet), ws = workbook.getWorksheet(progSheet.name), cols = t.columns;
    const id = pick(cols, /^(test id|code|id|ref)/) || cols[0].col, name = pick(cols, /^nom|^name|procedure|libelle/), type = pick(cols, /^type/), cond = pick(cols, /condition/),
      level = pick(cols, /^niveau|^level/), act = pick(cols, /activ|^active|applicable|selection/), sheet = pick(cols, /^feuille|^sheet/), assertions = pick(cols, /^assertion/), risks = pick(cols, /risque|risk/);
    for (const r of tableRows(ws, t)) {
      const code = testCode(r[id]); if (!code) continue;
      programme.push({ code, name: r[name] || '', type: r[type] || '', condition: r[cond] || '', level: r[level] || '', activated: act ? (r[act] ?? null) : null,
        sheet: (r[sheet] || '').replace(/^[→>\s]+/, '') || (bySheet[code] ? code : null), assertions: r[assertions] || '', risks: r[risks] || '' });
    }
  }

  // Risks and the risk ↔ test matrix.
  const riskSheet = sheets.find(s => s.role === 'risks');
  const risks = [], riskMatrix = [];
  if (riskSheet) {
    const ws = workbook.getWorksheet(riskSheet.name);
    for (const t of riskSheet.tables || []) {
      const rc = pick(t.columns, /risk id|risque id|^risque$|^risk$|^id/), tc = pick(t.columns, /^test id|^test$|^procedure/);
      if (!rc) continue;
      const rows = tableRows(ws, t).filter(r => /\b[A-Z]{2,6}-?R\d+\b/i.test(r[rc] || '') || /^R\d+/i.test(r[rc] || ''));
      if (tc) rows.forEach(r => riskMatrix.push({ risk: r[rc], test: testCode(r[tc]), coverage: r[pick(t.columns, /coverage|couverture/)] || '' }));
      else { const d = pick(t.columns, /^risque|^risk \(|description|libelle/) || t.columns[1]?.col, a = pick(t.columns, /assertion/), p = pick(t.columns, /primary|principal/);
        rows.forEach(r => risks.push({ id: r[rc], text: r[d] || '', assertion: r[a] || '', primary_tests: (r[p] || '').split(/[,;\s]+/).map(testCode).filter(Boolean) })); }
    }
  }

  // Pieces (PBC) and the test ↔ PBC matrix.
  const pbcSheet = sheets.find(s => s.role === 'pbc');
  const pbcItems = [], pbcMatrix = [];
  if (pbcSheet) {
    const ws = workbook.getWorksheet(pbcSheet.name);
    for (const t of pbcSheet.tables || []) {
      const pc = pick(t.columns, /pbc id|^pbc$|^ref|^id|request/), tc = pick(t.columns, /^test id|^test$/);
      if (!pc) continue;
      const rows = tableRows(ws, t).filter(r => (r[pc] || '').trim());
      if (tc) rows.forEach(r => pbcMatrix.push({ test: testCode(r[tc]), pbc: r[pc], required: !/option/i.test(r[pick(t.columns, /requis|required|optionnel/)] || ''), purpose: r[pick(t.columns, /finalit|purpose|usage/)] || '' }));
      else rows.forEach(r => pbcItems.push({ id: r[pc], name: r[pick(t.columns, /^nom|^name|description|document/)] || '', type: r[pick(t.columns, /^type/)] || '',
        expected_rule: r[pick(t.columns, /regle|rule/)] || '', tests: (r[pick(t.columns, /tests? de ce|^tests?$|used by/)] || '').split(/[,;]+/).map(testCode).filter(Boolean),
        expected: r[pick(t.columns, /nombre attendu|expected/)] ?? null, received: r[pick(t.columns, /nombre recu|received/)] ?? null, status: r[pick(t.columns, /^statut|^status/)] ?? null }));
    }
  }

  // Per test: the sheet, its form (columns by role), its pieces, its risks, its population, its capacity.
  const tests = sheets.filter(s => s.role === 'test').map(s => {
    const t = main(s), code = s.test_code;
    const p = programme.find(x => x.code === code) || null;
    const roleCols = role => (t?.columns || []).filter(c => c.role === role).map(c => c.col);
    return { code, sheet: s.name, programme: p, capacity: t?.capacity || 0, header_row: t?.header_row || null, first_row: t?.first_row || null,
      reads: t?.reads_sheets || [], result: roleCols('result'), judgment: roleCols('judgment'), facts: roleCols('fact'), keys: roleCols('key'), calc: roleCols('calc'),
      pbc_required: pbcMatrix.filter(x => x.test === code && x.required).map(x => x.pbc), pbc_optional: pbcMatrix.filter(x => x.test === code && !x.required).map(x => x.pbc),
      risks: riskMatrix.filter(x => x.test === code).map(x => ({ risk: x.risk, coverage: x.coverage })) };
  });

  const guide = guideOrder(workbook.getWorksheet(sheets.find(s => s.role === 'guide')?.name), sheets);
  const guideName = sheets.find(s => s.role === 'guide')?.name;
  const order = guideName ? [guideName, ...guide.order.filter(n => n !== guideName)] : [...guide.order];
  sheets.filter(s => !['meta', 'lists', 'agent'].includes(s.role) && !order.includes(s.name)).forEach(s => order.push(s.name));
  if (!guide.order.length) questions.push({ sheet: null, question: 'Je ne trouve pas d’ordre de travail dans le fichier : dans quel ordre faut-il remplir les feuilles ?' });
  if (!meta) warnings.push('NO_AUDIT_META');
  if (!workbook.worksheets.some(ws => ws.eachRow && hasCached(ws))) warnings.push('FORMULA_RESULTS_NOT_CACHED');

  const shape = sheets.map(s => s.name + ':' + (main(s)?.columns || []).map(c => fold(c.header)).join('|')).join('\n');
  const fingerprint = crypto.createHash('sha256').update(shape).digest('hex').slice(0, 16);
  const template = meta?.Template_ID
    ? { id: meta.Template_ID, version: meta.Template_version || null, family: meta.Methodology_family || null, cycle: meta.Cycle_ID || null, source: 'AUDIT_META' }
    : { id: null, version: null, family: null, cycle: null, source: 'structure' };
  return {
    map_version: MAP_VERSION, template, fingerprint, key: (template.id ? template.id + '@' + (template.version || '?') : 'shape:' + fingerprint),
    file: options.file || null, read_at: options.now || new Date().toISOString(),
    meta, defined_names: names, order, order_source: guide.source,
    sheets, programme, risks, risk_matrix: riskMatrix, pbc: { items: pbcItems, matrix: pbcMatrix }, tests,
    questions, warnings, validated: null
  };
}

function hasCached(ws) {
  let found = false;
  ws.eachRow((row, r) => { if (found || r > 60) return; row.eachCell(cell => { if (cell.value && typeof cell.value === 'object' && cell.value.formula && cell.value.result != null) found = true; }); });
  return found;
}

// The role of one column of one sheet, for whoever writes in the file (screen, import, agent).
export function columnRole(map, sheetName, col) {
  const s = (map?.sheets || []).find(x => x.name === sheetName);
  for (const t of s?.tables || []) { const c = t.columns.find(x => x.col === String(col).toUpperCase()); if (c) return c; }
  return null;
}

// Can a value proposed by the application (or an agent) go into this cell? Only facts / free inputs, inside a table body.
export function mayWrite(map, sheetName, address) {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(String(address).toUpperCase());
  if (!m) return { ok: false, reason: 'BAD_ADDRESS' };
  const s = (map?.sheets || []).find(x => x.name === sheetName);
  const f = (s?.fields || []).find(x => x.address === m[1] + m[2]);
  if (f) return f.writable ? { ok: true, field: f } : { ok: false, reason: f.kind === 'conclusion' ? 'JUDGMENT_OF_THE_AUDITOR' : 'REVIEWER_FIELD', field: f };
  const t = (s?.tables || []).find(x => Number(m[2]) >= x.first_row && Number(m[2]) <= x.last_row && x.columns.some(c => c.col === m[1]));
  if (!t) return { ok: false, reason: 'OUTSIDE_A_TABLE' };
  const c = t.columns.find(x => x.col === m[1]);
  if (c.role === 'judgment') return { ok: false, reason: 'JUDGMENT_OF_THE_AUDITOR', column: c };
  if (c.role === 'key') return { ok: false, reason: 'KEY_COLUMN', column: c };
  if (['calc', 'result'].includes(c.role)) return { ok: false, reason: 'CALCULATED', column: c };
  if (c.role === 'fixed') return { ok: false, reason: 'TEMPLATE_VALUE', column: c };
  return { ok: true, column: c };
}

// A short view for the screen and for the agent's context (no cell values, no client data).
export function mapSummary(map) {
  return {
    key: map.key, template: map.template, order: map.order, warnings: map.warnings, questions: map.questions,
    agent_sheets: map.sheets.filter(s => s.role === 'agent').map(s => s.name),
    sheets: map.sheets.filter(s => !['meta', 'lists', 'agent'].includes(s.role)).map(s => ({ name: s.name, role: s.role, title: s.title, capacity: s.main >= 0 ? s.tables[s.main].capacity : 0 })),
    tests: map.tests.map(t => ({ code: t.code, sheet: t.sheet, activated: t.programme?.activated ?? null, capacity: t.capacity, facts: t.facts, judgment: t.judgment, result: t.result, keys: t.keys, pbc_required: t.pbc_required, reads: t.reads }))
  };
}
