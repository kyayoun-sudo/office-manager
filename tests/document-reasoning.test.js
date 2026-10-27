import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { reasonWithDocuments, documentIdsIn } from '../lib/document-reasoning.js';
import { readDocumentWindow, contentFormat } from '../lib/document-content.js';
import { saveConclusion } from '../lib/procedure-work.js';
import { think, runApproved } from '../lib/agent-brain.js';
import { inspectMissionDocuments } from '../lib/mission-document-tools.js';
import { buildSpecialistTools, buildRootTools } from '../lib/agent-tools.js';

async function fixture() {
  let state = { editable: true, card: { objective: 'Lire le contenu réel' }, line: { code: 'X-01' }, workpaper: { file_id: 'WP' }, work: { id: 'W', status: 'in_progress', walkthrough: [] } };
  const documents = Array.from({ length: 65 }, (_, i) => ({ id: 'D' + i, name: 'inconnu-' + i }));
  const versions = {}; let calls = 0, opened = 0, answer = {};
  const drive = { getMeta: async id => ({ modifiedTime: versions[id] || 'v1' }) };
  const d = { permissions: async () => ({ granted: true }), view: async () => structuredClone(state),
    save: async (_, row, patch) => { Object.assign(state.work, structuredClone(patch)); return structuredClone(state.work); },
    readDocumentWindow: async doc => { opened++; return { file_id: doc.id, revision: 'v1||', window: { text: 'Contenu réel de ' + doc.id } }; },
    ai: async (_, request) => { calls++; const input = JSON.parse(request.input); return { provider: 'available', text: JSON.stringify(typeof answer === 'function' ? answer(input) : answer) }; } };
  const run = body => reasonWithDocuments({ org: 'O', mission: 'M', code: 'X-01', view: structuredClone(state), documents, drive,
    task: 'Préparer', context: { sop: state.card }, schema: '{"source_file_id":"id"}', evidenceIds: documentIdsIn, key: 'test', body: body || {}, account: {} }, d);
  return { run, d, documents, versions, state: () => state, answer: x => { answer = x; }, counts: () => ({ calls, opened }) };
}

test('AI explores beyond the 60th file, reads the wrong-named piece, directs code and sees execution feedback', async () => {
  const f = await fixture(); f.answer({ catalog_page: 2 }); let r = await f.run(); assert.equal(r.pending, true);
  f.answer(input => { assert.equal(input.catalog[4].id, 'D64'); return { inspect: { file_id: 'D64', page: 1 } }; });
  r = await f.run(); assert.equal(f.counts().opened, 0);
  r = await f.run(); assert.equal(f.counts().opened, 1); assert.equal(r.pending, true);
  f.answer(input => { assert.match(input.feedback.at(-1).window.text, /D64/); return { source_file_id: 'D64', rows: [7] }; });
  r = await f.run(); assert.equal(r.result.source_file_id, 'D64');
  assert.equal((await r.reportExecution('plan-A', { count: 0, reason: 'Mauvaise plage' })).pending, true);
  f.answer(input => { assert.equal(input.feedback.at(-1).execution.count, 0); return { source_file_id: 'D64', rows: [12] }; });
  r = await f.run(); assert.deepEqual(r.result.rows, [12]);
});

test('a final answer selecting an unread source becomes a read request and must return to the AI', async () => {
  const f = await fixture(); f.answer({ source_file_id: 'D64' });
  assert.equal((await f.run()).pending, true); assert.equal(f.counts().opened, 0);
  assert.equal((await f.run()).pending, true); assert.equal(f.counts().opened, 1);
  assert.equal((await f.run()).result.source_file_id, 'D64'); assert.equal(f.counts().calls, 2);
});

test('foreign sources and invalid ranges cannot reach Drive', async () => {
  const f = await fixture(); f.answer({ inspect: { file_id: 'FOREIGN' } });
  assert.equal((await f.run()).ai_error, 'PIECE_NOT_IN_MISSION'); assert.equal(f.counts().opened, 0);
  f.answer({ inspect: { file_id: 'D0', row_from: -1 } });
  assert.equal((await f.run()).ai_error, 'DOCUMENT_RANGE_INVALID');
});

test('permission denial prevents inference and content reads', async () => {
  const f = await fixture(); f.d.permissions = async () => ({ granted: false });
  assert.equal((await f.run()).ai_error, 'AGENTS_NOT_AUTHORIZED'); assert.deepEqual(f.counts(), { calls: 0, opened: 0 });
});

test('changed sources invalidate stored knowledge; explicit reanalysis starts fresh', async () => {
  const f = await fixture(); f.answer({ source_file_id: 'D0' }); await f.run(); await f.run(); await f.run();
  f.versions.D0 = 'v2'; await assert.rejects(f.run(), /DOCUMENT_SOURCE_CHANGED/);
  f.answer({ catalog_page: 1 }); assert.equal((await f.run({ reanalyse: true })).pending, true);
});

test('a failed extraction is fed back as a technical problem, never recorded as a successful read', async () => {
  const f = await fixture(); f.answer({ inspect: { file_id: 'D0' } }); await f.run();
  f.d.readDocumentWindow = async () => { throw Error('OCR_UNAVAILABLE'); };
  const r = await f.run(); assert.deepEqual(r.documents_read, []);
  f.answer(input => { assert.equal(input.feedback.at(-1).error, 'OCR_UNAVAILABLE'); return { questions: ['Vérifier la lecture de cette pièce.'] }; });
  assert.ok((await f.run()).result.questions.length);
});

test('oversized context remains available by offset; catalog entries are never silently pruned', async () => {
  const f = await fixture(); f.state().card.long = 'X'.repeat(70000) + 'CLAUSE_FINALE';
  f.answer(input => { assert.equal(input.catalog.length, 30); assert.equal(input.context.partial, true); return { context_offset: 60000 }; }); await f.run();
  f.answer(input => { assert.match(input.context.text, /CLAUSE_FINALE/); return { questions: ['Lecture en cours'] }; });
  assert.ok((await f.run()).result);
});

test('bytes select the Excel parser even with a PDF name and wrong MIME; later rows are accessible', async () => {
  const wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet('Comptes');
  for (let i = 1; i <= 80; i++) sheet.addRow([i, 'Écriture ' + i, i * 10]);
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  assert.equal(await contentFormat({ name: 'lettre.pdf', mimeType: 'application/pdf' }, bytes), 'xlsx');
  const drive = { getMeta: async () => ({ name: 'lettre.pdf', mimeType: 'application/pdf', modifiedTime: 'v1' }), downloadBuffer: async () => bytes };
  const read = await readDocumentWindow({ id: 'D', name: 'lettre.pdf' }, drive, { sheet: 'Comptes', row_from: 61 });
  assert.equal(read.window.lines[0].row, 61); assert.equal(read.window.lines[0].cells[1].value, 'Écriture 61');
});

test('saving the human conclusion preserves ALL server-owned work records', async () => {
  const programme = { id: 'P', cycles: [{ cycle_code: 'X', procedures: [{ code: 'X-01', active: true }] }] };
  let work = { id: 'W', status: 'in_progress', walkthrough: ['step-brain-job', 'document-brain', 'fill-orders', 'audit-pipeline'].map(kind => ({ kind, id: kind })), items: [] };
  const fetchRows = async (path, options) => {
    if (path.startsWith('office_work_programmes?')) return [programme];
    if (options?.method === 'PATCH') { work = { ...work, ...JSON.parse(options.body) }; return [work]; }
    return [work];
  };
  await saveConclusion('O', 'M', 'X-01', { conclusion: 'Brouillon', walkthrough: [{ q: 'Q', a: 'A' }, { kind: 'forged', id: 'evil' }] }, { role: 'owner' }, { fetchRows });
  assert.equal(work.walkthrough.filter(r => r.kind).length, 4); assert.equal(work.walkthrough.some(r => r.kind === 'forged'), false);
});

test('shared memory failure is reported after a successful action rather than silently ignored', async () => {
  const r = await think({ orgId: 'O', missionId: 'M', agent: 'sika', task: 'test', actions: { read: { describe: 'Lire', run: () => 1 } } }, {
    ai: async () => ({ text: '{"orders":[{"action":"read"}]}' }), missionBrief: async () => null,
    noteMission: async () => { throw Error('MEMORY_UNAVAILABLE'); } });
  assert.equal(r.done.length, 1); assert.match(r.memory_error, /MEMORY_UNAVAILABLE/);
});

test('every operational agent has the same mission catalogue/content tool', () => {
  const runtime = { orgId: 'O', runId: 'R' };
  for (const agent of ['mission-controller', 'orpailleur', 'sika', 'enhanced-auditor']) {
    assert.ok(buildSpecialistTools(agent, runtime).some(t => t.name === 'inspect_mission_documents'), agent);
  }
  assert.ok(buildRootTools(runtime).some(t => t.name === 'inspect_mission_documents'));
});

test('shared agent tool pages through every registered document without name filtering and enforces access', async () => {
  const sources = Array.from({length:65},(_,i)=>({file_id:'D'+i,name:'inconnu-'+i}));
  const d = { sources:async()=>sources, requireMissionAccess:async()=>{} };
  const page=await inspectMissionDocuments('O',{email:'a'}, {mission_id:'M',catalog_page:2},d);
  assert.equal(page.documents[4].file_id,'D64'); assert.equal(page.total,65); assert.equal(page.next_page,null);
  await assert.rejects(inspectMissionDocuments('O',{email:'a'},{mission_id:'M',file_id:'FOREIGN'},d),/PIECE_NOT_IN_MISSION/);
  d.requireMissionAccess=async()=>{throw Error('NOT_ON_THIS_MISSION')};
  await assert.rejects(inspectMissionDocuments('O',{email:'a'},{mission_id:'M'},d),/NOT_ON_THIS_MISSION/);
});

test('a memory failure after an approved action reports execution and never reruns the action', async () => {
  let runs=0;
  const r=await runApproved({orgId:'O',missionId:'M',agent:'sika',proposal:{action:'prepare',params:{}},by:'Paul',actions:{prepare:{run:()=>{runs++;return {prepared:true}}}}},
    {noteMission:async()=>{throw Error('MEMORY_UNAVAILABLE')}});
  assert.equal(runs,1); assert.equal(r.executed,true); assert.equal(r.prepared,true); assert.match(r.memory_error,/MEMORY_UNAVAILABLE/);
});
