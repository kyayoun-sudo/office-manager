import path from 'node:path';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import ExcelJS from 'exceljs';
import { spreadsheetCellText } from './document-reading.js';

export const STRUCTURED_MIMES = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
const [WORD, SHEET, SLIDE] = STRUCTURED_MIMES;
export async function boundedOfficeZip(buffer) {
  if (buffer.length > 8000000) throw new Error('READER_TOO_LARGE');
  if (Buffer.from(buffer).includes(Buffer.from('EncryptedPackage', 'utf16le')) && Buffer.from(buffer).includes(Buffer.from('EncryptionInfo', 'utf16le'))) throw new Error('PASSWORD_PROTECTED');
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > 2000 || entries.reduce((n, e) => n + (e._data?.uncompressedSize || 0), 0) > 32000000) throw new Error('READER_TOO_LARGE');
  let expanded = 0;
  for (const entry of entries) if (!entry.dir) for await (const bytes of new Readable({ read() {} }).wrap(entry.nodeStream('nodebuffer'))) { expanded += bytes.length; if (expanded > 32000000) throw new Error('READER_TOO_LARGE'); }
  return zip;
}
export function xmlTree(xml) {
  const root = { name: '#root', children: [] }, stack = [root]; let count = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw new Error('XML_DOCTYPE_UNSUPPORTED'); });
  parser.on('opentag', tag => {
    if (++count > 250000 || stack.length > 128) throw new Error('READER_TOO_LARGE');
    const node = { name: tag.local, attrs: Object.fromEntries(Object.values(tag.attributes).map(a => [a.name, a.value])), children: [], text: '' };
    stack.at(-1).children.push(node); stack.push(node);
  });
  parser.on('text', text => { stack.at(-1).text += text; });
  parser.on('closetag', () => stack.pop()); parser.write(xml).close(); return root;
}
const attr = (node, key) => node?.attrs?.[key] ?? Object.entries(node?.attrs || {}).find(([k]) => k.split(':').at(-1) === key)?.[1];
function descendants(node, name) { const out = []; for (const n of node?.children || []) { if (n.name === name) out.push(n); out.push(...descendants(n, name)); } return out; }
function paragraphText(node) {
  if (node.name === 'del' || node.name === 'instrText') return '';
  if (node.name === 't') return node.text;
  if (node.name === 'tab') return '\t';
  if (['br', 'cr'].includes(node.name)) return '\n';
  return (node.children || []).map(paragraphText).join('');
}
async function partTree(zip, part) { return zip.file(part) ? xmlTree(await zip.file(part).async('string')) : null; }
async function relationships(zip, part) {
  const relPart = path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels');
  const result = new Map();
  for (const rel of descendants(await partTree(zip, relPart), 'Relationship')) {
    if (attr(rel, 'TargetMode') === 'External') continue;
    const target = attr(rel, 'Target') || '';
    const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(part), target));
    if (resolved.startsWith('../') || resolved.includes('://')) continue;
    result.set(attr(rel, 'Id'), { part: resolved, type: attr(rel, 'Type') || '' });
  }
  return result;
}

export function boundedStructuredResult({ sections = [], tables = [], metadata = {}, partial = false, limitations = [], extractor = 'structured-office' }, limit) {
  let text = '', truncated = partial; const kept = [], keptTables = [];
  for (const section of sections) {
    const separator = text ? '\n\n' : '', left = limit - text.length - separator.length;
    if (left <= 0) { truncated = true; break; }
    const value = String(section.text || ''), fragment = value.slice(0, left);
    kept.push({ ...section, text: fragment }); text += separator + fragment;
    if (fragment.length < value.length) { truncated = true; break; }
  }
  for (const table of tables) {
    if (kept.some(s => s.table_id === table.table_id)) {
      let budget = Math.max(0, limit - keptTables.reduce((n, t) => n + t.rows.flat().join('').length, 0));
      const rows = [];
      for (const row of table.rows || []) {
        if (budget <= 0 || rows.length >= 100) { truncated = true; break; }
        const cells = row.slice(0, 30).map(value => { const original = String(value ?? ''), cell = original.slice(0, Math.min(500, budget)); budget -= cell.length; if (cell.length !== original.length) truncated = true; return cell; });
        if (cells.length !== row.length) truncated = true; rows.push(cells);
      }
      keptTables.push({ ...table, rows, ...(table.header_candidate ? { header_candidate: rows[0] || [] } : {}), structured_rows_truncated: rows.length !== table.rows.length });
    }
    else truncated = true;
  }
  return { supported: true, extractor, text, sections: kept, tables: keptTables, metadata, truncated, limitations };
}

export async function extractStructuredOffice(buffer, mime, limit = 30000, options = {}) {
  if (!STRUCTURED_MIMES.includes(mime)) return { supported: false, text: '' };
  const zip = await boundedOfficeZip(buffer), sections = [], tables = [], metadata = {}, limitations = [];
  let partial = false;
  if (mime === WORD) {
    const main = await partTree(zip, 'word/document.xml'); if (!main) throw new Error('READER_CORRUPTED');
    const headings = new Map();
    for (const style of descendants(await partTree(zip, 'word/styles.xml'), 'style')) {
      const level = descendants(style, 'outlineLvl')[0];
      if (level) headings.set(attr(style, 'styleId'), Number(attr(level, 'val')) + 1);
    }
    const rels = await relationships(zip, 'word/document.xml');
    const extra = descendants(main, 'headerReference').concat(descendants(main, 'footerReference')).map(n => rels.get(attr(n, 'id'))?.part).filter(Boolean);
    if (!extra.length) { const orphan = Object.keys(zip.files).filter(n => /^word\/(header\d+|footer\d+)\.xml$/.test(n)); extra.push(...orphan); if (orphan.length) { partial = true; limitations.push('Header/footer references unavailable; all present parts were included.'); } }
    for (const name of ['footnotes', 'endnotes']) if (zip.file(`word/${name}.xml`)) extra.push(`word/${name}.xml`);
    const parts = [['word/document.xml', main], ...await Promise.all([...new Set(extra)].map(async part => [part, await partTree(zip, part)]))];
    for (const [part, tree] of parts) {
      if (!tree) { partial = true; limitations.push('Missing document part: ' + part); continue; }
      const kind = part.endsWith('document.xml') ? 'body' : part.includes('header') ? 'hdr' : part.includes('footnotes') ? 'footnotes' : part.includes('endnotes') ? 'endnotes' : 'ftr';
      const container = descendants(tree, kind)[0];
      let block = 0, heading = null;
      const visit = node => {
        if (node.name === 'p') {
          const text = paragraphText(node).trim(); if (!text) return;
          const style = attr(descendants(node, 'pStyle')[0], 'val') || '';
          const level = headings.get(style) || Number(/(?:heading|titre)(\d)/i.exec(style)?.[1]) || null;
          if (level) heading = text;
          sections.push({ text, heading, heading_level: level, source: { kind: 'document_part', part, block: ++block } });
        } else if (node.name === 'tbl') {
          const table_id = `${part}:table:${tables.length + 1}`;
          const rows = node.children.filter(n => n.name === 'tr').map(row => row.children.filter(n => n.name === 'tc').map(cell => descendants(cell, 'p').map(paragraphText).join('\n')));
          tables.push({ table_id, source: { kind: 'document_part', part, block: ++block }, rows });
          sections.push({ table_id, heading, text: rows.map(r => r.join('\t')).join('\n'), source: tables.at(-1).source });
        } else for (const nested of node.children || []) visit(nested);
      };
      if (container) visit(container); else { partial = true; limitations.push('Unrecognized Word part structure.'); }
      if (descendants(tree, 'drawing').length || descendants(tree, 'pict').length || descendants(tree, 'altChunk').length) { partial = true; limitations.push('Embedded visual or alternate content not transcribed.'); }
      if (descendants(tree, 'commentReference').length) { partial = true; limitations.push('Comments are not part of the extracted body text.'); }
    }
    metadata.document_parts = parts.map(([part]) => part);
  } else if (mime === SLIDE) {
    const presentation = await partTree(zip, 'ppt/presentation.xml'); if (!presentation) throw new Error('READER_CORRUPTED');
    const rels = await relationships(zip, 'ppt/presentation.xml');
    const ids = descendants(presentation, 'sldId'); metadata.slide_count = ids.length;
    for (let index = 0; index < ids.length; index++) {
      const part = rels.get(attr(ids[index], 'r:id') || attr(ids[index], 'id'))?.part, tree = part && await partTree(zip, part);
      if (!tree) { partial = true; limitations.push(`Missing slide ${index + 1}.`); continue; }
      const source = { kind: 'slide', slide_number: index + 1, part }; let title = null;
      for (const shape of descendants(tree, 'sp')) {
        const placeholder = descendants(shape, 'ph')[0];
        const text = descendants(shape, 'p').map(paragraphText).filter(Boolean).join('\n');
        if (['title', 'ctrTitle'].includes(attr(placeholder, 'type'))) title = text || title;
        if (text) sections.push({ text, source });
      }
      for (const table of descendants(tree, 'tbl')) {
        const table_id = `${part}:table:${tables.length + 1}`;
        const rows = table.children.filter(n => n.name === 'tr').map(row => row.children.filter(n => n.name === 'tc').map(cell => descendants(cell, 'p').map(paragraphText).join('\n')));
        tables.push({ table_id, source, rows }); sections.push({ table_id, text: rows.map(r => r.join('\t')).join('\n'), source });
      }
      const slideRels = await relationships(zip, part);
      for (const rel of slideRels.values()) if (rel.type.endsWith('/notesSlide')) {
        const notes = await partTree(zip, rel.part); if (!notes) { partial = true; continue; }
        for (const shape of descendants(notes, 'sp')) {
          if (['sldImg', 'sldNum', 'dt', 'hdr', 'ftr'].includes(attr(descendants(shape, 'ph')[0], 'type'))) continue;
          const text = descendants(shape, 'p').map(paragraphText).filter(Boolean).join('\n');
          if (text) sections.push({ text, source: { ...source, kind: 'speaker_notes', part: rel.part } });
        }
      }
      metadata.slides ||= []; metadata.slides.push({ slide_number: index + 1, title, part });
      if (descendants(tree, 'pic').length || descendants(tree, 'graphicData').some(n => !descendants(n, 'tbl').length)) { partial = true; limitations.push(`Visual elements on slide ${index + 1} not transcribed.`); }
    }
  } else {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
    metadata.sheet_count = workbook.worksheets.length; metadata.sheet_names = workbook.worksheets.map(s => s.name); metadata.sheets = [];
    const selected = options.sheetName ? workbook.worksheets.filter(s => s.name === options.sheetName) : workbook.worksheets.slice(0, 10);
    if (!selected.length) throw new Error('READER_RANGE_NOT_FOUND');
    partial ||= selected.length < workbook.worksheets.length;
    for (const sheet of selected) {
      let non_empty_cells = 0, firstRow = Infinity, firstCol = Infinity, lastRow = 0, lastCol = 0, statsPartial = false;
      sheet.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
        if (non_empty_cells >= 100000) { statsPartial = true; return; }
        non_empty_cells++; firstRow = Math.min(firstRow, row.number); lastRow = Math.max(lastRow, row.number); firstCol = Math.min(firstCol, cell.col); lastCol = Math.max(lastCol, cell.col);
      }));
      const startRow = Math.max(1, Number(options.startRow) || (Number.isFinite(firstRow) ? firstRow : 1));
      const rowLimit = Math.min(100, Math.max(1, Number(options.rowLimit) || 21));
      const startCol = Number.isFinite(firstCol) ? firstCol : 1, endCol = Math.min(sheet.columnCount, startCol + 29);
      const rows = [], formulas = [], table_id = `sheet:${sheet.name}`;
      for (let r = startRow; r <= Math.min(sheet.rowCount, startRow + rowLimit - 1); r++) {
        const values = [];
        for (let c = startCol; c <= endCol; c++) {
          const cell = sheet.getRow(r).getCell(c), value = spreadsheetCellText(cell);
          partial ||= value.length > 500; values.push(value.slice(0, 500));
          if (cell.value?.formula || cell.value?.sharedFormula) formulas.push({ address: cell.address, formula: String(cell.value.formula || cell.value.sharedFormula).slice(0, 500), cached_result: value.slice(0, 500) });
        }
        rows.push(values); sections.push({ table_id, text: values.join('\t'), source: { kind: 'sheet', sheet: sheet.name, first_row: r, last_row: r, first_column: startCol, last_column: endCol } });
      }
      const used_range = lastRow ? `${sheet.getColumn(firstCol).letter}${firstRow}:${sheet.getColumn(lastCol).letter}${lastRow}` : null;
      const sampled = statsPartial || (Number.isFinite(firstRow) && startRow !== firstRow) || rows.length < sheet.rowCount - startRow + 1 || endCol < sheet.columnCount;
      partial ||= sampled;
      tables.push({ table_id, sheet: sheet.name, rows, first_row: startRow, range: rows.length ? `${sheet.getColumn(startCol).letter}${startRow}:${sheet.getColumn(Math.max(startCol, endCol)).letter}${startRow + rows.length - 1}` : null, header_candidate: rows[0] || [], header_confirmed: false, total_rows: sheet.rowCount, total_columns: sheet.columnCount, sampled });
      metadata.sheets.push({ name: sheet.name, used_range, statistics_complete: !statsPartial, non_empty_cells, formulas, hidden: sheet.state !== 'visible' });
    }
    limitations.push('Formula results are cached values; formulas are never executed.');
  }
  return boundedStructuredResult({ sections, tables, metadata, partial, limitations: [...new Set(limitations)] }, limit);
}
