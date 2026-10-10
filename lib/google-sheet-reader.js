import { boundedStructuredResult } from './office-structured-reader.js';

// Fetch structure first, then only bounded ranges. Grid dimensions are not used-range statistics.
export async function readStructuredGoogleSheet(fileId, request, limit = 30000, options = {}) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}`;
  const book = await request(base + '?fields=spreadsheetId,sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))');
  const sheets = (book.sheets || []).map(s => s.properties);
  const selected = options.sheetName ? sheets.filter(s => s.title === options.sheetName) : sheets.slice(0, 10);
  if (!selected.length) throw new Error('READER_RANGE_NOT_FOUND');
  const startRow = Math.max(1, Number(options.startRow) || 1), rowLimit = Math.min(100, Math.max(1, Number(options.rowLimit) || 21));
  const ranges = selected.map(s => `'${s.title.replace(/'/g, "''")}'!A${startRow}:AD${Math.min(s.gridProperties.rowCount, startRow + rowLimit - 1)}`);
  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  ranges.forEach(r => params.append('ranges', r));
  const values = await request(base + '/values:batchGet?' + params);
  params.set('valueRenderOption', 'FORMULA');
  const formulas = await request(base + '/values:batchGet?' + params);
  const sections = [], tables = [], metadata = { sheet_count: sheets.length, sheet_names: sheets.map(s => s.title), sheets: [] };
  let partial = selected.length < sheets.length;
  selected.forEach((sheet, index) => {
    const rawRows = values.valueRanges?.[index]?.values || [], rawFormulas = formulas.valueRanges?.[index]?.values || [];
    const rows = rawRows.slice(0, rowLimit).map(row => row.slice(0, 30).map(value => String(value ?? '').slice(0, 500)));
    const sampled = startRow > 1 || sheet.gridProperties.rowCount > rowLimit || sheet.gridProperties.columnCount > 30;
    partial ||= sampled || rawRows.some(row => row.some(value => String(value ?? '').length > 500));
    const table_id = 'google-sheet:' + sheet.sheetId;
    rows.forEach((row, offset) => sections.push({ table_id, text: row.join('\t'), source: { kind: 'sheet', sheet: sheet.title, first_row: startRow + offset, last_row: startRow + offset, first_column: 1, last_column: row.length } }));
    tables.push({ table_id, sheet: sheet.title, range: ranges[index], rows, header_candidate: startRow === 1 ? rows[0] || [] : [], header_confirmed: false, sampled });
    const formulaCells = [];
    rawFormulas.slice(0, rowLimit).forEach((row, r) => row.slice(0, 30).forEach((value, c) => { if (typeof value === 'string' && value.startsWith('=')) formulaCells.push({ row: startRow + r, column: c + 1, formula: value.slice(0, 500), cached_result: rows[r]?.[c] ?? null }); }));
    metadata.sheets.push({ name: sheet.title, grid_rows: sheet.gridProperties.rowCount, grid_columns: sheet.gridProperties.columnCount, sampled_range: ranges[index], used_range: null, non_empty_cells_in_sample: rows.reduce((n, row) => n + row.filter(Boolean).length, 0), statistics_complete: !sampled, formulas: formulaCells, hidden: Boolean(sheet.hidden) });
  });
  return boundedStructuredResult({ extractor: 'google-sheets-api', sections, tables, metadata, partial, limitations: ['Grid dimensions are not occupied ranges. Only requested cells are inspected. Dates are returned as serial values; no date interpretation is inferred.'] }, limit);
}
