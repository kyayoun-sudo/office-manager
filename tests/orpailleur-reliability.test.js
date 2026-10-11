// Orpailleur reliability (2026-10-11, Paul's diagnosis request): the rules
//  « vu ≠ traité », « proposé ≠ déplacé », a closed proposal never blocks a legitimate new one,
//  a refused one is never proposed again, a gone file closes its proposals, a launch after the
//  first scan looks only at what changed, a pass is never declared complete with files left.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTidyPlan, tidyPlanStep, queueFilingProposal } from '../lib/tidy-plan.js';

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
const json = (name, o) => ({ name, buffer: Buffer.from(JSON.stringify(o)) });
const state = drive => JSON.parse([...drive.store.values()].find(f => f.name === 'OFFICE_MANAGER_TIDY_STATE.json').buffer.toString());
const items = [
  { id: 'D1', name: 'CAC 2026', mimeType: F, path: '/Drive/Clients/CAC 2026' },
  { id: 'f1', name: 'Scan_0012.pdf', mimeType: 'application/pdf', path: '/Drive/Scan_0012.pdf', parents: ['ROOT'] }
];
const base = extra => ({ folder: 'MEM', fire: async () => true, readText: async () => 'Lettre de mission CAC exercice 2026 Ivoire Logistique, signée, honoraires et calendrier. '.repeat(2),
  activeLessons: async () => [], agentSettings: async () => ({ auto_filing: false }), recordFiles: async () => {}, writeJournal: async () => {}, saveCheckpoint: async () => {}, understandAI: async () => ({ text: '{}' }), ...extra });

test('« vu ≠ traité »: a file the AI gave no decision for is asked again, then kept — never seen, the pass is partial', async () => {
  const drive = fakeDrive([json('OFFICE_MANAGER_SCAN_STATE.json', { items, status: 'done' })]);
  let calls = 0;
  const d = base({ drive, fetchRows: async () => [], runAI: async () => { calls++; return { text: '{"decisions":[]}' }; } });
  await startTidyPlan('org', {}, d);
  const st = await tidyPlanStep('org', {}, { ...d, noLoop: true });
  assert.equal(calls >= 2, true, 'asked a second time for the missing file');
  assert.equal(st.status, 'done');
  assert.equal(st.outcome, 'partial', 'never a false « complete »');
  assert.equal(st.outcome_detail.undecided, 1);
  assert.equal((st.seen || {}).f1, undefined, 'not « seen »: it comes back at the next pass');
  assert.equal(state(drive).undecided.f1.attempts, 1);
});

test('an existing proposal is explained: waiting, refused (never re-proposed), or done then moved back (new proposal)', async () => {
  const row = () => ({ org_id: 'org', agent_key: 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', payload: { file_id: 'f1', from_parent: 'ROOT', to_parent: 'D1', new_name: null } });
  const make = prior => { const posts = []; return { posts, fetchRows: async (path, o = {}) => {
    if (o.method === 'POST') { const r = JSON.parse(o.body)[0]; posts.push(r); return posts.length === 1 && prior ? [] : [{ id: 'new' + posts.length }]; }
    if (path.includes('idempotency_key=eq.')) return prior ? [prior] : [];
    return [];
  } }; };
  let m = make({ id: 'p1', status: 'proposed', work_state: 'requested', executed_at: null });
  let r = await queueFilingProposal('org', row(), m.fetchRows);
  assert.equal(r.length, 0); assert.equal(r.existing.state, 'pending');
  m = make({ id: 'p2', status: 'rejected', work_state: 'cancelled', executed_at: null });
  r = await queueFilingProposal('org', row(), m.fetchRows);
  assert.equal(r.length, 0); assert.equal(r.existing.state, 'rejected', 'a person said no: not proposed again');
  m = make({ id: 'p3', status: 'approved', work_state: 'executed', executed_at: '2026-10-10T10:00:00Z' });
  r = await queueFilingProposal('org', row(), m.fetchRows);
  assert.equal(r[0].id, 'new2'); assert.equal(r.existing.state, 'reproposed');
  assert.notEqual(m.posts[1].idempotency_key, m.posts[0].idempotency_key, 'a new generation of the key');
});

test('a launch after the first scan looks only at what changed (no full re-scan, memory kept)', async () => {
  const drive = fakeDrive([json('OFFICE_MANAGER_SCAN_STATE.json', { items, status: 'done', finished_at: '2026-10-09T00:00:00Z' }),
    json('OFFICE_MANAGER_TIDY_STATE.json', { status: 'done', mode: 'first-scan', first_scan_done: '2026-10-10T00:00:00Z', last_pass_at: '2026-10-10T00:00:00Z', seen: { f1: 't' }, answers: 1 })]);
  const r = await startTidyPlan('org', {}, base({ drive, fetchRows: async () => [], changedSince: async () => [], driveId: null, loadCheckpoint: async () => null, checkAnswers: async () => [] }));
  assert.equal(r.mode, 'changes');
  const st = state(drive);
  assert.equal(st.mode, 'changes'); assert.deepEqual(st.seen, { f1: 't' }, 'the memory is not wiped');
});

test('a file gone to the bin: its open proposals are closed, nothing is proposed for it', async () => {
  const drive = fakeDrive([json('OFFICE_MANAGER_SCAN_STATE.json', { items, status: 'done' }), json('OFFICE_MANAGER_TIDY_STATE.json', { status: 'planning', mode: 'first-scan', started_at: 's', list: ['f1'], done: 0, moves: 0, renames: 0, questions: 0, ok: 0 })]);
  const patches = [];
  const d = base({ drive, currentMeta: async () => ({ id: 'f1', trashed: true }), fetchRows: async (path, o = {}) => { if (o.method === 'PATCH') patches.push({ path, body: JSON.parse(o.body) }); return []; }, runAI: async () => ({ text: '{"decisions":[]}' }) });
  const st = await tidyPlanStep('org', {}, { ...d, noLoop: true });
  assert.ok(patches.some(p => /payload->>file_id=eq.f1/.test(p.path) && p.body.status === 'rejected' && p.body.verification_evidence.error_code === 'FILE_TRASHED'));
  assert.equal(st.moves, 0);
});

test('the first scan ends only when the whole Drive is covered: a round left files → the next pass continues it', async () => {
  const { firstScanLeft } = await import('../lib/tidy-plan.js');
  const more = [...items, { id: 'f2', name: 'Contrat.pdf', mimeType: 'application/pdf', path: '/Drive/Contrat.pdf', parents: ['ROOT'] }, { id: 'f3', name: 'x.pdf', mimeType: 'application/pdf', path: '/Drive/x.pdf', parents: ['ROOT'] }];
  assert.deepEqual(firstScanLeft(more, { seen: { f1: 't' }, undecided: { f3: { attempts: 1 } } }).map(i => i.id), ['f2'], 'decided, undecided and waiting files are not « left »');
  const drive = fakeDrive([json('OFFICE_MANAGER_SCAN_STATE.json', { items: more, status: 'done' }),
    json('OFFICE_MANAGER_TIDY_STATE.json', { status: 'done', mode: 'first-scan', first_scan_remaining: 2, last_pass_at: '2026-10-10T00:00:00Z', seen: { f1: 't' }, first_scan_round: 1 })]);
  const { startChangesPass } = await import('../lib/tidy-plan.js');
  const r = await startChangesPass('org', {}, base({ drive, fetchRows: async () => [], changedSince: async () => [], driveId: null, loadCheckpoint: async () => null, checkAnswers: async () => [] }));
  assert.equal(r.reason, 'FIRST_SCAN_CONTINUES');
  const st = state(drive);
  assert.equal(st.mode, 'first-scan');
  assert.deepEqual(st.list.sort(), ['f2', 'f3'], 'only what the first round did not cover');
  assert.equal(st.first_scan_round, 2);
  assert.deepEqual(st.seen, { f1: 't' }, 'memory kept');
});
