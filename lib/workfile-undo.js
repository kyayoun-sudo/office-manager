// Annuler un import (Paul, 2026-10-25 : « j'ai fait une erreur, je veux un bouton supprimer »).
// Seules les cases que CET import a écrites sont vidées, et seulement si elles ont encore la valeur importée : une case modifiée depuis
// par quelqu'un est gardée et signalée. Les formats et les formules du modèle restent ; les lignes ajoutées en agrandissant le tableau
// restent (vides) ; la feuille de trace de l'import est gardée et marquée « annulé ». Écrit sur la version lue, relu, tracé.
import ExcelJS from 'exceljs';
import { procedureView, patch } from './procedure-work.js';
import { driveAdapter } from './drive-adapter.js';
import { rest } from './supabase.js';
import { audit } from './audit-log.js';

const fail = code => Object.assign(new Error(code), { statusCode: 409 });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const same = (v, stored) => (v instanceof Date ? v.toISOString() : v) === stored;

// The imports of this procedure that can still be cancelled (newest first).
export function importsDone(view) {
  return (view.work?.walkthrough || []).filter(r => r.kind === 'sop-document-work' && r.receipt?.import_rows != null && r.file_id === view.workpaper?.file_id)
    .map(r => ({ plan_id: r.id, at: r.at, sheet: (r.receipt.cells[0] || {}).sheet || null, rows: r.receipt.import_rows, source_file_id: r.receipt.source_file_id || null,
      source: (r.receipt.cells[0] || {}).source || null, status: r.status, undone: r.undone || null }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export async function undoImport(org, mission, code, body = {}, account, d = {}) {
  if (!account?.email) throw fail('HUMAN_IDENTITY_REQUIRED');
  const view = await (d.view || procedureView)(org, mission, code, account, d);
  if (view.editable === false || ['submitted', 'reviewed'].includes(view.work?.status)) throw fail('IN_REVIEW_OR_NOT_EDITABLE');
  const record = (view.work.walkthrough || []).find(r => r.id === body.plan_id && r.kind === 'sop-document-work' && r.receipt?.import_rows != null);
  if (!record) throw fail('IMPORT_NOT_FOUND');
  if (record.status === 'undone') throw fail('IMPORT_ALREADY_UNDONE');
  if (record.file_id !== view.workpaper?.file_id) throw fail('IMPORT_OF_ANOTHER_WORKBOOK');
  const drive = d.drive || driveAdapter, fileId = view.workpaper.file_id;
  const meta = await drive.getMeta(fileId);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await drive.downloadBuffer(fileId)));
  const cleared = [], kept = [];
  for (const c of record.receipt.cells || []) {
    const cell = wb.getWorksheet(c.sheet)?.getCell(c.cell);
    if (!cell) continue;
    if (cell.formula || !same(cell.value, c.value)) { kept.push({ sheet: c.sheet, cell: c.cell }); continue; }
    cell.value = null; cleared.push({ sheet: c.sheet, cell: c.cell });
  }
  const log = record.receipt.sheet && wb.getWorksheet(record.receipt.sheet);
  if (log) log.getCell('A5').value = 'ANNULÉ le ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' par ' + account.email + ' : ' + cleared.length + ' case(s) vidée(s)' + (kept.length ? ', ' + kept.length + ' modifiée(s) depuis, gardée(s)' : '');
  if (cleared.length || log) {
    wb.calcProperties.fullCalcOnLoad = true;
    await drive.updateBinary(fileId, { buffer: Buffer.from(await wb.xlsx.writeBuffer()), mimeType: XLSX, expectedModifiedTime: meta?.modifiedTime });
    const back = new ExcelJS.Workbook(); await back.xlsx.load(Buffer.from(await drive.downloadBuffer(fileId)));
    if (!cleared.every(c => { const v = back.getWorksheet(c.sheet)?.getCell(c.cell).value; return v == null || v === ''; })) throw fail('WORKPAPER_WRITE_NOT_VERIFIED');
  }
  const undone = { by: account.email, at: new Date().toISOString(), cleared: cleared.length, kept_changed: kept.length };
  await (d.save || patch)(org, view.work, { walkthrough: view.work.walkthrough.map(r => (r.id === record.id ? { ...r, status: 'undone', undone } : r)) }, account, d.fetchRows || rest);
  await (d.audit || audit)(org, { agent: 'enhanced-auditor', mission_id: mission, action_type: 'WORKFILE_IMPORT_UNDONE', source_ref: fileId + '#' + code, input: { plan_id: record.id, sheet: record.receipt.sheet },
    decision: cleared.length + ' case(s) vidée(s), ' + kept.length + ' gardée(s)', approved_by: account.email, status: 'succeeded', verified_at: new Date().toISOString() }).catch(() => null);
  if (record.receipt.source_file_id) await (d.noteMissionEvent || (await import('./mission-files.js')).noteMissionEvent)(org, mission, record.receipt.source_file_id, { agent: 'enhanced-auditor', what: 'import annulé', detail: (record.receipt.cells[0]?.sheet || '') + ' : ' + cleared.length + ' case(s) vidée(s)', by: account.email }, d).catch(() => null);
  return { plan_id: record.id, ...undone, kept };
}
