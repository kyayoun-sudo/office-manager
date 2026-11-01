// LES YEUX ET LES MAINS DE L'IA SUR UN GROS TABLEAU (Paul, 2026-11-01 : « un GL de 100 000 lignes : on n'envoie pas tout à l'IA ; le code lui
// montre la structure, des extraits, lui permet de chercher, de demander certaines lignes ou certains comptes, de faire des calculs, puis de
// revenir chercher d'autres parties »). L'IA décide quoi chercher ; le code lit, filtre, additionne et rend une réponse BORNÉE avec les vrais
// numéros de ligne et lettres de colonne du fichier. Rien n'est écrit ici : lecture seule.
//
// Quatre demandes, toutes sur un tableau déjà lu par `readPiece` ({ sheets: [{ name, rows: [{ n, v: [...] }] }] }) :
//   structure : feuilles, lignes, ligne d'en-tête, par colonne : remplissage, nombres, valeurs distinctes, exemples ;
//   search    : les lignes où un texte apparaît (dans une colonne ou partout) ;
//   rows      : des lignes par numéros, par plage, ou par condition (compte, période, montant…), page par page ;
//   aggregate : nombre / sommes, éventuellement groupés par une colonne (par compte, par mois…), avec les mêmes conditions.
import { numberOf } from './table-structure.js';
import { headerRow } from './client-table-understanding.js';

export const QUERY_OPS = ['structure', 'search', 'rows', 'aggregate'];
export const QUERY_LIMITS = { rows: 40, groups: 100, distinct: 12, sample: 4, cell: 120, conditions: 6, sums: 6, characters: 20000 };
const COND_OPS = ['equals', 'prefix', 'contains', 'in', 'between', 'gt', 'lt'];
const LETTERS = /^[A-Z]{1,3}$/;
const bad = why => Object.assign(new Error('DOCUMENT_QUERY_INVALID'), { statusCode: 400, detail: why });

const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const colNum = l => l.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLet = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const asDate = v => {
  if (v instanceof Date) return v;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5);
  const t = String(v ?? '').trim(); let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return new Date(Date.UTC(+m[3], m[2] - 1, +m[1]));
  return null;
};
const show = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : typeof v === 'number' ? v : String(v).slice(0, QUERY_LIMITS.cell));
const letter = (v, what) => { const l = String(v || '').toUpperCase(); if (!LETTERS.test(l)) throw bad(what + ' : une lettre de colonne est attendue (A, B, … AA)'); return l; };
const count = (v, max, what) => { if (v == null) return null; if (!Number.isInteger(v) || v < 1 || v > max) throw bad(what + ' : entier entre 1 et ' + max); return v; };

// What the AI may ask. Anything else is refused with the reason, never guessed.
export function cleanQuery(raw) {
  if (!raw || typeof raw !== 'object') throw bad('demande absente');
  if (!QUERY_OPS.includes(raw.op)) throw bad('op : ' + QUERY_OPS.join(' | '));
  const q = { op: raw.op, sheet: raw.sheet == null ? null : String(raw.sheet).slice(0, 80) };
  const conds = raw.where == null ? [] : Array.isArray(raw.where) ? raw.where : [raw.where];
  if (conds.length > QUERY_LIMITS.conditions) throw bad('where : ' + QUERY_LIMITS.conditions + ' conditions au plus');
  q.where = conds.map(c => {
    if (!c || !COND_OPS.includes(c.op)) throw bad('where.op : ' + COND_OPS.join(' | '));
    const cond = { col: letter(c.col, 'where.col'), op: c.op };
    if (c.op === 'in') { if (!Array.isArray(c.values) || !c.values.length || c.values.length > 200) throw bad('where.values : 1 à 200 valeurs'); cond.values = c.values.map(x => String(x).slice(0, 80)); }
    else if (c.op === 'between') { if (c.from == null && c.to == null) throw bad('where.from / where.to'); cond.from = c.from ?? null; cond.to = c.to ?? null; }
    else { if (c.value == null || c.value === '') throw bad('where.value'); cond.value = typeof c.value === 'number' ? c.value : String(c.value).slice(0, 120); }
    return cond;
  });
  if (raw.op === 'search') {
    q.text = String(raw.text ?? '').trim().slice(0, 120); if (!q.text) throw bad('text');
    q.col = raw.col ? letter(raw.col, 'col') : null;
  }
  if (raw.op === 'rows') {
    if (Array.isArray(raw.row_numbers)) { if (!raw.row_numbers.length || raw.row_numbers.length > QUERY_LIMITS.rows || raw.row_numbers.some(n => !Number.isInteger(n) || n < 1)) throw bad('row_numbers : 1 à ' + QUERY_LIMITS.rows + ' numéros'); q.row_numbers = raw.row_numbers; }
    q.row_from = count(raw.row_from, 1e7, 'row_from'); q.row_to = count(raw.row_to, 1e7, 'row_to');
    q.cols = Array.isArray(raw.cols) ? raw.cols.slice(0, 30).map(c => letter(c, 'cols')) : null;
  }
  if (raw.op === 'aggregate') {
    q.group_by = raw.group_by ? letter(raw.group_by, 'group_by') : null;
    q.group_part = ['year', 'month', 'prefix'].includes(raw.group_part) ? raw.group_part : null;
    q.prefix_length = q.group_part === 'prefix' ? count(raw.prefix_length ?? 3, 12, 'prefix_length') : null;
    const sums = raw.sum == null ? [] : Array.isArray(raw.sum) ? raw.sum : [raw.sum];
    if (sums.length > QUERY_LIMITS.sums) throw bad('sum : ' + QUERY_LIMITS.sums + ' colonnes au plus');
    q.sum = sums.map(c => letter(c, 'sum'));
    q.minus = raw.minus ? letter(raw.minus, 'minus') : null; // sum[0] − minus (débit − crédit)
    q.sort = raw.sort === 'count' ? 'count' : raw.sort === 'key' ? 'key' : 'amount';
  }
  q.limit = count(raw.limit, raw.op === 'aggregate' ? QUERY_LIMITS.groups : QUERY_LIMITS.rows, 'limit') || (raw.op === 'aggregate' ? 50 : 25);
  q.offset = raw.offset == null ? 0 : (Number.isInteger(raw.offset) && raw.offset >= 0 ? raw.offset : (() => { throw bad('offset'); })());
  return q;
}

function matches(row, c) {
  const v = row.v[colNum(c.col) - 1];
  if (c.op === 'between' || c.op === 'gt' || c.op === 'lt') {
    const lo = c.op === 'between' ? c.from : c.op === 'gt' ? c.value : null, hi = c.op === 'between' ? c.to : c.op === 'lt' ? c.value : null;
    const dl = lo == null ? null : asDate(lo), dh = hi == null ? null : asDate(hi), dv = asDate(v);
    // A date range when both ends and the cell read as dates; else amounts.
    if (dv && (dl || dh) && (lo == null || dl) && (hi == null || dh) && typeof v !== 'number') return (!dl || dv >= dl) && (!dh || dv <= dh);
    const n = numberOf(v); if (n == null) return false;
    const a = lo == null ? null : numberOf(lo), b = hi == null ? null : numberOf(hi);
    return (a == null || n >= a) && (b == null || n <= b);
  }
  const t = fold(v instanceof Date ? v.toISOString().slice(0, 10) : v);
  if (c.op === 'equals') return t === fold(c.value);
  if (c.op === 'prefix') return t.startsWith(fold(c.value));
  if (c.op === 'contains') return t.includes(fold(c.value));
  return c.values.some(x => fold(x) === t);
}
const pass = (row, where) => where.every(c => matches(row, c));
// Rows after the header line (the header is a title line, not an entry): measured on the sheet, only when that line has no amount in it.
function dataRows(rows) {
  const h = headerRow(rows.slice(0, 60).map(r => r.v)), head = rows[h];
  const strings = head ? head.v.filter(v => typeof v === 'string' && v.trim()).length : 0, amounts = head ? head.v.filter(v => numberOf(v) != null).length : 0;
  return head && strings >= 2 && amounts === 0 ? { header: head, data: rows.slice(h + 1) } : { header: null, data: rows };
}
const sheetOf = (piece, name) => {
  const sheets = piece.sheets || [];
  const s = name ? sheets.find(x => x.name === name) : sheets.find(x => !x.derived_from) || sheets[0];
  if (!s) throw Object.assign(new Error('SOURCE_SHEET_NOT_FOUND'), { statusCode: 404, sheets: sheets.map(x => x.name) });
  return s;
};
// The window the document reader hands back to the AI: bounded in characters whatever the table.
const bounded = out => {
  while (JSON.stringify(out).length > QUERY_LIMITS.characters) {
    const key = ['lines', 'groups', 'columns'].find(k => Array.isArray(out[k]) && out[k].length > 1); if (!key) break;
    out[key] = out[key].slice(0, Math.ceil(out[key].length / 2)); out.truncated_for_size = true;
  }
  return out;
};
const lineOf = (row, cols) => ({ row: row.n, cells: (cols || row.v.map((_, i) => colLet(i + 1))).map(l => ({ column: l, value: show(row.v[colNum(l) - 1]) })).filter(c => c.value != null) });

export function runQuery(piece, rawQuery) {
  const q = cleanQuery(rawQuery), sheet = sheetOf(piece, q.sheet), rows = sheet.rows;
  const meta = { format: 'table-query', op: q.op, sheet: sheet.name, sheets: (piece.sheets || []).map(s => s.name), rows_in_sheet: rows.length, first_row: rows[0]?.n || null, last_row: rows.at(-1)?.n || null };

  if (q.op === 'structure') {
    const width = Math.min(60, Math.max(0, ...rows.slice(0, 5000).map(r => r.v.length)));
    const { header, data } = dataRows(rows);
    const columns = Array.from({ length: width }, (_, i) => {
      const vals = data.map(r => r.v[i]).filter(v => v != null && v !== '');
      const distinct = new Set(vals.slice(0, 200000).map(v => fold(v instanceof Date ? v.toISOString() : v)));
      const numbers = vals.filter(v => numberOf(v) != null).length;
      return { col: colLet(i + 1), header: header ? show(header.v[i]) : null, filled: vals.length, numbers, dates: vals.filter(v => v instanceof Date).length, distinct: distinct.size,
        examples: distinct.size <= QUERY_LIMITS.distinct ? [...distinct].slice(0, QUERY_LIMITS.distinct) : vals.slice(0, QUERY_LIMITS.sample).map(show) };
    });
    return bounded({ ...meta, header_row: header?.n || null, columns,
      first_lines: rows.slice(0, 6).map(r => lineOf(r, null)), last_lines: rows.slice(-3).map(r => lineOf(r, null)),
      next: 'Demande search / rows / aggregate pour aller plus loin ; les lettres de colonne sont celles du fichier.' });
  }

  if (q.op === 'search') {
    const needle = fold(q.text), col = q.col ? colNum(q.col) - 1 : null, found = [];
    let total = 0;
    for (const r of rows) {
      if (!pass(r, q.where)) continue;
      const hit = col != null ? fold(r.v[col]).includes(needle) : r.v.some(v => fold(v instanceof Date ? v.toISOString().slice(0, 10) : v).includes(needle));
      if (hit) { total++; if (total > q.offset && found.length < q.limit) found.push(lineOf(r, null)); }
    }
    return bounded({ ...meta, text: q.text, column: q.col, matches_total: total, lines: found, next_offset: q.offset + found.length < total ? q.offset + found.length : null });
  }

  if (q.op === 'rows') {
    let pick;
    if (q.row_numbers) { const want = new Set(q.row_numbers); pick = rows.filter(r => want.has(r.n)); }
    else pick = rows.filter(r => (q.row_from == null || r.n >= q.row_from) && (q.row_to == null || r.n <= q.row_to) && pass(r, q.where));
    const page = pick.slice(q.offset, q.offset + q.limit);
    return bounded({ ...meta, matches_total: pick.length, lines: page.map(r => lineOf(r, q.cols)), next_offset: q.offset + page.length < pick.length ? q.offset + page.length : null });
  }

  // aggregate
  const groups = new Map(), total = { count: 0, sums: q.sum.map(() => 0) };
  const keyOf = r => {
    if (!q.group_by) return 'tout';
    const v = r.v[colNum(q.group_by) - 1];
    if (q.group_part === 'prefix') return String(v ?? '').replace(/\s/g, '').slice(0, q.prefix_length);
    if (q.group_part === 'year' || q.group_part === 'month') { const d = asDate(v); return d ? d.toISOString().slice(0, q.group_part === 'year' ? 4 : 7) : '(sans date)'; }
    return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim() || '(vide)';
  };
  const amount = (r, i) => { const n = numberOf(r.v[colNum(q.sum[i]) - 1]); return n == null ? 0 : n; };
  for (const r of dataRows(rows).data) {
    if (!pass(r, q.where)) continue;
    const g = keyOf(r); let e = groups.get(g); if (!e) groups.set(g, e = { key: g, count: 0, sums: q.sum.map(() => 0), first_row: r.n });
    e.count++; total.count++;
    q.sum.forEach((_, i) => {
      let x = amount(r, i); if (i === 0 && q.minus) x -= numberOf(r.v[colNum(q.minus) - 1]) ?? 0;
      e.sums[i] += x; total.sums[i] += x;
    });
  }
  const round = n => Math.round(n * 100) / 100;
  let list = [...groups.values()].map(e => ({ key: e.key, count: e.count, sums: e.sums.map(round), first_row: e.first_row }));
  list.sort(q.sort === 'count' ? (a, b) => b.count - a.count : q.sort === 'key' ? (a, b) => String(a.key).localeCompare(String(b.key), 'fr', { numeric: true }) : (a, b) => Math.abs(b.sums[0] ?? 0) - Math.abs(a.sums[0] ?? 0) || b.count - a.count);
  const page = list.slice(q.offset, q.offset + q.limit);
  return bounded({ ...meta, group_by: q.group_by, group_part: q.group_part, sum_columns: q.sum, minus_column: q.minus, groups_total: list.length,
    total: { count: total.count, sums: total.sums.map(round) }, groups: page, next_offset: q.offset + page.length < list.length ? q.offset + page.length : null });
}
