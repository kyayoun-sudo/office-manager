// Large write receipts live in the mission's Drive, not in the procedure's database row (2026-11-04).
// Cause, proved in the Postgres logs of the pilot (2026-11-03, SQLSTATE 57014): the receipt of an import kept every written cell
// with its value, source name, file id and line (~280 bytes per cell). Two imports of auxiliary ledgers made the PRJ-01 row of
// office_procedure_work 1.9 MB; every checkpoint rewrote the whole row and the mission change trigger converted and compared it,
// so the UPDATE averaged ~1 s and passed the 8 s statement timeout under load. The general ledgers of two years would have made
// it tens of MB. Principle 5 (reference first): the client's values stay at the firm (Drive); the database keeps an id, a hash,
// a count and a short preview. The full list is read back only when a person confirms, undoes or pages through a receipt, and
// it is checked against its sha256 first: a changed or missing file is said, never trusted.
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const INLINE_CELLS_BYTES = 32 * 1024;
export const PREVIEW_CELLS = 20;
const fail = (code, status = 409) => Object.assign(new Error(code), { statusCode: status });
const sha = s => createHash('sha256').update(s).digest('hex');
const payloadOf = (planId, cells) => JSON.stringify({ plan_id: planId, cells });

export const isStored = receipt => Boolean(receipt?.cells_ref?.file_id);
export const cellsTotal = receipt => (isStored(receipt) ? receipt.cells_ref.count : (receipt?.cells || []).length);
export const cellsPreview = receipt => (isStored(receipt) ? receipt.cells_preview || [] : (receipt?.cells || []).slice(0, PREVIEW_CELLS));
export const firstCell = receipt => cellsPreview(receipt)[0] || null;
// Sheets the receipt wrote to, without reading the stored list.
export const cellSheets = receipt => (isStored(receipt) ? receipt.cell_sheets || [] : [...new Set((receipt?.cells || []).map(c => c.sheet))]);

// The full list of cells, from the row or from its Drive file (verified by hash).
export async function receiptCells(receipt, planId, d = {}) {
  if (!receipt) return [];
  if (!isStored(receipt)) return receipt.cells || [];
  const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
  const ref = receipt.cells_ref;
  const meta = await drive.getMeta(ref.file_id).catch(() => null);
  if (!meta || meta.trashed) throw fail('RECEIPT_CELLS_FILE_MISSING');
  let text;
  try { text = gunzipSync(Buffer.from(await drive.downloadBuffer(ref.file_id))).toString('utf8'); } catch { throw fail('RECEIPT_CELLS_FILE_UNREADABLE'); }
  if (sha(text) !== ref.sha256) throw fail('RECEIPT_CELLS_FILE_CHANGED');
  const data = JSON.parse(text);
  if (data.plan_id !== planId || !Array.isArray(data.cells) || data.cells.length !== ref.count) throw fail('RECEIPT_CELLS_FILE_CHANGED');
  return data.cells;
}

// A page of cells: the preview answers without Drive when it covers the page.
export async function receiptPage(receipt, planId, offset, count, d = {}) {
  if (!isStored(receipt)) return (receipt?.cells || []).slice(offset, offset + count);
  const preview = cellsPreview(receipt);
  if (offset + count <= preview.length) return preview.slice(offset, offset + count);
  return (await receiptCells(receipt, planId, d)).slice(offset, offset + count);
}

// Moves every receipt whose cells are larger than INLINE_CELLS_BYTES to a gzip file in <mission>/_OFFICE_MANAGER.
// Idempotent: the file name carries the plan id and the content hash, so a retried save (MEMORY_CONFLICT) finds it again
// instead of creating a second file, and a corrected receipt gets a new file (the old one is kept: nothing is deleted).
export async function storeLargeReceipts(orgId, missionId, walkthrough, d = {}) {
  if (!Array.isArray(walkthrough)) return walkthrough;
  const big = walkthrough.filter(r => Array.isArray(r?.receipt?.cells) && JSON.stringify(r.receipt.cells).length > INLINE_CELLS_BYTES);
  if (!big.length) return walkthrough;
  const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
  const home = d.receiptFolder !== undefined ? d.receiptFolder
    : await (d.missionMemoryHome || (await import('./mission-files.js')).missionMemoryHome)({ id: missionId, org_id: orgId }, d);
  if (!home) throw fail('RECEIPT_FOLDER_UNKNOWN');
  const done = new Map();
  for (const r of big) {
    const text = payloadOf(r.id, r.receipt.cells), hash = sha(text), name = `RECU_${r.id}_${hash.slice(0, 12)}.json.gz`;
    const found = (await drive.findFilesByExactName(name, home)) || [];
    let file = found[0];
    if (!file) file = await drive.createBinary({ name, parentId: home, buffer: gzipSync(Buffer.from(text, 'utf8')), mimeType: 'application/gzip' });
    if (!file?.id) throw fail('RECEIPT_STORE_FAILED', 502);
    const { cells, ...rest } = r.receipt;
    done.set(r, { ...r, receipt: { ...rest, cells_ref: { file_id: file.id, name, folder_id: home, sha256: hash, count: cells.length },
      cell_sheets: [...new Set(cells.map(c => c.sheet))], cells_preview: cells.slice(0, PREVIEW_CELLS) } });
  }
  // Each stored file is read back once: « stored » is said only when the copy in Drive is exactly the list.
  for (const [, r] of done) await receiptCells(r.receipt, r.id, { ...d, drive });
  return walkthrough.map(r => done.get(r) || r);
}
