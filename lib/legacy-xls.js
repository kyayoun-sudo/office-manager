import * as XLSX from 'xlsx';
// Read-only BIFF XLS support. Never evaluates macros, formulas or external links.
export function legacySheets(bytes) {
  const wb = XLSX.read(bytes, { type: 'buffer', cellDates: true, cellFormula: true, bookVBA: false, sheetRows: 200001 });
  return wb.SheetNames.filter((name, i) => !wb.Workbook?.Sheets?.[i]?.Hidden).map(name => {
    const ws = wb.Sheets[name], range = XLSX.utils.decode_range(ws['!fullref'] || ws['!ref'] || 'A1');
    if (range.e.r >= 200000 || range.e.c >= 200) throw new Error('SOURCE_TABLE_LIMIT_REACHED');
    for (const [address, cell] of Object.entries(ws)) if (address[0] !== '!' && cell.f && cell.v == null) throw new Error('SOURCE_FORMULA_WITHOUT_VALUE');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, raw: true, defval: null, blankrows: true });
    return { name, rows };
  }).filter(s => s.rows.length > 1);
}
