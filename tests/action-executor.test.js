import test from 'node:test';
import assert from 'node:assert/strict';
import { executeDecision, PBC_EXTERNAL_REMINDER } from '../lib/action-executor.js';

const PERSONA = { sender_email: 'paulkomenan@taty.info', internal_domains: ['taty.info'] };
function world({ role = 'Chef de mission', email = 'koffi@taty.info' } = {}) {
  const patches = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'PATCH') { patches.push({ path, body: JSON.parse(o.body) }); return [{ id: 'a1' }]; }
    if (path.startsWith('office_mission_assignments')) return [{ staff_profile_id: 's1', mission_role: 'Assistant' }, { staff_profile_id: 's2', mission_role: role }];
    if (path.startsWith('office_staff_profiles')) return [{ email }];
    return [];
  };
  return { patches, fetchRows };
}
const reminder = {
  id: 'a1', action_type: PBC_EXTERNAL_REMINDER, office_mission_id: 'm1', summary: 'Relance PBC 03-02',
  payload: { direction: 'external', recipients: [{ role: 'client_site_responsible', email: 'dg@bletransit.ci' }, { role: 'mission_manager', email: null }],
    pbc_item: { reference: 'PBC-03-02', document: 'Relevés bancaires', deadline: '2026-09-30', lifecycle_state: 'MISSING' } }
};

test('PBC client reminder: never an e-mail to the client — a message to the mission manager is proposed for validation', async () => {
  const w = world();
  const proposed = [];
  const r = await executeDecision('org', reminder, 'approve', 'Paul', { fetchRows: w.fetchRows, getPersona: async () => PERSONA,
    proposeMessage: async (orgId, input) => { proposed.push(input); return { id: 'msg1', status: 'pending_approval' }; } });
  assert.equal(r.executed, true);
  assert.equal(r.message_id, 'msg1');
  assert.deepEqual(proposed[0].recipients, ['koffi@taty.info'], 'the mission manager, a colleague');
  assert.ok(!JSON.stringify(proposed).includes('bletransit'), 'the client address is never used');
  assert.match(proposed[0].body, /PBC-03-02[\s\S]*Peux-tu relancer le client \? L’agent ne lui écrit pas directement/);
  assert.equal(w.patches[0].body.status, 'approved');
  assert.match(r.effect, /Aucun e-mail au client/);
});

test('PBC client reminder: no manager found, or a manager outside the firm → nothing is sent, the task stays', async () => {
  for (const opts of [{ role: 'Assistant' }, { email: 'koffi@gmail.com' }]) {
    const w = world(opts);
    let called = false;
    const r = await executeDecision('org', reminder, 'approve', 'Paul', { fetchRows: w.fetchRows, getPersona: async () => PERSONA, proposeMessage: async () => { called = true; } });
    assert.equal(called, false);
    assert.match(r.effect, /Chef de mission introuvable/);
  }
});

test('other actions: file review approved, follow-up becomes a task, reject closes, defer changes nothing', async () => {
  let w = world();
  assert.match((await executeDecision('org', { id: 'a1', action_type: 'REVIEW_FILE' }, 'approve', 'Paul', { fetchRows: w.fetchRows })).effect, /Orpailleur/);
  assert.equal(w.patches[0].body.status, 'approved');
  w = world();
  assert.match((await executeDecision('org', { id: 'a1', action_type: 'FOLLOWUP' }, 'approve', 'Paul', { fetchRows: w.fetchRows })).effect, /tâche active/);
  w = world();
  await executeDecision('org', { id: 'a1', action_type: 'FOLLOWUP' }, 'reject', 'Paul', { fetchRows: w.fetchRows });
  assert.deepEqual(w.patches[0].body, { status: 'rejected' });
  w = world();
  const d = await executeDecision('org', { id: 'a1', action_type: 'FOLLOWUP' }, 'defer', 'Paul', { fetchRows: w.fetchRows });
  assert.equal(d.executed, false);
  assert.equal(w.patches.length, 0);
});
