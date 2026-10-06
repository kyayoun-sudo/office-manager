import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDecision, contentHash, listPendingActions, recordDecision } from '../lib/action-decisions.js';
import { getMissionView, summarizeDossier } from '../lib/mission-view.js';

const A1 = '11111111-1111-1111-1111-111111111111';
const M1 = '22222222-2222-2222-2222-222222222222';
const S1 = '33333333-3333-3333-3333-333333333333';

test('decisions: input is validated, rejection needs a reason', () => {
  assert.deepEqual(validateDecision({ action_id: A1, decision: 'approve' }),
    { action_id: A1, decision: 'approve', note: null, decided_by: null });
  assert.throws(() => validateDecision({ action_id: 'x', decision: 'approve' }), /VALID_ACTION_ID_REQUIRED/);
  assert.throws(() => validateDecision({ action_id: A1, decision: 'execute' }), /INVALID_DECISION/);
  assert.throws(() => validateDecision({ action_id: A1, decision: 'reject' }), /NOTE_REQUIRED_FOR_REJECTION/);
  assert.equal(validateDecision({ action_id: A1, decision: 'defer', note: 'x'.repeat(2000) }).note.length, 1000);
});

test('decisions: hash changes when the proposal content changes', () => {
  const a = { id: A1, agent_key: 'orpailleur', action_type: 'REVIEW_FILE', summary: 'Contrôler la pièce', payload: { f: 1 } };
  assert.match(contentHash(a), /^[0-9a-f]{64}$/);
  assert.equal(contentHash(a), contentHash({ ...a }));
  assert.notEqual(contentHash(a), contentHash({ ...a, summary: 'Autre' }));
});

test('decisions: pending list excludes private staffing advice and attaches the last decision', async () => {
  const paths = [];
  const fake = async path => {
    paths.push(path);
    if (path.startsWith('office_action_queue')) return [{ id: A1, agent_key: 'orpailleur', summary: 'Classer' }];
    return [
      { action_id: A1, decision: 'defer', created_at: '2026-10-07T10:00:00Z' },
      { action_id: A1, decision: 'approve', created_at: '2026-10-06T10:00:00Z' }
    ];
  };
  const r = await listPendingActions('org-1', fake);
  assert.match(paths[0], /org_id=eq\.org-1/);
  assert.match(paths[0], /action_type=neq\.PEOPLE_INTELLIGENCE_RECOMMENDATION/);
  assert.match(paths[0], /status=in\.\(proposed,awaiting_approval\)/);
  assert.equal(r.actions[0].last_decision.decision, 'defer');
});

test('decisions: recording only appends to the journal and never touches the queue', async () => {
  const calls = [];
  const fake = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET', body: options.body });
    if (path.startsWith('office_action_queue')) {
      return [{ id: A1, agent_key: 'mission-controller', action_type: 'PBC_EMAIL_DRAFT', summary: 'Relance', status: 'proposed', approved_at: null, executed_at: null }];
    }
    return [JSON.parse(options.body)[0]];
  };
  const r = await recordDecision('org-1', { action_id: A1, decision: 'approve', decided_by: 'Paul' }, fake);
  assert.equal(r.recorded, true);
  assert.equal(r.executed, false);
  const writes = calls.filter(c => c.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'office_action_decisions');
  assert.equal(JSON.parse(writes[0].body)[0].org_id, 'org-1');
  assert.ok(calls.every(c => !(c.path.startsWith('office_action_queue') && c.method !== 'GET')));
});

test('decisions: missing or already handled actions are refused', async () => {
  await assert.rejects(recordDecision('org-1', { action_id: A1, decision: 'approve' }, async () => []), /ACTION_NOT_FOUND/);
  const done = async () => [{ id: A1, status: 'approved', approved_at: '2026-10-01T00:00:00Z', executed_at: null }];
  await assert.rejects(recordDecision('org-1', { action_id: A1, decision: 'approve' }, done), /ACTION_NOT_PENDING/);
});

test('mission view: adds team names only, keeps latest plan, summarises', async () => {
  const dossier = {
    mission: { id: M1, name: 'Nova' },
    assignments: [{ staff_profile_id: S1, status: 'confirmed' }, { staff_profile_id: S1, status: 'cancelled' }],
    documents: [{ file_id: 'f', content_verified_at: '2026-10-01' }, { file_id: 'g' }],
    actions: [{ status: 'proposed' }, { status: 'verified' }],
    plans: [{ version: 2 }, { version: 1 }]
  };
  let staffPath = '';
  const view = await getMissionView('org-1', M1, {
    getMissionDossier: async () => dossier,
    fetchRows: async path => { staffPath = path; return [{ id: S1, full_name: 'Samira KOFFI', role_title: 'Senior' }]; }
  });
  assert.match(staffPath, /select=id,full_name,role_title&/);
  assert.ok(!/email|skills|cv_url/.test(staffPath));
  assert.equal(view.assignments[0].full_name, 'Samira KOFFI');
  assert.deepEqual(view.plans, [{ version: 2 }]);
  assert.deepEqual(view.summary, summarizeDossier(dossier));
  assert.equal(view.summary.team_size, 1);
  assert.equal(view.summary.documents_verified, 1);
  await assert.rejects(getMissionView('org-1', 'bad', {}), /VALID_MISSION_ID_REQUIRED/);
});

test('screens: new pages never inject HTML and links stay inside the app', () => {
  for (const f of ['accueil.html', 'mission.html', 'validations.html', 'assets/screens.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), f);
  }
});
