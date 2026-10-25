// Paul, 2026-10-25 : « l'application et tous les agents doivent pouvoir unzipper ».
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { expandZips } from '../lib/zip-pieces.js';

test('a zip is opened next to itself: each file becomes a piece, the zip is kept, nothing created twice, no path escapes', async () => {
  const inner = new JSZip(); inner.file('releve_mars.pdf', 'PDF-mars');
  const z = new JSZip(); z.file('PTBA 2023/PTBA_VF.xlsx', 'XLSX'); z.file('../../evil.txt', 'x'); z.file('__MACOSX/._PTBA_VF.xlsx', 'junk'); z.file('releves.zip', await inner.generateAsync({ type: 'nodebuffer' }));
  const zbuf = await z.generateAsync({ type: 'nodebuffer' });
  const store = { Z: { name: 'pieces.zip', size: zbuf.length, parents: ['P'], buf: zbuf } };
  let n = 0;
  const drive = { getMeta: async id => store[id], downloadBuffer: async id => store[id].buf,
    findFilesByExactName: async (name, parent) => Object.entries(store).filter(([, f]) => f.name === name && f.parents[0] === parent).map(([id, f]) => ({ id, ...f })),
    createBinary: async ({ name, parentId, buffer }) => { const id = 'F' + (++n); store[id] = { name, size: buffer.length, parents: [parentId], buf: buffer }; return { id }; } };
  const r = await expandZips([{ id: 'A', name: 'convention.pdf' }, { id: 'Z', name: 'pieces.zip', path: 'PIECES_RECUES/pieces.zip' }], drive);
  assert.deepEqual(r.files.map(f => f.name), ['convention.pdf', 'PTBA 2023_PTBA_VF.xlsx', 'evil.txt', 'releve_mars.pdf']);
  assert.equal(r.notes[0].extracted, 3);
  assert.ok(store.Z);                                                          // the zip is kept
  const again = await expandZips([{ id: 'Z', name: 'pieces.zip' }], drive);
  assert.ok(again.files.every(f => f.reused));                                  // opened twice: nothing created twice
});

test('PRJ-01: an extraction asked on a test sheet, or a PDF without a table, becomes a reading of the document', async () => {
  const { executeProcedureActions } = await import('../lib/procedure-workspace.js');
  const read = [];
  const view = { editable: true, work: { walkthrough: [], status: 'in_progress' }, line: { code: 'PRJ-01' } };
  const d = { view: async () => view, sources: async () => [{ file_id: 'ACC', name: 'Accord de pret FAD.pdf' }],
    extractPdfTable: async () => { throw new Error('NO_TABLE_IN_PDF'); },
    stepsView: async () => ({ steps: [{ n: 1, text: 'Identifier bailleur' }], runs: [] }),
    prepareDocumentWork: async (o, m, c, step, body) => { read.push(body.source_file_id); return { understood: 'lu', findings: [], questions: [] }; } };
  const out = await executeProcedureActions('O', 'M', 'PRJ-01', [{ type: 'extract-pdf', sheet: 'PRJ-01', source_file_id: 'ACC' }], 'lis l accord de pret', { email: 'p' }, d);
  assert.deepEqual(read, ['ACC']);
  assert.match(out.find(o => o.action === 'extract-pdf').note, /je lis le document/);
  const out2 = await executeProcedureActions('O', 'M', 'PRJ-01', [{ type: 'extract-pdf', sheet: 'D2_BUDGET', source_file_id: 'ACC' }], 'l accord de pret remplit D2', { email: 'p' }, d);
  assert.match(out2.find(o => o.action === 'extract-pdf').note, /pas de tableau/);
  assert.equal(read.length, 2);
});
