// La carte du working file d'une procédure, pour l'écran et pour l'agent (2026-10-24). Lecture seule.
// Mêmes droits que « Ma procédure » (procedureView) ; le classeur est relu dans le Drive, jamais copié dans la base.
import ExcelJS from 'exceljs';
import { driveAdapter } from './drive-adapter.js';
import { procedureView } from './procedure-work.js';
import { mapWorkingFile, mapSummary } from './workfile-map.js';

const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const MAX_BYTES = 20 * 1024 * 1024;

export async function workfileMapView(orgId, missionId, code, account, d = {}) {
  const view = await (d.view || procedureView)(orgId, missionId, code, account, d);
  const fileId = view.workpaper?.file_id;
  if (!fileId) throw fail('NO_WORKPAPER_FOR_CYCLE', 409);
  const drive = d.drive || driveAdapter;
  const meta = await drive.getMeta(fileId);
  if (Number(meta?.size || 0) > MAX_BYTES) throw fail('WORKBOOK_TOO_LARGE', 413);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await drive.downloadBuffer(fileId)));
  const map = mapWorkingFile(wb, { file: { id: fileId, name: meta?.name || null, modified: meta?.modifiedTime || null }, now: d.now });
  const sheet = map.sheets.find(s => s.test_code === String(code).toUpperCase()) || map.sheets.find(s => s.name === String(code)) || null;
  return {
    summary: mapSummary(map),
    file: map.file,
    // The current test in full (its tables and the role of each column), the rest as a summary.
    procedure: sheet ? { sheet, test: map.tests.find(t => t.sheet === sheet.name) || null } : null,
    pbc: map.pbc,
    programme: map.programme
  };
}
