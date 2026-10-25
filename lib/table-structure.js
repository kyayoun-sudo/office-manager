// How a client table is BUILT, read by arithmetic (Paul, 2026-10-25 : « le logiciel n'a toujours pas compris ce qu'il doit faire avec le
// PTBA ; le document est clair »). A PTBA / budget / TEB is a hierarchy: detail lines, then category lines whose amount is the sum of
// their lines (a sub-total), then a grand total. The words used vary from one client to the next (« Sous-total », « Total composante »,
// a bold title above its lines, a code « 1 » above « 1.1 »…), so the code does not look for words: it PROVES that a row is the sum of the
// rows it covers. What it finds is shown to the AI (which interprets the document) and used to take the categories without guessing.
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const numberOf = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/ /g, ' ').trim();
  if (!/\d/.test(s) || !/^\(?-?[\d\s.,]+\)?$/.test(s)) return null;
  let t = s.replace(/[\s()]/g, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  const n = Number(t); return Number.isFinite(n) ? (/^\(.*\)$/.test(s) ? -n : n) : null;
};
const TOTAL_WORD = /^(sous[- ]?)?(total|totaux)\b/;
const same = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(a) * 1e-6);

// The columns that hold amounts (most cells are numbers), the main one first (the most filled).
export function amountColumns(headers, rows) {
  const n = Math.max(headers.length, ...rows.slice(0, 200).map(r => r.length));
  const out = [];
  for (let i = 0; i < n; i++) {
    const vals = rows.map(r => r[i]).filter(v => v != null && String(v).trim() !== '');
    const nums = vals.filter(v => numberOf(v) != null);
    // a code column (« 1.1 », « 601 ») is not an amount: small integers / dotted codes everywhere
    const codeLike = nums.length && nums.every(v => typeof v === 'string' && /^\d{1,8}(\.\d{1,3})+$|^\d{1,8}$/.test(v.trim())) && vals.some(v => /\./.test(String(v)));
    if (vals.length >= 3 && nums.length / vals.length >= 0.7 && !codeLike && !/^(n|no|num|code|ref)\b/.test(fold(headers[i]))) out.push({ i, filled: nums.length, header: headers[i] });
  }
  return out.sort((a, b) => b.filled - a.filled);
}

// Rows that are the sum of the rows they cover. Two layouts: the category line ABOVE its lines (header style), or BELOW them (« Sous-total »).
// Nested levels are handled: an inner group counts once (its own amount) when the outer one is summed.
function groupsFor(rows, col, style) {
  const amt = rows.map(r => numberOf(r[col]));
  const worded = rows.map(r => r.some(v => typeof v === 'string' && TOTAL_WORD.test(fold(v))));
  const groups = new Map();   // row index → [start, end]
  const order = style === 'above' ? [...rows.keys()].reverse() : [...rows.keys()];
  for (const i of order) {
    if (amt[i] == null || amt[i] === 0) continue;
    let sum = 0, items = 0, j = style === 'above' ? i + 1 : i - 1, end = null;
    for (let steps = 0; steps < 400 && j >= 0 && j < rows.length; steps++) {
      if (groups.has(j) && style === 'above') { sum += amt[j] || 0; items++; j = groups.get(j)[1] + 1; }
      else if (groups.has(j) && style === 'below') { sum += amt[j] || 0; items++; j = groups.get(j)[0] - 1; }
      else { if (amt[j] != null) { sum += amt[j]; items++; } j += style === 'above' ? 1 : -1; }
      // two lines at least — or one line when the row SAYS it is a total (« Sous-total Transport » over a single expense)
      if ((items >= 2 || (items === 1 && worded[i])) && same(sum, amt[i])) { end = style === 'above' ? j - 1 : j + 1; break; }
      if (Math.abs(sum) > Math.abs(amt[i]) * 1.5 + 1 && Math.sign(sum) === Math.sign(amt[i])) break;
    }
    if (end != null) groups.set(i, style === 'above' ? [i + 1, end] : [end, i - 1]);
  }
  return groups;
}

export function tableStructure(headers, rows, opts = {}) {
  const cols = amountColumns(headers, rows);
  if (!cols.length || rows.length < 3) return { amount_column: null, groups: [], categories: [], detail_rows: rows.length, style: null };
  const labelCol = (() => {
    let best = -1, score = -1;
    for (let i = 0; i < headers.length; i++) { if (cols.some(c => c.i === i)) continue; const s = rows.filter(r => typeof r[i] === 'string' && /[a-z]{3}/i.test(r[i])).length; if (s > score) { score = s; best = i; } }
    return best;
  })();
  const labelOf = r => { const v = labelCol >= 0 ? r[labelCol] : null; const s = String(v ?? '').trim() || String(r.find(x => typeof x === 'string' && /[a-z]{3}/i.test(x)) ?? '').trim(); return s; };
  let best = null;
  for (const c of cols.slice(0, opts.columns || 3)) for (const style of ['above', 'below']) {
    const g = groupsFor(rows, c.i, style);
    if (!best || g.size > best.g.size) best = { g, col: c, style };
  }
  const total = rows.length;
  const list = [...best.g.entries()].map(([row, [s, e]]) => ({ row, start: s, end: e, label: labelOf(rows[row]), amount: numberOf(rows[row][best.col.i]) }))
    .sort((a, b) => a.row - b.row);
  // nesting level: how many groups contain this one
  for (const x of list) x.level = list.filter(y => y !== x && y.start <= Math.min(x.row, x.start) && y.end >= Math.max(x.row, x.end)).length;
  // the grand total: one group covering (almost) everything — not a category
  const grand = list.find(x => x.level === 0 && x.end - x.start + 1 >= 0.8 * (total - 1));
  const top = grand ? 1 : 0;
  const categories = list.filter(x => x !== grand && x.level === top).map(x => ({ ...x, label: x.label.replace(/^\s*(sous[- ]?total|total)\s*[:\-–]?\s*/i, '').trim() || x.label }));
  const covered = new Set(); for (const g of list) for (let k = g.start; k <= g.end; k++) covered.add(k);
  return { amount_column: best.col.header ?? null, amount_index: best.col.i, label_index: labelCol, style: best.g.size ? best.style : null,
    groups: list, grand_total: grand ? { row: grand.row, label: grand.label, amount: grand.amount } : null, categories,
    detail_rows: rows.filter((_, k) => !best.g.has(k) && numberOf(rows[k][best.col.i]) != null).length,
    keyword_totals: rows.filter(r => r.some(v => typeof v === 'string' && TOTAL_WORD.test(fold(v)))).length };
}

// A short description for the AI (no long table): how many lines, what the categories are, the grand total.
export function describeStructure(s) {
  if (!s || !s.amount_column && s.amount_column !== 0) return null;
  return { amount_column: s.amount_column, layout: s.style === 'above' ? 'catégorie au-dessus de ses lignes' : s.style === 'below' ? 'sous-total sous ses lignes' : 'aucune somme trouvée',
    detail_lines: s.detail_rows, categories_proved_by_sum: s.categories.slice(0, 40).map(c => ({ label: c.label.slice(0, 80), amount: c.amount, lines: c.end - c.start + 1 })),
    grand_total: s.grand_total ? { label: s.grand_total.label.slice(0, 60), amount: s.grand_total.amount } : null };
}
