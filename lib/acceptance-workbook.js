// THE FIRM'S OPPORTUNITY & ACCEPTANCE WORKBOOK (Paul, 2026-10-10: « ce fichier existe déjà : Firm
// Manager le remplit, Mission Controller le remplit, chacun en fonction de ce qu'il a à faire »).
// One workbook per opportunity (a copy of the firm's template) is THE record of Phases 0 and 1
// (opportunity, Phase 0, KYC / independence / acceptance, conclusion). The application never keeps a
// parallel questionnaire: it reads the template's own structure and writes into the copy.
//
// Nothing about the firm is written here. The structure is READ from the template itself:
//  - input cells = the cells styled like the legend « Cellule à compléter » (the template's legend);
//  - each input cell gets its row label (ref + text left of it), its column header (header row above),
//    its help (text right of it), its allowed values (the cell's drop-down list) and its type (date);
//  - the sections are the template's own titles (dark rows);
//  - the copy's name and its place come from the template's « mode d'emploi » (« … » and « déposer
//    dans … / [dossier de l'opportunité] »).
// Writing keeps everything else untouched: the xlsx XML is patched cell by cell (styles, formulas,
// lists, conditional formats stay as they are) and Excel recalculates on opening. Grey cells
// (formulas) are never written. A Google Sheet copy is written through the Sheets API instead.

import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const text = v => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.text) return String(v.text);
    if ('formula' in v || 'sharedFormula' in v) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('result' in v) return text(v.result);
  }
  return String(v);
};
const isFormula = v => v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v);
const argb = c => String(c?.fill?.fgColor?.argb || '').toUpperCase();
const dark = hex => { const h = String(hex || '').slice(-6); if (!/^[0-9A-F]{6}$/.test(h)) return false; const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); return (0.299 * r + 0.587 * g + 0.114 * b) < 110; };
export const colLetter = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
export const colNumber = s => [...String(s)].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const split = a => { const m = String(a).match(/^([A-Z]+)(\d+)$/); return m ? { col: colNumber(m[1]), row: Number(m[2]) } : null; };

async function load(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

// The fill of the legend cell that says « … à compléter … » (the template's own definition of an
// input cell). Falls back to the most frequent light fill of cells that are empty and not formulas.
function inputFill(wb) {
  for (const ws of wb.worksheets) {
    let found = null;
    ws.eachRow((row) => row.eachCell(c => {
      if (found) return;
      if (/cellule\s+à\s+compl[ée]ter|à\s+compl[ée]ter\s*\(saisie|input cell/i.test(text(c.value))) {
        const left = row.getCell(c.col - 1);
        found = argb(left) || argb(c);
      }
    }));
    if (found) return found;
  }
  return null;
}

// Allowed values of a cell (its drop-down list), its type (date, list, text).
function validationOf(ws, address) {
  const v = ws.dataValidations?.model?.[address];
  if (!v) return { type: 'text', options: null };
  if (v.type === 'date') return { type: 'date', options: null };
  if (v.type === 'list') {
    const f = String(v.formulae?.[0] || '');
    if (/^".*"$/.test(f)) return { type: 'list', options: f.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean) };
    return { type: 'list', options: null };
  }
  return { type: v.type || 'text', options: null };
}

// Structure of the whole workbook: sheets → sections → rows (items) → input fields.
export async function describeWorkbook(buffer) {
  const wb = await load(buffer);
  const fill = inputFill(wb);
  if (!fill) throw fail('WORKBOOK_LEGEND_NOT_FOUND', 422);
  const sheets = [];
  let howTo = '';
  for (const ws of wb.worksheets) {
    const title = text(ws.getCell('B3').value) || ws.name;
    const rows = [];
    let section = null;
    const headers = new Map(); // col → header text, from the last header row seen
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells = [];
      row.eachCell({ includeEmpty: true }, c => cells.push(c));
      const texts = cells.filter(c => text(c.value).trim() && !isFormula(c.value));
      const inputs = cells.filter(c => argb(c) === fill && !isFormula(c.value));
      for (const c of texts) if (/mode d.emploi|^1\.\s*copier/i.test(text(row.getCell(c.col - 1)?.value)) || /renommer\s+«/i.test(text(c.value))) howTo = howTo || text(c.value);
      // Section titles: one text on a dark band.
      if (!inputs.length && texts.length && texts.length <= 2 && dark(argb(texts[0]))) {
        const t = text(texts[0].value).trim();
        if (texts.length >= 1 && !/^(Réf|N°)$/i.test(t)) { section = t; headers.clear(); }
      }
      // Header rows: several texts on a dark band (« Réf | Contrôle | Résultat | … »).
      if (!inputs.length && texts.length >= 3 && texts.every(c => dark(argb(c)))) {
        headers.clear();
        for (const c of texts) headers.set(c.col, text(c.value).trim());
        continue;
      }
      if (!inputs.length || /^L[ÉE]GENDE|^LEGEND/i.test(section || '')) continue;
      const first = Math.min(...inputs.map(c => c.col));
      const left = texts.filter(c => c.col < first).map(c => text(c.value).trim());
      const right = texts.filter(c => c.col > first && !inputs.some(i => i.col === c.col)).map(c => text(c.value).trim());
      const ref = left.length && /^([A-Z]{1,2}\.\d{1,3}|\d{1,3})$/.test(left[0]) ? left[0] : null;
      const label = (ref ? left.slice(1) : left).join(' — ') || null;
      rows.push({
        sheet: ws.name, row: r, section, ref, label,
        help: right.join(' ').slice(0, 600) || null,
        fields: inputs.map(c => ({ cell: colLetter(c.col) + r, header: headers.get(c.col) || null, ...validationOf(ws, colLetter(c.col) + r) }))
      });
    }
    sheets.push({ name: ws.name, title, rows });
  }
  return { input_fill: fill, how_to: howTo || null, naming: namingRule(howTo), sheets };
}

// « …renommer « TATY_WP_PH0-1_[CLIENT]_[REFERENCE].xlsx » et la déposer dans 03_X / [dossier…]. Le
// modèle original reste dans 06_Y / 03_Z … »
export function namingRule(howTo) {
  const s = String(howTo || '');
  const name = (s.match(/«\s*([^»]+?)\s*»/) || [])[1] || null;
  const dest = (s.match(/d[ée]poser\s+dans\s+([^/.\n]+?)\s*\//i) || [])[1] || null;
  const tpl = (s.match(/reste\s+dans\s+([^.\n]+?)\s+et\b/i) || [])[1] || null;
  return { pattern: name, destination_folder: dest ? dest.trim() : null, template_path: tpl ? tpl.split('/').map(x => x.trim()).filter(Boolean) : null };
}

const clean = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
export function copyName(pattern, values) {
  const p = pattern || '[CLIENT]_[REFERENCE].xlsx';
  return p.replace(/\[([A-Z_ ]+)\]/g, (m, k) => clean(values[k.trim().toLowerCase()] || k)).replace(/_{2,}/g, '_');
}

// Values of given cells (or of every input cell) — formulas give their cached result, if any.
export async function readCells(buffer, cells) {
  const wb = await load(buffer);
  const out = {};
  for (const { sheet, cell } of cells) {
    const ws = wb.getWorksheet(sheet);
    if (!ws) continue;
    const v = ws.getCell(cell).value;
    // A date typed in a date cell without a date format reads as its serial number.
    if (typeof v === 'number' && ws.dataValidations?.model?.[cell]?.type === 'date' && v > 20000 && v < 80000) { out[sheet + '!' + cell] = new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10); continue; }
    out[sheet + '!' + cell] = v instanceof Date ? v.toISOString().slice(0, 10) : isFormula(v) ? text(v.result ?? '') : text(v);
  }
  return out;
}

// ---- Safe writer: patch the sheet XML, cell by cell ----

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
export function excelSerial(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/) || String(iso || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.UTC(1899, 11, 30)) / 86400000);
}

function cellXml(address, style, value, type) {
  const s = style ? ' s="' + style + '"' : '';
  if (value === null || value === undefined || value === '') return '<c r="' + address + '"' + s + '/>';
  if (type === 'date') { const n = excelSerial(value); if (n != null) return '<c r="' + address + '"' + s + '><v>' + n + '</v></c>'; }
  if (typeof value === 'number' && Number.isFinite(value)) return '<c r="' + address + '"' + s + '><v>' + value + '</v></c>';
  return '<c r="' + address + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(value) + '</t></is></c>';
}

export function patchSheetXml(xml, writes) {
  let out = xml;
  for (const w of writes) {
    const { row, col } = split(w.cell) || {};
    if (!row) throw fail('BAD_CELL_' + w.cell);
    const rowRe = new RegExp('<row\\b[^>]*\\br="' + row + '"[^>]*?(?:/>|>([\\s\\S]*?)</row>)');
    const cellRe = new RegExp('<c\\b[^>]*\\br="' + w.cell + '"[^>]*?(?:/>|>[\\s\\S]*?</c>)');
    const rm = out.match(rowRe);
    if (rm) {
      const rowXml = rm[0];
      const cm = rowXml.match(cellRe);
      if (cm) {
        if (/<f[\s>]/.test(cm[0])) throw fail('FORMULA_CELL_NOT_WRITABLE_' + w.cell, 409);
        const style = (cm[0].match(/\bs="(\d+)"/) || [])[1] || null;
        out = out.replace(rowXml, rowXml.replace(cm[0], cellXml(w.cell, style, w.value, w.type)));
      } else {
        // Insert the cell in column order.
        const open = rowXml.endsWith('/>') ? rowXml.slice(0, -2) + '>' : rowXml.slice(0, rowXml.indexOf('>') + 1);
        const inner = rowXml.endsWith('/>') ? '' : rm[1] || '';
        const cells = inner.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
        const next = cells.findIndex(c => colNumber((c.match(/\br="([A-Z]+)\d+"/) || [])[1] || 'A') > col);
        const fresh = cellXml(w.cell, null, w.value, w.type);
        const body = next < 0 ? inner + fresh : inner.replace(cells[next], fresh + cells[next]);
        out = out.replace(rowXml, open + body + '</row>');
      }
    } else {
      const rows = [...out.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)];
      const after = rows.find(m => Number(m[1]) > row);
      const fresh = '<row r="' + row + '">' + cellXml(w.cell, null, w.value, w.type) + '</row>';
      out = after ? out.replace(after[0], fresh + after[0]) : out.replace('</sheetData>', fresh + '</sheetData>').replace('<sheetData/>', '<sheetData>' + fresh + '</sheetData>');
    }
  }
  return out;
}

export async function writeCells(buffer, writes) {
  if (!writes.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const target = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const rel = rels.match(new RegExp('<Relationship\\b[^>]*Id="' + m[2] + '"[^>]*Target="([^"]+)"')) || rels.match(new RegExp('<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="' + m[2] + '"'));
    if (rel) target[m[1].replace(/&amp;/g, '&')] = 'xl/' + rel[1].replace(/^\/?xl\//, '');
  }
  const bySheet = new Map();
  for (const w of writes) { if (!target[w.sheet]) throw fail('SHEET_NOT_FOUND_' + w.sheet, 422); bySheet.set(w.sheet, [...(bySheet.get(w.sheet) || []), w]); }
  for (const [sheet, list] of bySheet) {
    const path = target[sheet];
    zip.file(path, patchSheetXml(await zip.file(path).async('string'), list));
  }
  // The formulas' cached results are dropped in every sheet (they refer to each other), so that no
  // reader shows a stale status (« A FAIRE » after a « Oui ») : Excel, LibreOffice and Sheets compute.
  for (const path of Object.values(target)) {
    const xml = await zip.file(path).async('string');
    zip.file(path, xml.replace(/(<c\b[^>]*?)(\st="(?:str|e|b|n)")?([^>]*>)(<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>))<v>[\s\S]*?<\/v>/g, '$1$3$4'));
  }
  // Excel recalculates every formula when the copy is opened (the template's alerts stay right).
  zip.file('xl/workbook.xml', /<calcPr\b/.test(wbXml) ? wbXml.replace(/<calcPr\b([^>]*?)(\s*\/?>)/, (m, a, e) => '<calcPr' + a.replace(/\sfullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"' + e) : wbXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Checks a write against the structure: only input cells, values from the cell's list, dates.
export function validateWrites(structure, writes) {
  const fields = new Map();
  for (const s of structure.sheets) for (const r of s.rows) for (const f of r.fields) fields.set(s.name + '!' + f.cell, f);
  return writes.map(w => {
    const f = fields.get(w.sheet + '!' + w.cell);
    if (!f) throw fail('NOT_AN_INPUT_CELL_' + w.sheet + '!' + w.cell, 409);
    let value = w.value == null ? '' : typeof w.value === 'number' ? w.value : String(w.value).trim().slice(0, 4000);
    if (value !== '' && f.type === 'list' && f.options && !f.options.includes(value)) {
      const hit = f.options.find(o => o.toLowerCase() === String(value).toLowerCase());
      if (!hit) throw fail('VALUE_NOT_IN_LIST_' + w.cell, 422);
      value = hit;
    }
    if (value !== '' && f.type === 'date' && excelSerial(value) == null) throw fail('DATE_INVALID_' + w.cell, 422);
    return { sheet: w.sheet, cell: w.cell, value, type: f.type };
  });
}

// One place to write a copy in the Drive: an xlsx file (patched) or a Google Sheet (Sheets API).
// expectedModifiedTime protects against overwriting someone's edit made in between.
export async function writeToDriveCopy(drive, fileId, writes, { mimeType = null, expectedModifiedTime = null } = {}) {
  if (!writes.length) return { written: 0 };
  const meta = mimeType ? { mimeType } : await drive.getMeta(fileId);
  if (meta?.mimeType === 'application/vnd.google-apps.spreadsheet') {
    for (const w of writes) await drive.updateValues(fileId, "'" + w.sheet + "'!" + w.cell, [[w.type === 'date' ? String(w.value) : w.value]]);
    return { written: writes.length, via: 'sheets' };
  }
  // Compare-and-swap: the file's modification time is read BEFORE downloading it, and the upload is
  // refused by the Drive if someone changed the file in between (never overwrite a person's edit).
  // Up to 3 tries: re-read, re-apply, re-send.
  let r = null, lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const stamp = expectedModifiedTime && attempt === 0 ? expectedModifiedTime : (await drive.getMeta(fileId))?.modifiedTime;
    if (!stamp) throw new Error('WORKBOOK_NOT_FOUND');
    const buffer = await drive.downloadBuffer(fileId);
    const next = await writeCells(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer?.buffer || buffer || []), writes);
    try { r = await drive.updateBinary(fileId, { buffer: next, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', expectedModifiedTime: stamp }); lastError = null; break; }
    catch (e) { lastError = e; if (!/CONFLICT|MODIFIED|412|PRECONDITION/i.test(String(e.message || e))) throw e; }
  }
  if (lastError) throw lastError;
  return { written: writes.length, via: 'xlsx', modifiedTime: r?.modifiedTime || null };
}

export async function readDriveCopy(drive, fileId, cells, { mimeType = null } = {}) {
  const meta = mimeType ? { mimeType } : await drive.getMeta(fileId);
  if (meta?.mimeType === 'application/vnd.google-apps.spreadsheet') {
    const out = {};
    for (const c of cells) { const v = await drive.getValues(fileId, "'" + c.sheet + "'!" + c.cell).catch(() => null); out[c.sheet + '!' + c.cell] = String(v?.values?.[0]?.[0] ?? v?.[0]?.[0] ?? ''); }
    return out;
  }
  const buffer = await drive.downloadBuffer(fileId);
  return readCells(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer?.buffer || buffer || []), cells);
}
