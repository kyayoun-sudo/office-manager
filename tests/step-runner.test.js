import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { stepsInSheet, ledgerColumns, ledgerRows, runExtract, runReconcile, runAnomalies, runCutoff, runStep, planStep, RESULT_MARK } from '../lib/step-runner.js';

const GL = { header_row: 0, rows: [
  ['Date', 'N° compte', 'Libellé', 'Pièce', 'Débit', 'Crédit'],
  ['2025-03-01', '601100', 'Achat fournitures', 'F1', '1 500,00', ''],
  ['2025-03-01', '601100', 'Achat fournitures', 'F1', '1 500,00', ''],
  ['2025-12-28', '602000', 'Achat carburant', 'F2', '250', ''],
  ['2026-01-05', '602000', 'Achat carburant janvier', 'F3', '300', ''],
  ['2025-06-14', '401000', 'Fournisseur X', 'F4', '', '2 000'],
] };
const rows = ledgerRows(GL, ledgerColumns(GL.rows[0]));

test('a ledger is read from its headers, whatever the file: account, date, debit/credit', () => {
  const c = ledgerColumns(GL.rows[0]);
  assert.deepEqual([c.date, c.account, c.label, c.ref, c.debit, c.credit], [0, 1, 2, 3, 4, 5]);
  assert.equal(rows[0].amount, 1500); assert.equal(rows[4].amount, -2000); assert.equal(rows[0].row, 2);
});

test('the operations are code: extract by lines / accounts / period, reconcile, anomalies, cut-off', () => {
  assert.deepEqual(runExtract(rows, { accounts: ['60'], date_from: '2025-01-01', date_to: '2025-12-31' }).rows.map(r => r.row), [2, 3, 4]);
  assert.deepEqual(runExtract(rows, { row_from: 3, row_to: 4 }).rows.map(r => r.row), [3, 4]);
  const rec = runReconcile(rows, [{ account: '601100', amount: 3000 }, { account: '602000', amount: 500 }], { accounts: ['60'] });
  assert.deepEqual(rec.flags.map(f => f.account), ['602000']);
  const an = runAnomalies(rows, { period_start: '2025-01-01', period_end: '2025-12-31' });
  assert.ok(an.flags.some(f => f.kind === 'duplicate' && f.row === 3));
  assert.ok(an.flags.some(f => f.kind === 'out_of_period' && f.row === 5));
  const co = runCutoff(rows, { period_end: '2025-12-31', days: 10 });
  assert.deepEqual(co.rows.map(r => r.row), [4, 5]); assert.equal(co.flags[0].row, 5);
});

test('the steps are read in the working file itself (any model), numbered rows', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('ACH-01');
  ws.addRow(['ACH-01 — Walkthrough']); ws.addRow(['Étapes']); ws.addRow(['1.', 'Extraire du GL les comptes 60 de la ligne 2 à 400']); ws.addRow(['2', 'Rapprocher le total à la balance']);
  assert.deepEqual(stepsInSheet(ws).map(s => [s.n, s.row]), [[1, 3], [2, 4]]);
});

async function world() {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('ACH-01'); ws.addRow(['1.', 'Extraire du GL les comptes 60 sur 2025']);
  const mine = wb.addWorksheet('ACH-01_E1'); mine.addRow(['Ma feuille à moi']);   // a person's sheet with the same name: never replaced
  const files = { WP: { buf: Buffer.from(await wb.xlsx.writeBuffer()), mt: 't1', name: 'WP_C02.xlsx' } };
  const drive = { getMeta: async id => ({ id, name: files[id].name, modifiedTime: files[id].mt }), downloadBuffer: async id => files[id].buf,
    updateBinary: async (id, { buffer, expectedModifiedTime }) => { if (expectedModifiedTime !== files[id].mt) throw new Error('MEMORY_CONFLICT'); files[id] = { ...files[id], buf: buffer, mt: files[id].mt + 'x' }; } };
  const view = { editable: true, work: { status: 'in_progress' }, line: { code: 'ACH-01', title: 'Walkthrough' }, card: { objective: 'Comprendre' }, workpaper: { file_id: 'WP' } };
  const d = { drive, view: async () => view, readTable: async () => ({ ...GL, meta: { name: 'GL_2025.xlsx', modified_time: 'v1' } }),
    loop: { listRequests: async () => [{ document: 'Grand livre', status: 'to_confirm', pieces: [{ file_id: 'GLF', name: 'GL_2025.xlsx' }] }], periodOf: () => ({ start: '2025-01-01', end: '2025-12-31', label: 'Exercice 2025' }) },
    missionDocuments: async () => [], fetchRows: async () => [{ period_label: '2025' }], permissions: async () => ({ granted: false }), audit: async () => {} };
  return { files, d };
}

test('« J’ai compris » without AI: the person chooses; a file not among the mission’s is refused', async () => {
  const { d } = await world();
  const p = await planStep('org', 'M', 'ACH-01', { step: 1 }, { email: 'a@x' }, d);
  assert.equal(p.ai, 'AGENTS_NOT_AUTHORIZED'); assert.ok(p.missing.includes('operation'));
  const chosen = await planStep('org', 'M', 'ACH-01', { step: 1, operation: 'extract', source_file_id: 'SOMEWHERE_ELSE' }, { email: 'a@x' }, d);
  assert.equal(chosen.source_file_id, null); assert.equal(chosen.ready, false);
});

test('Exécuter: the code extracts, writes a SEPARATE sheet with its trace, never over a person’s sheet, reads it back', async () => {
  const { files, d } = await world();
  const r = await runStep('org', 'M', 'ACH-01', { plan: { step: { n: 1 }, operation: 'extract', source_file_id: 'GLF', params: { accounts: ['60'] } } }, { email: 'a@x', display_name: 'Awa' }, d);
  assert.equal(r.count, 4); assert.equal(r.verified, true);
  assert.equal(r.sheet, 'ACH-01_E1_2', 'the person’s sheet ACH-01_E1 is kept');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(files.WP.buf);
  assert.equal(String(wb.getWorksheet('ACH-01_E1').getCell('A1').value), 'Ma feuille à moi');
  const out = wb.getWorksheet('ACH-01_E1_2');
  assert.equal(out.getCell('A1').value, RESULT_MARK);
  assert.match(String(out.getCell('B5').value), /GL_2025\.xlsx \(version v1\)/);
  // Run again: the application's own result sheet is replaced, not multiplied.
  const again = await runStep('org', 'M', 'ACH-01', { plan: { step: { n: 1 }, operation: 'extract', source_file_id: 'GLF', params: { accounts: ['601'] } } }, { email: 'a@x' }, d);
  assert.equal(again.sheet, 'ACH-01_E1_2'); assert.equal(again.count, 2);
});
