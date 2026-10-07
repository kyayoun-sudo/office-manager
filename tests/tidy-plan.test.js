import test from 'node:test';
import assert from 'node:assert/strict';
import { startTidyPlan, tidyPlanStep, answerQuestion, tidyCandidates, startChangesPass, tidyStatus } from '../lib/tidy-plan.js';

const F = 'application/vnd.google-apps.folder';
function fakeDrive(files) {
  const store = new Map(files.map((f, i) => ['x' + i, f])); let n = 0;
  return {
    store,
    findFilesByExactName: async (name) => [...store.entries()].filter(([, f]) => f.name === name).map(([id]) => ({ id })),
    downloadBuffer: async id => store.get(id).buffer,
    getMeta: async id => ({ id, modifiedTime: 't' }),
    createBinary: async ({ name, buffer }) => { const id = 'n' + (++n); store.set(id, { name, buffer }); return { id }; },
    updateBinary: async (id, { buffer }) => { store.get(id).buffer = buffer; }
  };
}
const items = [
  { id: 'D1', name: 'CAC 2026', mimeType: F, path: '/TATY share drive/Clients/Ivoire Logistique/CAC 2026' },
  { id: 'lm', name: 'Scan_0012.pdf', mimeType: 'application/pdf', path: '/TATY share drive/Scan_0012.pdf', parents: ['ROOT'] },
  { id: 'amb', name: 'doc final v3.docx', mimeType: 'application/msword', path: '/TATY share drive/doc final v3.docx', parents: ['ROOT'] },
  { id: 'okf', name: 'Programme.xlsx', mimeType: 'x', path: '/TATY share drive/Clients/Ivoire Logistique/CAC 2026/Programme.xlsx', parents: ['D1'] }
];
const json = o => ({ name: '', buffer: Buffer.from(JSON.stringify(o)) });

test('first-scan tidy-up: the AI decides; moves/renames go to « À valider », ambiguous files become a question to whoever saved them', async () => {
  const drive = fakeDrive([{ ...json({ items }), name: 'OFFICE_MANAGER_SCAN_STATE.json' }, { ...json({ status: 'applied', missions: [], answers: [{ question: 'q', answer: 'a' }] }), name: 'OFFICE_MANAGER_FIRM_KNOWLEDGE.json' }]);
  const fired = [], actions = [], messages = [];
  let input = '';
  const d = { drive, folder: 'MEM', fire: async (r, p) => { fired.push(p); return true; },
    runAI: async (o) => { input = o.input; return { text: JSON.stringify({ decisions: [
      { file_id: 'lm', action: 'move_rename', to_folder_id: 'D1', new_name: 'LM_CAC_IvoireLogistique_2026.pdf', reason: 'lettre de mission CAC 2026' },
      { file_id: 'amb', action: 'ask', question: 'À quelle mission correspond ce document ?' },
      { file_id: 'okf', action: 'ok' }] }) }; },
    fetchRows: async (path, o = {}) => { if (o.method === 'POST') actions.push(JSON.parse(o.body)[0]); return []; },
    proposeMessage: async (org, m) => { messages.push(m); return { id: 'm1' }; },
    getMeta: async () => ({ lastModifyingUser: { emailAddress: 'Yao@taty.info' } }) };
  await startTidyPlan('org', {}, d);
  const st = await tidyPlanStep('org', {}, d);
  assert.match(input, /RÉPONSES DU PROPRIÉTAIRE : \[\{"question":"q","answer":"a"/);
  assert.equal(st.status, 'done'); assert.equal(st.moves, 1); assert.equal(st.renames, 1); assert.equal(st.questions, 1); assert.equal(st.ok, 1);
  assert.equal(actions[0].action_type, 'FILE_MOVE'); assert.equal(actions[0].status, 'proposed');
  assert.deepEqual([actions[0].payload.to_parent, actions[0].payload.new_name], ['D1', 'LM_CAC_IvoireLogistique_2026.pdf']);
  assert.deepEqual(messages[0].recipients, ['yao@taty.info']); assert.match(messages[0].body, /doc final v3/);
});

test('owner answers are kept in the Orpailleur memory', async () => {
  const drive = fakeDrive([{ ...json({ status: 'applied', questions: ['Qui est Yao ?'] }), name: 'OFFICE_MANAGER_FIRM_KNOWLEDGE.json' }]);
  const r = await answerQuestion({ question: 'Qui est Yao ?', answer: 'Senior, équipe audit' }, { drive, folder: 'MEM' });
  assert.equal(r.answers[0].answer, 'Senior, équipe audit');
});

test('loose files and unclear names are looked at first; the memory folder never', () => {
  const c = tidyCandidates([...items, { id: 'mem', name: 'OFFICE_MANAGER_MAP.xlsx', mimeType: 'x', path: '/TATY share drive/00_OFFICE_MANAGER/OFFICE_MANAGER_MAP.xlsx' }]);
  assert.equal(c[0].id, 'lm'); assert.ok(!c.some(i => i.id === 'mem'));
});

test('a work programme loose under 01_CLIENTS_ET_MISSIONS: read, its mission folder created like the firm\'s others, then filed there (on approval)', async () => {
  const its = [
    { id: 'CM', name: '01_CLIENTS_ET_MISSIONS', mimeType: F, path: '/TATY share drive/01_CLIENTS_ET_MISSIONS' },
    { id: 'EX', name: 'CAC_2025', mimeType: F, path: '/TATY share drive/01_CLIENTS_ET_MISSIONS/Ivoire Logistique/CAC_2025' },
    { id: 'p1', name: 'TEST-01_PROGRAMME_A_VALIDER.txt', mimeType: 'text/plain', path: '/TATY share drive/01_CLIENTS_ET_MISSIONS/TEST-01_PROGRAMME_A_VALIDER.txt', parents: ['CM'] }
  ];
  const drive = fakeDrive([{ ...json({ items: its }), name: 'OFFICE_MANAGER_SCAN_STATE.json' }]);
  const actions = []; let input = '';
  const d = { drive, folder: 'MEM', fire: async () => true, readText: async () => ({ text: 'Programme de travail — Nova Distribution — CAC exercice 2026' }),
    runAI: async (o) => { input = o.input; return { text: JSON.stringify({ decisions: [{ file_id: 'p1', action: 'create_and_move', create_parent_id: 'CM', create_names: ['Nova Distribution', 'CAC_2026'], new_name: 'PROGRAMME_CAC_NovaDistribution_2026.txt', reason: 'programme de travail CAC 2026 de Nova Distribution' }] }) }; },
    fetchRows: async (p, o = {}) => { if (o.method === 'POST') actions.push(JSON.parse(o.body)[0]); return []; } };
  await startTidyPlan('org', {}, d);
  const st = await tidyPlanStep('org', {}, d);
  assert.match(input, /Nova Distribution — CAC exercice 2026/, 'the content is read');
  assert.match(input, /EXEMPLES DE DOSSIERS DE MISSION[\s\S]*Ivoire Logistique\/CAC_2025/);
  assert.equal(st.created, 1);
  assert.deepEqual(actions[0].payload.create, { parent_id: 'CM', names: ['Nova Distribution', 'CAC_2026'] });
  assert.match(actions[0].summary, /Créer « \/TATY share drive\/01_CLIENTS_ET_MISSIONS\/Nova Distribution\/CAC_2026 »/);
});

test('pass: only files created, uploaded or modified since the last pass; the date moves forward when the pass is done', async () => {
  const drive = fakeDrive([{ ...json({ items, finished_at: '2026-10-01T08:00:00Z' }), name: 'OFFICE_MANAGER_SCAN_STATE.json' },
    { ...json({ status: 'done', mode: 'changes', last_pass_at: '2026-10-07T08:00:00Z' }), name: 'OFFICE_MANAGER_TIDY_STATE.json' }]);
  let askedSince = null, input = '';
  const d = { drive, folder: 'MEM', fire: async () => true,
    changedSince: async (since) => { askedSince = since; return [
      { id: 'new1', name: 'Engagement letter signed.pdf', mimeType: 'application/pdf', parents: ['D1'], lastModifyingUser: { emailAddress: 'awa@taty.info' } },
      { id: 'memf', name: 'OFFICE_MANAGER_MAP.xlsx', mimeType: 'x', parents: ['MEM'] }]; },
    readText: async () => 'This engagement letter sets out the terms of the statutory audit',
    runAI: async (o) => { input = o.input; return { text: JSON.stringify({ decisions: [{ file_id: 'new1', action: 'ok' }] }) }; },
    fetchRows: async () => [] };
  const r = await startChangesPass('org', {}, d);
  assert.equal(askedSince, '2026-10-07T08:00:00Z');
  assert.equal(r.files, 1);
  let st = await tidyStatus(d);
  assert.equal(st.last_pass_at, '2026-10-07T08:00:00Z');
  st = await tidyPlanStep('org', {}, d);
  assert.match(input, /new1 \| \/TATY share drive\/Clients\/Ivoire Logistique\/CAC 2026\/Engagement letter signed.pdf/);
  assert.match(input, /statutory audit/);
  assert.equal(st.status, 'done'); assert.equal(st.ok, 1);
  assert.equal(st.last_pass_at, st.pass_started_at);
  assert.ok(st.last_pass_at > '2026-10-07T08:00:00Z');
});

test('pass: nothing new → done at once, date moves forward; a running first scan is not interrupted', async () => {
  const drive = fakeDrive([{ ...json({ items }), name: 'OFFICE_MANAGER_SCAN_STATE.json' },
    { ...json({ status: 'done', last_pass_at: '2026-10-07T08:00:00Z' }), name: 'OFFICE_MANAGER_TIDY_STATE.json' }]);
  const d = { drive, folder: 'MEM', fire: async () => { throw new Error('no step'); }, changedSince: async () => [], fetchRows: async () => [] };
  const r = await startChangesPass('org', {}, d);
  assert.equal(r.started, false);
  assert.ok((await tidyStatus(d)).last_pass_at > '2026-10-07T08:00:00Z');
  const busy = fakeDrive([{ ...json({ status: 'planning', mode: 'first-scan', started_at: new Date().toISOString() }), name: 'OFFICE_MANAGER_TIDY_STATE.json' }]);
  const r2 = await startChangesPass('org', {}, { ...d, drive: busy });
  assert.equal(r2.reason, 'FIRST_SCAN_RUNNING');
});
