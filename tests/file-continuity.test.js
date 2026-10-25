import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { prepareCycleWorkpapers } from '../lib/cycle-workpapers.js';
import { extractPdfTable } from '../lib/workfile-sources.js';
import { fitName, windowsName } from '../lib/path-budget.js';

const FOLDER = 'application/vnd.google-apps.folder';
const folder = 'WORKPAPERSxxxxxxxxxxxxxxxx';
async function cycleWorld() {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('ACH-01').getCell('B2').value = 'Travail humain';
  const original = Buffer.from(await wb.xlsx.writeBuffer());
  const files = new Map([['EXISTING', { id: 'EXISTING', name: 'Mon travail.xlsx', parents: [folder], bytes: original }]]);
  const programme = { id: 'p2', version: 2, status: 'validated', materiality: { workpapers_folder: folder },
    cycles: [{ cycle_code: 'ACH', procedures: [{ code: 'ACH-01', active: true }] }],
    workpapers: [{ cycle_code: 'ACH', file_id: 'EXISTING', model: { id: 'MODEL' }, status: 'CREATED_FROM_MODEL' }] };
  const state = { copies: 0, history: [], readError: false };
  const drive = {
    getMeta: async id => id === folder ? { id, name: 'WP' } : files.get(id) || null,
    downloadBuffer: async id => { if (state.readError) throw new Error('TEMPORARY_READ_ERROR'); return files.get(id)?.bytes; },
    readText: async () => { throw new Error('TEMPORARY_READ_ERROR'); },
    listChildren: async id => [...files.values()].filter(f => f.parents?.includes(id)),
    findFilesByExactName: async (name, parent) => [...files.values()].filter(f => f.name === name && f.parents?.includes(parent)),
    copyFile: async (id, name, parent) => { state.copies++; files.set('COPY', { id: 'COPY', name, parents: [parent], bytes: original }); return { id: 'COPY' }; }
  };
  const d = { drive, methodology: async () => ({ sops: [] }), audit: async () => null,
    templatesFolder: async () => ({ status: 'KNOWN', folder_id: 'MODELS' }), listTemplateFiles: async () => [{ id: 'MODEL', name: 'Très long modèle.xlsx' }],
    readTemplate: async id => { if (state.readError) throw new Error('TEMPORARY_READ_ERROR'); return 'ACH-01'; },
    fetchRows: async (path, options = {}) => {
      if (options.method === 'PATCH') { Object.assign(programme, JSON.parse(options.body)); return [programme]; }
      if (path.startsWith('office_missions')) return [{ id: 'm', name: 'Mission' }];
      if (path.startsWith('office_procedure_work')) return [];
      if (path.includes('select=id,version,workpapers')) return [programme, ...state.history];
      return [programme];
    } };
  return { files, programme, state, d, original };
}

test('programme revisions, cleared cells and renamed or moved workbooks keep the same authoritative file', async () => {
  const w = await cycleWorld();
  const first = await prepareCycleWorkpapers('org', 'm', null, w.d);
  w.programme.version++;
  w.files.get('EXISTING').name = 'Nom corrigé.xlsx'; w.files.get('EXISTING').parents = ['OTHER_FOLDER'];
  const second = await prepareCycleWorkpapers('org', 'm', null, w.d);
  assert.equal(first.workpapers[0].file_id, second.workpapers[0].file_id);
  assert.equal(second.workpapers[0].name, 'Nom corrigé.xlsx');
  assert.equal(w.state.copies, 0); assert.ok(w.files.get('EXISTING').bytes.equals(w.original));
});

test('a read failure, a missing file or missing procedure codes never create a replacement automatically', async () => {
  for (const reason of ['read', 'deleted', 'codes']) {
    const w = await cycleWorld();
    if (reason === 'read') w.state.readError = true;
    if (reason === 'deleted') w.files.get('EXISTING').trashed = true;
    if (reason === 'codes') w.programme.cycles[0].procedures.push({ code: 'ACH-02', active: true });
    const r = await prepareCycleWorkpapers('org', 'm', null, w.d);
    assert.equal(w.state.copies, 0, reason);
    assert.equal(r.workpapers[0].status, { read: 'WORKPAPER_READ_FAILED', deleted: 'WORKPAPER_MISSING', codes: 'MODEL_REPLACEMENT_REQUIRES_REVIEW' }[reason]);
  }
});

test('lost bindings recover from programme history; multiple earlier copies need a human choice', async () => {
  for (const ambiguous of [false, true]) {
    const w = await cycleWorld(), prior = structuredClone(w.programme.workpapers[0]);
    w.programme.workpapers = []; w.state.history = [{ id: 'p1', workpapers: [prior] }];
    if (ambiguous) w.state.history.push({ id: 'p0', workpapers: [{ ...prior, file_id: 'ANOTHER' }] });
    const r = await prepareCycleWorkpapers('org', 'm', null, w.d);
    assert.equal(w.state.copies, 0);
    assert.equal(r.workpapers[0].status, ambiguous ? 'MODEL_COPY_REVIEW_REQUIRED' : 'ALREADY_EXISTS');
    if (!ambiguous) assert.equal(r.workpapers[0].file_id, 'EXISTING');
  }
});

test('two preparations cannot create copies concurrently', async () => {
  const w = await cycleWorld(); w.programme.workpapers = [];
  let release, entered; const barrier = new Promise(r => { entered = r; });
  const wait = new Promise(r => { release = r; });
  w.d.copyTemplate = async () => { entered(); await wait; return { file_id: 'COPY', model: { id: 'MODEL' }, status: 'CREATED_FROM_MODEL' }; };
  const a = prepareCycleWorkpapers('org', 'm', null, w.d);
  await barrier;
  await assert.rejects(prepareCycleWorkpapers('org', 'm', null, w.d), /FILE_PREPARATION_IN_PROGRESS/);
  release(); await a;
});

test('temporarily deactivating a cycle retains its file binding', async () => {
  const w = await cycleWorld(); w.programme.cycles[0].status = 'N/A_JUSTIFIED';
  await prepareCycleWorkpapers('org', 'm', null, w.d);
  assert.equal(w.programme.workpapers[0].file_id, 'EXISTING');
  w.programme.cycles[0].status = 'IN_SCOPE';
  assert.equal((await prepareCycleWorkpapers('org', 'm', null, w.d)).workpapers[0].file_id, 'EXISTING');
  assert.equal(w.state.copies, 0);
});

test('copying a macro model preserves its extension and never invents an xlsx format', async () => {
  const w = await cycleWorld(); w.programme.workpapers = [];
  w.d.listTemplateFiles = async () => [{ id: 'MODEL', name: 'Modele.xlsm' }];
  const r = await prepareCycleWorkpapers('org', 'm', null, w.d);
  assert.match(r.workpapers[0].name, /\.xlsm$/);
});

async function pdfWorld() {
  const wp = new ExcelJS.Workbook(); wp.addWorksheet('D2');
  const wpBytes = Buffer.from(await wp.xlsx.writeBuffer());
  const state = { created: 0, updated: 0, ai: 0, notes: new Map() };
  const files = new Map([['PDF', { id: 'PDF', name: 'TEB.pdf', parents: ['P'], mimeType: 'application/pdf', bytes: Buffer.from('PDF original'), modifiedTime: 'v1' }]]);
  const drive = {
    getMeta: async id => id === 'WP' ? { id, size: wpBytes.length } : id === 'P' ? { id, name: 'Pieces' } : files.get(id) || null,
    downloadBuffer: async id => id === 'WP' ? wpBytes : files.get(id).bytes,
    listChildren: async id => [...files.values()].filter(f => f.parents?.includes(id) && !f.trashed),
    findFilesByExactName: async (name, parent) => [...files.values()].filter(f => !f.trashed && f.name === name && f.parents?.includes(parent)),
    createBinary: async ({ name, parentId, buffer }) => { const id = 'EXTRACT' + ++state.created; files.set(id, { id, name, parents: [parentId], bytes: buffer, modifiedTime: '1' }); return { id }; },
    updateBinary: async (id, { buffer, expectedModifiedTime }) => { assert.equal(expectedModifiedTime, files.get(id).modifiedTime); files.get(id).bytes = buffer; files.get(id).modifiedTime += 'x'; state.updated++; }
  };
  const d = { drive, view: async () => ({ editable: true, work: { status: 'in_progress' }, workpaper: { file_id: 'WP' } }),
    sources: async () => [...files.values()].filter(f => f.mimeType === 'application/pdf').map(f => ({ file_id: f.id, name: f.name })),
    missionMemory: async () => [...state.notes.values()],
    noteMissionEvent: async (o, m, id, event) => { if (event.uses) state.notes.set(id, { id, ...event }); },
    mapWorkingFile: () => ({ sheets: [{ name: 'D2', main: 0, tables: [{ columns: [{ role: 'fact', header: 'Budget' }] }] }] }),
    readPdf: async () => ({ text: 'Personnel 1200', pages_read: [1] }),
    ai: async () => { state.ai++; return { text: JSON.stringify({ headers: ['Libellé', 'Budget'], rows: [['Personnel', '1200']] }) }; },
    audit: async () => null };
  const run = (body = {}) => extractPdfTable('org', 'm', 'PRJ-03', { sheet: 'D2', file_id: 'PDF', ...body }, { email: 'auditor@firm' }, d);
  return { state, files, d, run };
}

test('remove/reupload the same PDF, even renamed and with a new ID, reuses the extract and destination', async () => {
  const w = await pdfWorld(), a = await w.run();
  w.files.set('NEW', { ...w.files.get('PDF'), id: 'NEW', name: 'TEB renommé.pdf' }); w.files.delete('PDF');
  const b = await w.run({ file_id: 'NEW' });
  assert.equal(b.file_id, a.file_id); assert.equal(b.reused, true);
  assert.equal(w.state.created, 1); assert.equal(w.state.ai, 1);
  assert.ok(w.state.notes.get(a.file_id).uses.some(u => u.where === 'NEW'));
});

test('a missing memory write is recovered from the extract provenance, without a second file', async () => {
  const w = await pdfWorld(), a = await w.run(); w.state.notes.clear();
  const b = await w.run(); assert.equal(b.file_id, a.file_id); assert.equal(w.state.created, 1);
});

test('a new PDF revision and explicit re-extraction rewrite the same generated file, with read-back verification', async () => {
  const w = await pdfWorld(), a = await w.run();
  w.files.get('PDF').bytes = Buffer.from('PDF corrected'); w.files.get('PDF').modifiedTime = 'v2';
  const b = await w.run(); const c = await w.run({ again: true });
  assert.equal(b.file_id, a.file_id); assert.equal(c.file_id, a.file_id);
  assert.equal(w.state.created, 1); assert.equal(w.state.updated, 2);
});

test('human edits to an extract survive a requested refresh; an existing duplicate is never deleted', async () => {
  const w = await pdfWorld(), a = await w.run();
  const book = new ExcelJS.Workbook(); await book.xlsx.load(w.files.get(a.file_id).bytes);
  book.addWorksheet('Mes notes').getCell('A1').value = 'Conserver mon travail';
  w.files.get(a.file_id).bytes = Buffer.from(await book.xlsx.writeBuffer());
  const before = w.files.get(a.file_id).bytes;
  await assert.rejects(w.run({ again: true }), /EXTRACT_MODIFIED_REVIEW_REQUIRED/);
  assert.ok(w.files.get(a.file_id).bytes.equals(before)); assert.equal(w.state.updated, 0);
  w.files.set('SECOND', { ...w.files.get(a.file_id), id: 'SECOND', name: 'TEB_TABLEAU_EXTRAIT_2.xlsx' });
  await assert.rejects(w.run(), /EXTRACT_DUPLICATES_REVIEW_REQUIRED/);
  assert.equal(w.files.size, 3); assert.equal(w.state.created, 1);
});

test('Windows names are valid and an impossible folder path blocks rather than creating an unusable file', async () => {
  assert.equal(windowsName('CON.xlsx'), '_CON.xlsx');
  assert.equal(windowsName('TEB: 2023?.xlsx '), 'TEB_ 2023_.xlsx');
  const w = await pdfWorld();
  w.d.fitName = async () => ({ name: 'x.xlsx', too_deep: true });
  await assert.rejects(w.run(), /WORKPAPER_PATH_TOO_LONG/); assert.equal(w.state.created, 0);
  const f = await fitName('TEB: budget?.xlsx', 'P', { getMeta: async () => ({ name: 'Mission' }) });
  assert.equal(f.name, 'TEB_ budget_.xlsx');
  await assert.rejects(fitName('TEB.xlsx', 'P', { getMeta: async () => { throw new Error('NETWORK'); } }, new Map(), { requireKnownPath: true }), /FOLDER_PATH_UNAVAILABLE/);
});
