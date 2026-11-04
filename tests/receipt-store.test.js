// The cause of the 57014 timeouts on PRJ-01 (pilot, 2026-11-03, read in the Postgres logs): the receipt of an import kept every
// written cell in the procedure's row, the row reached 1.9 MB and each checkpoint rewrote it whole under the mission change trigger.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { gzipSync } from 'node:zlib';
import { patch } from '../lib/procedure-work.js';
import { receiptCells, cellsTotal, cellsPreview, cellSheets, INLINE_CELLS_BYTES } from '../lib/receipt-store.js';
import { undoImport, importsDone } from '../lib/workfile-undo.js';
import { dialogueRecords } from '../lib/workpaper-dialogue.js';

const paul = { email: 'paul@cabinet.test', role: 'partner' };
const COLS = ['B', 'C', 'D', 'E', 'F'];
// Same shape as the real receipt (GRAND_LIVRE_AUXILIAIRE_2023.xls → D1_GL_PROJET, ~280 bytes per cell).
function importRecord(rows, id = 'plan-1') {
  const cells = [];
  for (let i = 0; i < rows; i++) for (const c of COLS) cells.push({ sheet: 'D1_GL_PROJET', cell: c + (11 + i), value: c === 'F' ? 1000 + i : c + '-' + i,
    file_id: '1Vfwf1BGKUoA1TUUX_9FMxmwbzd4wSL-V', source: 'GRAND_LIVRE_AUXILIAIRE_2023.xls', raw_value: c + '-' + i, reference: 'Sheet1 — Ligne source ' + (15 + i), source_value: true });
  return { kind: 'sop-document-work', id, step: 2, file_id: 'WP', status: 'applied', sheet: 'IMPORT_' + id.slice(0, 8), findings: [], questions: [], sources: [],
    at: '2026-11-03T15:00:00Z', confirmation: { status: 'awaiting_confirmation' },
    receipt: { file_id: 'WP', sheet: 'IMPORT_' + id.slice(0, 8), model_cells: cells.length, source_facts: 0, import_rows: rows, set_aside: 0, mapping: [], source_file_id: 'G23', cells } };
}
function fakeDrive(files = new Map()) {
  let n = 0;
  return { files, created: () => [...files.values()].filter(f => f.parent === 'MEM'),
    findFilesByExactName: async (name, parent) => [...files.entries()].filter(([, f]) => f.name === name && f.parent === parent).map(([id, f]) => ({ id, name: f.name })),
    createBinary: async ({ name, parentId, buffer }) => { const id = 'R' + (++n); files.set(id, { name, parent: parentId, bytes: Buffer.from(buffer), modifiedTime: 't' + n }); return { id, name }; },
    getMeta: async id => (files.has(id) ? { id, name: files.get(id).name, modifiedTime: files.get(id).modifiedTime, size: files.get(id).bytes.length } : null),
    downloadBuffer: async id => files.get(id).bytes,
    updateBinary: async (id, { buffer }) => { const f = files.get(id); f.bytes = Buffer.from(buffer); f.modifiedTime = f.modifiedTime + "'"; return { id }; } };
}
function fakeTable() {
  const writes = [];
  const fetchRows = async (path, opts = {}) => { if (opts.method === 'PATCH') { writes.push(opts.body); return [JSON.parse(opts.body)]; } return []; };
  return { writes, fetchRows };
}

test('a large import receipt is stored in the mission Drive: the row stays small, the full list is read back by hash', async () => {
  const record = importRecord(3651 / 5 | 0);
  const before = JSON.stringify(record).length;
  assert.ok(before > 200_000, 'reproduces the heavy receipt (' + before + ' bytes)');
  const drive = fakeDrive(), table = fakeTable();
  const row = { id: 'W', org_id: 'O', office_mission_id: 'M', status: 'in_progress', updated_at: 'u1', walkthrough: [record],
    reviews: [{ kind: 'signoff', level: 'senior', by: 's@x' }], wp_sync: { status: 'WRITTEN', content_hash: 'h' } };
  // A checkpoint of another job: the receipt is passed back unchanged, as every writer does.
  await patch('O', row, { walkthrough: [record, { kind: 'step-brain-job', id: 'J', seq: 1 }] }, paul, table.fetchRows, { drive, receiptFolder: 'MEM' });
  const body = JSON.parse(table.writes[0]);
  assert.ok(table.writes[0].length < 40_000, 'row written: ' + table.writes[0].length + ' bytes');
  const stored = body.walkthrough[0].receipt;
  assert.equal(stored.cells, undefined);
  assert.equal(cellsTotal(stored), record.receipt.cells.length);
  assert.deepEqual(cellSheets(stored), ['D1_GL_PROJET']);
  assert.equal(cellsPreview(stored).length, 20);
  assert.equal(drive.created().length, 1);
  assert.match(drive.created()[0].name, /^RECU_plan-1_[0-9a-f]{12}\.json\.gz$/);
  assert.deepEqual(await receiptCells(stored, 'plan-1', { drive }), record.receipt.cells);
  // A retried save (MEMORY_CONFLICT) finds the same file again: never a second one.
  await patch('O', row, { walkthrough: [record] }, paul, table.fetchRows, { drive, receiptFolder: 'MEM' });
  assert.equal(drive.created().length, 1);
  // Changed or missing file: said, never trusted.
  drive.files.get('R1').bytes = gzipSync(Buffer.from(JSON.stringify({ plan_id: 'plan-1', cells: [] })));
  await assert.rejects(receiptCells(stored, 'plan-1', { drive }), /RECEIPT_CELLS_FILE_CHANGED/);
  // A file blown up far beyond its cells (decompression bomb) is refused before it is trusted.
  drive.files.get('R1').bytes = gzipSync(Buffer.alloc(stored.cells_ref.count * 4096 + 200000, 32));
  await assert.rejects(receiptCells(stored, 'plan-1', { drive }), /RECEIPT_CELLS_FILE_UNREADABLE/);
  drive.files.delete('R1');
  await assert.rejects(receiptCells(stored, 'plan-1', { drive }), /RECEIPT_CELLS_FILE_MISSING/);
});

test('a small receipt stays in the row (no Drive call)', async () => {
  const record = importRecord(3), table = fakeTable();
  assert.ok(JSON.stringify(record.receipt.cells).length < INLINE_CELLS_BYTES);
  const drive = { findFilesByExactName: () => assert.fail('no Drive'), createBinary: () => assert.fail('no Drive') };
  await patch('O', { id: 'W', org_id: 'O', office_mission_id: 'M', walkthrough: [] }, { walkthrough: [record] }, paul, table.fetchRows, { drive, receiptFolder: 'MEM' });
  assert.equal(JSON.parse(table.writes[0]).walkthrough[0].receipt.cells.length, 15);
});

test('no mission folder: the row is written as before, the work is never blocked', async () => {
  const record = importRecord(300), table = fakeTable();
  await patch('O', { id: 'W', org_id: 'O', office_mission_id: 'M', walkthrough: [] }, { walkthrough: [record] }, paul, table.fetchRows, { drive: fakeDrive(), receiptFolder: null });
  assert.equal(JSON.parse(table.writes[0]).walkthrough[0].receipt.cells.length, 1500);
});

test('undo and the receipt dialogue work from a stored receipt', async () => {
  const rows = 400, record = importRecord(rows), drive = fakeDrive(), table = fakeTable();
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('D1_GL_PROJET'); wb.addWorksheet(record.receipt.sheet);
  for (const c of record.receipt.cells) ws.getCell(c.cell).value = c.value;
  drive.files.set('WP', { name: 'NL-T01.xlsx', parent: 'WPF', bytes: Buffer.from(await wb.xlsx.writeBuffer()), modifiedTime: 'w1' });
  await patch('O', { id: 'W', org_id: 'O', office_mission_id: 'M', walkthrough: [] }, { walkthrough: [record] }, paul, table.fetchRows, { drive, receiptFolder: 'MEM' });
  const work = { ...JSON.parse(table.writes[0]), status: 'in_progress' };
  const view = { editable: true, work, workpaper: { file_id: 'WP' }, card: { steps: [] } };
  const shown = dialogueRecords(view)[0];
  assert.equal(shown.receipt.cells.length, 20);
  assert.equal(shown.receipt.cells_total, rows * 5);
  assert.equal(importsDone(view)[0].sheet, 'D1_GL_PROJET');
  let saved;
  const r = await undoImport('O', 'M', 'PRJ-01', { plan_id: 'plan-1' }, paul, { view: async () => view, drive, audit: async () => null, noteMissionEvent: async () => null, save: async (o, w, ch) => { saved = ch; } });
  assert.equal(r.cleared, rows * 5, 'every imported cell is cleared, not only the preview');
  const back = new ExcelJS.Workbook(); await back.xlsx.load(drive.files.get('WP').bytes);
  assert.equal(back.getWorksheet('D1_GL_PROJET').getCell('F' + (10 + rows)).value, null);
  assert.equal(saved.walkthrough[0].status, 'undone');
});
