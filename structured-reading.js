import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import ExcelJS from 'exceljs';
import { spreadsheetCellText } from './document-reading.js';

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const STRUCTURED_MIMES = [WORD, SHEET, SLIDE];

async function boundedZip(buffer) {
  if (buffer.length > 8000000) throw new Error('READER_TOO_LARGE');
  const zip = await JSZip.loadAsync(buffer);
  // Guard expansion before handing the archive to a full workbook parser.
  const entries = Object.values(zip.files);
  if (entries.length > 2000 || entries.reduce((n, e) => n + (e._data?.uncompressedSize || 0), 0) > 32000000) throw new Error('READER_TOO_LARGE');
  return zip;
}

function paragraphs(xml) {
  const parser = new SaxesParser({ xmlns: true });
  const result = []; let current = null, collecting = false;
  parser.on('doctype', () => { throw new Error('XML_DOCTYPE_UNSUPPORTED'); });
  parser.on('opentag', tag => {
    if (tag.local === 'p') current = '';
    if (tag.local === 't') collecting = true;
    if (tag.local === 'tab' && current !== null) current += '\t';
    if (tag.local === 'br' && current !== null) current += '\n';
  });
  parser.on('text', text => { if (collecting && current !== null) current += text; });
  parser.on('closetag', tag => {
    if (tag.local === 't') collecting = false;
    if (tag.local === 'p' && current !== null) { if (current.trim()) result.push(current.trim()); current = null; }
  });
  parser.write(xml).close();
  return result;
}

export async function extractStructuredOffice(buffer, mime, limit = 30000) {
  const zip = await boundedZip(buffer);
  const sections = [], tables = [], metadata = {}; let partial = false;
  if (mime === SHEET) {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
    metadata.sheet_count = workbook.worksheets.length;
    for (const sheet of workbook.worksheets.slice(0, 10)) {
      const rows = [];
      for (let r = 1; r <= Math.min(sheet.rowCount, 21); r++) {
        const values = [];
        for (let c = 1; c <= Math.min(sheet.columnCount, 30); c++) { const value = spreadsheetCellText(sheet.getRow(r).getCell(c)); partial ||= value.length > 500; values.push(value.slice(0, 500)); }
        rows.push(values);
      }
      tables.push({ sheet: sheet.name, range: `A1:${sheet.getColumn(Math.max(1, Math.min(sheet.columnCount, 30))).letter}${rows.length}`, rows, total_rows: sheet.rowCount, total_columns: sheet.columnCount, sampled: sheet.rowCount > 21 || sheet.columnCount > 30 });
      sections.push({ text: rows.map(row => row.join('\t')).join('\n'), source: { kind: 'sheet', sheet: sheet.name, first_row: 1, last_row: rows.length } });
      partial ||= sheet.rowCount > 21 || sheet.columnCount > 30;
    }
    partial ||= workbook.worksheets.length > 10;
  } else {
    const parts = Object.keys(zip.files).filter(name => mime === WORD ? /^word\/(document|header\d+|footer\d+)\.xml$/.test(name) : /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    for (const part of parts) {
      const blocks = paragraphs(await zip.file(part).async('string'));
      blocks.forEach((text, index) => sections.push({ text, source: { kind: mime === WORD ? 'document_part' : 'slide_part', part, paragraph: index + 1 } }));
    }
    // Paragraph text does not preserve table layout, drawings, notes, or presentation order.
    partial = true;
  }
  const all = sections.map(s => s.text).join('\n\n');
  let budget = limit;
  const boundedSections = [];
  for (const section of sections) { if (budget <= 0) break; const text = section.text.slice(0, budget); boundedSections.push({ ...section, text }); budget -= text.length + 2; }
  return { supported: true, extractor: 'structured-office', text: all.slice(0, limit), sections: boundedSections, tables, metadata, truncated: partial || all.length > limit, limitations: mime === SHEET ? ['Cached formula values only; formulas are never executed.'] : ['Paragraph extraction only: table layout, images, notes and display order are not verified.'] };
}
