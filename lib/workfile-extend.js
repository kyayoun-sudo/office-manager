// Agrandir un tableau du working file (Paul, 2026-10-24 : « possibilité d'augmenter le nombre de lignes » ; 2026-10-25 : deux grands
// livres de 612 et 659 lignes pour un tableau de 1 000).
// Comme une personne le ferait dans Excel, sans rien casser :
//   1. les nouvelles lignes reprennent le format, les listes de choix et les FORMULES de la dernière ligne du tableau (références
//      relatives décalées, absolues gardées) ; les cases de saisie restent vides ;
//   2. dans TOUT le classeur, les plages qui couvraient le tableau jusqu'à sa dernière ligne (SUM(D1_GL_PROJET!$H$11:$H$1010),
//      COUNTIF($D$11:$D$1010…)) sont prolongées jusqu'à la nouvelle dernière ligne, de même que les noms définis ;
//   3. le texte entre guillemets n'est jamais touché ; rien n'est supprimé ni écrasé.
// Le classeur est ensuite recalculé à l'ouverture (fullCalcOnLoad), et l'appelant relit le fichier écrit.

const QUOTED = /("(?:[^"]|"")*")/;
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
const unquote = s => String(s || '').replace(/!$/, '').replace(/^'(.*)'$/, '$1').replace(/''/g, "'");

function outsideQuotes(f, fn) { return String(f).split(QUOTED).map((part, i) => (i % 2 ? part : fn(part))).join(''); }

// Copy-down of a formula by `d` rows: relative row numbers move, absolute ones ($11) stay.
export function shiftRows(formula, d) {
  return outsideQuotes(formula, s => s.replace(/(^|[^A-Za-z0-9_.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g,
    (m, pre, c1, col, c2, row) => pre + c1 + col + c2 + (c2 ? row : String(Number(row) + d))));
}

// Ranges of `sheet` ending on the table's last row (and starting inside or above it) now end on `newLast`.
export function extendRanges(formula, ownSheet, sheet, firstRow, lastRow, newLast) {
  return outsideQuotes(formula, s => s.replace(/((?:'(?:[^']|'')+'|[A-Za-z0-9_.\-]+)!)?(\$?[A-Z]{1,3}\$?)(\d+):(\$?[A-Z]{1,3}\$?)(\d+)(?![\d(])/g,
    (m, pfx, c1, r1, c2, r2) => {
      const target = pfx ? unquote(pfx) : ownSheet;
      if (target !== sheet || Number(r2) !== lastRow || Number(r1) > firstRow) return m;
      return (pfx || '') + c1 + r1 + ':' + c2 + newLast;
    }));
}

// References to `sheet` on rows AFTER `after` move down by `n` (rows inserted after the table: the total line below it, and every formula
// that points at it, follow — as when a person inserts rows in Excel). Absolute rows move too: the row itself moved.
export function shiftAfter(formula, ownSheet, sheet, after, n) {
  return outsideQuotes(formula, s => s.replace(/(^|[^A-Za-z0-9_.!'])((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.\-]*)!)?(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?(?![\d(A-Za-z_])/g,
    (m, pre, pfx, c1, r1, c2, r2) => {
      const target = pfx ? unquote(pfx) : ownSheet;
      if (target !== sheet) return m;
      const mv = r => (Number(r) > after ? String(Number(r) + n) : r);
      return pre + (pfx || '') + c1 + mv(r1) + (c2 ? ':' + c2 + mv(r2) : '');
    }));
}

function formulaOf(cell) { const v = cell.value; return v && typeof v === 'object' && v.formula ? v.formula : null; }

export function extendTable(wb, sheetName, { first_row, last_row }, newLast, { maxCol = 100 } = {}) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw Object.assign(new Error('SHEET_NOT_FOUND'), { statusCode: 409 });
  if (!(newLast > last_row)) return { added: 0, formulas_extended: 0 };
  if (newLast > 20000) throw Object.assign(new Error('TABLE_TOO_LARGE'), { statusCode: 409 });
  const width = Math.min(ws.columnCount, maxCol), dv = ws.dataValidations?.model || {};
  const tplRow = ws.getRow(last_row);
  // 0. Something under the table (a TOTAL line, notes): rows are INSERTED after the table, as in Excel — what was below moves down, with
  //    every formula that points at it (2026-10-25: D2_BUDGET has its total right under the entries).
  let inserted = 0;
  const below = (() => { for (let r = last_row + 1; r <= newLast; r++) for (let c = 1; c <= width; c++) { const v = ws.getCell(r, c).value; if (v != null && v !== '') return true; } return false; })();
  if (below) {
    if (ws.rowCount + (newLast - last_row) > 20000) throw Object.assign(new Error('TABLE_TOO_LARGE'), { statusCode: 409 });
    const n = newLast - last_row;
    if ((ws.model?.merges || []).some(m => { const r = Number(String(m).match(/\d+/)?.[0]); return r > last_row; })) throw Object.assign(new Error('MERGED_CELLS_BELOW_TABLE'), { statusCode: 409 });
    wb.eachSheet(sheet => sheet.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
      const f = formulaOf(cell); if (!f) return;
      const g = shiftAfter(f, sheet.name, sheetName, last_row, n); if (g !== f) cell.value = { ...cell.value, formula: g, result: undefined };
    })));
    const names = wb.definedNames?.model;
    if (Array.isArray(names)) wb.definedNames.model = names.map(nm => ({ ...nm, ranges: (nm.ranges || []).map(rg => shiftAfter(rg, null, sheetName, last_row, n)) }));
    // Lists of choices below move with their cells.
    const moved = {};
    for (const [addr, v] of Object.entries(dv)) { const m = addr.match(/^([A-Z]{1,3})(\d+)$/); if (m && Number(m[2]) > last_row) moved[m[1] + (Number(m[2]) + n)] = v; else moved[addr] = v; }
    if (ws.dataValidations) ws.dataValidations.model = moved;
    ws.spliceRows(last_row + 1, 0, ...Array.from({ length: n }, () => []));
    inserted = n;
  }
  const dvNow = ws.dataValidations?.model || {};
  // 1. New rows from the table's last row.
  for (let r = last_row + 1; r <= newLast; r++) {
    const row = ws.getRow(r);
    if (tplRow.height) row.height = tplRow.height;
    for (let c = 1; c <= width; c++) {
      const tpl = ws.getCell(last_row, c), cell = ws.getCell(r, c);
      if (cell.value != null && cell.value !== '') throw Object.assign(new Error('ROWS_BELOW_TABLE_NOT_EMPTY'), { statusCode: 409, row: r });
      if (tpl.style && Object.keys(tpl.style).length) cell.style = clone(tpl.style);
      const f = formulaOf(tpl);
      if (f) cell.value = { formula: shiftRows(f, r - last_row) };
      if (dvNow[tpl.address]) dvNow[cell.address] = clone(dvNow[tpl.address]);
    }
  }
  // 2. Ranges over the table, everywhere in the workbook (the new rows' own formulas included).
  let changed = 0;
  wb.eachSheet(sheet => sheet.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
    const f = formulaOf(cell); if (!f) return;
    const g = extendRanges(f, sheet.name, sheetName, first_row, last_row, newLast);
    if (g !== f) { cell.value = { formula: g }; changed++; }
  })));
  const names = wb.definedNames?.model;
  if (Array.isArray(names)) {
    let touched = false;
    const next = names.map(n => ({ ...n, ranges: (n.ranges || []).map(rg => { const g = extendRanges(rg, null, sheetName, first_row, last_row, newLast); if (g !== rg) touched = true; return g; }) }));
    if (touched) wb.definedNames.model = next;
  }
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  return { added: newLast - last_row, from_row: last_row + 1, to_row: newLast, formulas_extended: changed, rows_inserted: inserted };
}
