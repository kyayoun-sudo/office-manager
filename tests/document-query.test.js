import test from 'node:test';
import assert from 'node:assert/strict';
import { runQuery, cleanQuery } from '../lib/document-query.js';
import { readDocumentWindow } from '../lib/document-content.js';
import { reasonWithDocuments, documentIdsIn } from '../lib/document-reasoning.js';

// A general ledger of 120 000 entries over 40 accounts, built the way readPiece hands it over (true row numbers).
const ACCOUNTS = Array.from({ length: 40 }, (_, i) => String(401000 + i * 100));
function ledgerPiece(n = 120000) {
  const rows = [{ n: 1, v: ['Date', 'Compte', 'Libellé', 'Débit', 'Crédit'] }];
  for (let i = 0; i < n; i++) rows.push({ n: i + 2, v: [String(1 + (i % 28)).padStart(2, '0') + '/' + String(1 + (i % 12)).padStart(2, '0') + '/2024', ACCOUNTS[i % 40], 'Écriture ' + i, i % 2 ? 100 : 0, i % 2 ? 0 : 40] });
  return { sheets: [{ name: 'GL', rows }] };
}
const piece = ledgerPiece();

test('structure shows the sheet, the header row and what each column holds, without the 120 000 lines', () => {
  const r = runQuery(piece, { op: 'structure' });
  assert.equal(r.rows_in_sheet, 120001); assert.equal(r.header_row, 1); assert.equal(r.columns[1].distinct, 40); assert.equal(r.columns[3].numbers, 120000);
  assert.ok(JSON.stringify(r).length < 20000);
});

test('search finds the lines of one account and pages through them', () => {
  const r = runQuery(piece, { op: 'search', text: '401100', col: 'B', limit: 10 });
  assert.equal(r.matches_total, 3000); assert.equal(r.lines.length, 10); assert.equal(r.next_offset, 10);
  assert.equal(r.lines[0].cells.find(c => c.column === 'B').value, '401100');
  const next = runQuery(piece, { op: 'search', text: '401100', col: 'B', limit: 10, offset: r.next_offset });
  assert.notEqual(next.lines[0].row, r.lines[0].row);
});

test('rows by condition, by range and by numbers return the true row numbers', () => {
  const pre = runQuery(piece, { op: 'rows', where: [{ col: 'B', op: 'prefix', value: '4010' }], limit: 5 });
  assert.equal(pre.matches_total, 3000); assert.equal(pre.lines.length, 5);
  const range = runQuery(piece, { op: 'rows', row_from: 1200, row_to: 1203 });
  assert.deepEqual(range.lines.map(l => l.row), [1200, 1201, 1202, 1203]);
  const some = runQuery(piece, { op: 'rows', row_numbers: [12, 15], cols: ['B', 'D'] });
  assert.deepEqual(some.lines.map(l => l.row), [12, 15]); assert.deepEqual(some.lines[0].cells.map(c => c.column), ['B', 'D']);
});

test('aggregate computes sums by account, debit minus credit, with a period condition, computed by the code', () => {
  const r = runQuery(piece, { op: 'aggregate', group_by: 'B', sum: ['D'], minus: 'E', sort: 'key', limit: 100 });
  assert.equal(r.groups_total, 40); assert.equal(r.total.count, 120000);
  // 60 000 debit lines of 100 and 60 000 credit lines of 40 over the whole ledger.
  assert.equal(r.total.sums[0], 60000 * 100 - 60000 * 40);
  assert.equal(r.groups[0].key, '401000'); assert.equal(r.groups[0].count, 3000);
  const jan = runQuery(piece, { op: 'aggregate', sum: ['D'], where: [{ col: 'A', op: 'between', from: '2024-01-01', to: '2024-01-31' }] });
  assert.equal(jan.total.count, 10000);
  const classes = runQuery(piece, { op: 'aggregate', group_by: 'B', group_part: 'prefix', prefix_length: 3, sum: ['D'] });
  assert.equal(classes.groups_total, 4); assert.equal(classes.groups.find(g => g.key === '401').count, 30000);
});

test('a wrong request is refused with its reason and every answer stays bounded', () => {
  assert.throws(() => cleanQuery({ op: 'delete' }), /DOCUMENT_QUERY_INVALID/);
  assert.throws(() => cleanQuery({ op: 'rows', where: [{ col: 'compte', op: 'equals', value: 1 }] }), e => e.detail.includes('lettre de colonne'));
  assert.throws(() => cleanQuery({ op: 'rows', limit: 5000 }), /DOCUMENT_QUERY_INVALID/);
  assert.throws(() => runQuery(piece, { op: 'structure', sheet: 'absente' }), /SOURCE_SHEET_NOT_FOUND/);
  const wide = runQuery(piece, { op: 'rows', row_from: 1, limit: 40 });
  assert.ok(JSON.stringify(wide).length < 20000);
});

// The real reader path: a 100 000-line CSV, parsed once for several questions.
function csvDrive(lines) {
  const text = ['Date;Compte;Libellé;Débit;Crédit'].concat(Array.from({ length: lines }, (_, i) => '01/03/2024;' + ACCOUNTS[i % 40] + ';Écriture ' + i + ';' + (i % 2 ? 100 : 0) + ';' + (i % 2 ? 0 : 40))).join('\n');
  const bytes = Buffer.from(text); let downloads = 0;
  return { downloads: () => downloads, drive: { getMeta: async () => ({ id: 'GL', name: 'x.csv', size: bytes.length, modifiedTime: 'v1' }), downloadBuffer: async () => { downloads++; return bytes; } } };
}
test('the document reader answers queries on a 100 000-line file and parses it once', async () => {
  const c = csvDrive(100000);
  const s = await readDocumentWindow({ id: 'GL' }, c.drive, { file_id: 'GL', query: { op: 'structure' } });
  assert.equal(s.window.format, 'table-query'); assert.equal(s.window.rows_in_sheet, 100001);
  const a = await readDocumentWindow({ id: 'GL' }, c.drive, { file_id: 'GL', query: { op: 'aggregate', group_by: 'B', sum: ['D', 'E'], limit: 3 } });
  assert.equal(a.window.groups_total, 40); assert.equal(a.window.total.sums[0], 50000 * 100); assert.equal(a.window.total.sums[1], 50000 * 40);
  const bad = await readDocumentWindow({ id: 'GL' }, c.drive, { file_id: 'GL', query: { op: 'rows', cols: ['xx1'] } });
  assert.match(bad.window.error, /DOCUMENT_QUERY_INVALID/);
  assert.equal(c.downloads(), 1);
});
test('a query on a document that is not a table says so instead of reading it as text', async () => {
  const bytes = Buffer.from('Lettre simple sans tableau.');
  const drive = { getMeta: async () => ({ id: 'L', name: 'l.txt', size: bytes.length, modifiedTime: 'v1' }), downloadBuffer: async () => bytes };
  const r = await readDocumentWindow({ id: 'L' }, drive, { file_id: 'L', query: { op: 'structure' } });
  assert.match(r.window.error, /DOCUMENT_QUERY_NEEDS_TABLE/);
});

// The AI loop: it asks, the code answers on the whole table, a wrong request is explained and not fatal.
test('the AI queries a big table through the reasoning loop and is told when its request is wrong', async () => {
  const state = { editable: true, card: {}, line: { code: 'X-01' }, workpaper: { file_id: 'WP' }, work: { id: 'W', status: 'in_progress', walkthrough: [] } };
  const c = csvDrive(5000); let answer = {}; const seen = [];
  const drive = { getMeta: async () => ({ modifiedTime: 'v1' }) };
  const d = { permissions: async () => ({ granted: true }), view: async () => structuredClone(state), save: async (_, row, patch) => { Object.assign(state.work, structuredClone(patch)); return structuredClone(state.work); },
    readDocumentWindow: (doc, dr, request) => readDocumentWindow(doc, c.drive, request, {}),
    ai: async (_, request) => { const input = JSON.parse(request.input); seen.push(input.feedback.at(-1)); return { provider: 'x', text: JSON.stringify(typeof answer === 'function' ? answer(input) : answer) }; } };
  const run = () => reasonWithDocuments({ org: 'O', mission: 'M', code: 'X-01', view: structuredClone(state), documents: [{ id: 'GL', name: 'inconnu' }], drive, task: 'Remplir D2', context: {}, schema: '{"source_file_id":"id"}', evidenceIds: documentIdsIn, key: 'k', body: {}, account: {} }, d);
  answer = { query: { file_id: 'GL', op: 'rows', cols: ['compte'] } };
  let r = await run(); assert.equal(r.pending, true);
  answer = { query: { file_id: 'GL', op: 'aggregate', group_by: 'B', sum: ['D'], limit: 2 } };
  r = await run(); assert.equal(r.pending, true);
  r = await run(); assert.equal(r.pending, true);
  assert.equal(seen.some(f => f?.refused === 'DOCUMENT_QUERY_INVALID'), true);
  answer = input => { const w = input.feedback.at(-1)?.window; assert.equal(w?.groups_total, 40); return { source_file_id: 'GL' }; };
  r = await run(); assert.equal(r.pending, true); r = await run();
  assert.equal(r.result?.source_file_id, 'GL');
});
