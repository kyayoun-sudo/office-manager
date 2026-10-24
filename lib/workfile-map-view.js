// La carte du working file d'une procédure, pour l'écran et pour l'agent (2026-10-24).
// Mêmes droits que « Ma procédure » (procedureView) ; le classeur est relu dans le Drive, jamais copié dans la base.
// Écran construit depuis le fichier : chaque feuille s'affiche selon ce qu'elle demande (rôle de ses colonnes).
// Écriture : seulement ce qu'une PERSONNE saisit (faits, ou ses propres décisions), dans des cases vides du modèle,
// jamais une formule, une clé ou une case remplie par quelqu'un d'autre ; relu après écriture et tracé.
import ExcelJS from 'exceljs';
import { driveAdapter } from './drive-adapter.js';
import { procedureView, parseAmount } from './procedure-work.js';
import { mapWorkingFile, mapSummary, mayWrite, cellText, colNumber } from './workfile-map.js';
import { audit } from './audit-log.js';

const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const MAX_BYTES = 20 * 1024 * 1024;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ROWS_SHOWN = 60;

async function loadWorkbook(view, d) {
  const fileId = view.workpaper?.file_id;
  if (!fileId) throw fail('NO_WORKPAPER_FOR_CYCLE', 409);
  const drive = d.drive || driveAdapter;
  const meta = await drive.getMeta(fileId);
  if (Number(meta?.size || 0) > MAX_BYTES) throw fail('WORKBOOK_TOO_LARGE', 413);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await drive.downloadBuffer(fileId)));
  return { wb, meta, fileId, drive };
}

const isFormula = cell => !!(cell?.formula || (cell?.value && typeof cell.value === 'object' && (cell.value.formula || cell.value.sharedFormula)));
function shown(cell) {
  if (isFormula(cell)) return cell.value?.result != null ? cellText(cell.value.result) : null; // null = calculé par Excel, valeur non enregistrée
  return cellText(cell.value).trim();
}

// The values of one sheet's main table, by column (the screen is built from the map, the values from the file).
export function sheetView(wb, map, name, offset = 0) {
  const s = map.sheets.find(x => x.name === name);
  if (!s) return null;
  const t = s.main >= 0 ? s.tables[s.main] : null;
  const ws = wb.getWorksheet(name);
  const base = { name: s.name, role: s.role, title: s.title, instructions: s.instructions || [], params: s.params || null, test_code: s.test_code };
  if (!t || !ws) return { ...base, table: null, rows: [], filled: 0 };
  // « Rempli » = du travail fait, pas le texte que le modèle porte déjà : sur un test, une décision prise ; sur une lead,
  // un montant saisi ; ailleurs, une saisie (données du client importées).
  const judg = t.columns.filter(c => c.role === 'judgment').map(c => c.col);
  const facts = t.columns.filter(c => ['fact', 'free'].includes(c.role)).map(c => c.col);
  const has = v => v !== '' && v != null;
  const done = s.role === 'test' && judg.length ? cells => judg.some(c => has(cells[c]))
    : s.role === 'lead' ? cells => facts.some(c => has(cells[c]) && Number.isFinite(Number(String(cells[c]).replace(/[\s ]/g, '').replace(',', '.'))))
    : cells => [...facts, ...judg].some(c => has(cells[c]));
  const rows = [];
  let filled = 0;
  for (let r = t.first_row; r <= t.last_row; r++) {
    const row = ws.getRow(r), cells = {};
    for (const c of t.columns) cells[c.col] = shown(row.getCell(colNumber(c.col)));
    if (done(cells)) filled++;
    if (r - t.first_row >= offset && rows.length < ROWS_SHOWN) rows.push({ row: r, cells });
  }
  return { ...base, table: { header_row: t.header_row, first_row: t.first_row, last_row: t.last_row, capacity: t.capacity, reads: t.reads_sheets, prefilled_rows: t.prefilled_rows,
    columns: t.columns.map(c => ({ col: c.col, header: c.header, role: c.role, list: c.list, feeds_result: !!c.feeds_result })) }, rows, filled, offset };
}

export async function workfileMapView(orgId, missionId, code, account, d = {}) {
  const view = await (d.view || procedureView)(orgId, missionId, code, account, d);
  const { wb, meta, fileId } = await loadWorkbook(view, d);
  const map = mapWorkingFile(wb, { file: { id: fileId, name: meta?.name || null, modified: meta?.modifiedTime || null }, now: d.now });
  const sheet = map.sheets.find(s => s.test_code === String(code).toUpperCase()) || map.sheets.find(s => s.name === String(code)) || null;
  const wanted = d.sheet && map.sheets.some(s => s.name === d.sheet) ? d.sheet : (sheet?.name || map.order[0]);
  const fill = n => { const v = sheetView(wb, map, n); return v ? v.filled : 0; };
  return {
    summary: mapSummary(map),
    file: map.file,
    // The current test in full (its tables and the role of each column), the rest as a summary.
    procedure: sheet ? { sheet, test: map.tests.find(t => t.sheet === sheet.name) || null } : null,
    pbc: map.pbc,
    programme: map.programme,
    sheet_view: wanted ? sheetView(wb, map, wanted, Math.max(0, Number(d.offset) || 0)) : null,
    // How full each data / lead sheet is: the screen says « remplir D1 d'abord » from this, never by guessing.
    filled: Object.fromEntries(map.sheets.filter(s => ['data', 'lead', 'test', 'reconciliation'].includes(s.role)).map(s => [s.name, fill(s.name)])),
    editable: view.editable !== false && !['submitted', 'reviewed'].includes(view.work?.status)
  };
}

// A person fills cells of the working file from the screen. `cells` = [{ sheet, address, value }].
export async function writeWorkfileCells(orgId, missionId, code, account, body = {}, d = {}) {
  const list = (Array.isArray(body.cells) ? body.cells : []).slice(0, 50);
  if (!list.length) throw fail('NO_CELLS', 400);
  const view = await (d.view || procedureView)(orgId, missionId, code, account, d);
  if (view.editable === false) throw fail('NOT_PREPARER', 403);
  if (['submitted', 'reviewed'].includes(view.work?.status)) throw fail('IN_REVIEW_OR_REVIEWED', 409);
  const { wb, meta, fileId, drive } = await loadWorkbook(view, d);
  const map = mapWorkingFile(wb);
  const written = [], refused = [];
  for (const x of list) {
    const sheet = String(x.sheet || ''), address = String(x.address || '').toUpperCase(), raw = String(x.value ?? '').slice(0, 1000).trim();
    const ws = wb.getWorksheet(sheet);
    const check = mayWrite(map, sheet, address);
    // A judgment is never written by the application on its own; here the PERSON gives it (her decision, from the screen).
    const ok = check.ok || check.reason === 'JUDGMENT_OF_THE_AUDITOR';
    if (!ws || !ok) { refused.push({ sheet, address, reason: ws ? check.reason : 'SHEET_NOT_FOUND' }); continue; }
    const cell = ws.getCell(address);
    if (isFormula(cell)) { refused.push({ sheet, address, reason: 'CALCULATED' }); continue; }
    const current = cellText(cell.value).trim(), expected = String(x.expected ?? '').trim();
    if (current !== '' && current !== expected) { refused.push({ sheet, address, reason: 'FILLED_BY_SOMEONE_ELSE', current }); continue; }
    const listValues = check.column?.list;
    if (raw && listValues?.length && !listValues.includes(raw)) { refused.push({ sheet, address, reason: 'NOT_IN_LIST', allowed: listValues }); continue; }
    const n = /^[-+]?[\d\s.,]+$/.test(raw) && /\d/.test(raw) ? parseAmount(raw) : null;
    cell.value = raw === '' ? null : (Number.isFinite(n) ? n : raw);
    written.push({ sheet, address, value: cell.value, role: check.column?.role || null });
  }
  if (!written.length) return { written, refused, sheet_view: null };
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  // Written only on the version that was read; if someone saved in between, nothing is forced.
  await drive.updateBinary(fileId, { buffer, mimeType: XLSX, expectedModifiedTime: meta?.modifiedTime });
  const back = new ExcelJS.Workbook(); await back.xlsx.load(Buffer.from(await drive.downloadBuffer(fileId)));
  const verified = written.every(w => cellText(back.getWorksheet(w.sheet)?.getCell(w.address).value) === cellText(w.value));
  await audit(orgId, { agent: 'enhanced-auditor', mission_id: missionId, action_type: 'WORKFILE_CELLS_WRITTEN', source_ref: fileId + '#' + code,
    input: written, decision: 'written_by_person', reviewer: account?.email || null, status: verified ? 'succeeded' : 'failed',
    error: verified ? null : 'READ_BACK_MISMATCH', verified_at: verified ? new Date().toISOString() : null }).catch(() => null);
  if (!verified) throw fail('READ_BACK_MISMATCH', 502);
  const after = mapWorkingFile(back);
  return { written, refused, verified, sheet_view: sheetView(back, after, written[0].sheet) };
}
