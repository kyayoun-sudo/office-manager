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

// Rule updated by Paul on 2026-10-07: the client may be written to, but only as a DRAFT the agent
// proposes, validated by a manager, and only to the contact registered on the mission.
test('PBC reminder: message to the responsible colleague; NO client draft when no client contact is registered on the mission', async () => {
  const w = world();
  const proposed = [];
  const r = await executeDecision('org', reminder, 'approve', 'Paul', { fetchRows: w.fetchRows, getPersona: async () => PERSONA,
    proposeMessage: async (orgId, input) => { proposed.push(input); return { id: 'msg' + proposed.length, status: 'pending_approval' }; } });
  assert.equal(r.executed, true);
  assert.equal(r.message_id, 'msg1');
  assert.equal(proposed.length, 1);
  assert.deepEqual(proposed[0].recipients, ['koffi@taty.info'], 'the mission manager, a colleague');
  assert.ok(!JSON.stringify(proposed).includes('bletransit'), 'an address found in the payload is never used for the client');
  assert.match(proposed[0].body, /PBC-03-02[\s\S]*Tu es responsable de son suivi/);
  assert.equal(w.patches[0].body.status, 'approved');
  assert.match(r.effect, /Rien n’est envoyé avant/);
});

test('PBC reminder: the responsible person named in the programme is used; a formal client draft goes ONLY to the mission’s registered contact', async () => {
  const w = world();
  const base = w.fetchRows;
  const fetchRows = async (path, o) => path.startsWith('office_missions') ? [{ id: 'm1', client_contact_emails: ['cfo@bletransit.ci'] }] : base(path, o);
  const proposed = [];
  const withOwner = { ...reminder, payload: { ...reminder.payload, pbc_item: { ...reminder.payload.pbc_item, responsible_email: 'aya@taty.info' } } };
  const r = await executeDecision('org', withOwner, 'approve', 'Paul', { fetchRows, getPersona: async () => ({ ...PERSONA, agent_display_name: 'Office Manager TATY' }),
    proposeMessage: async (orgId, input) => { proposed.push(input); return { id: 'msg' + proposed.length }; } });
  assert.deepEqual(proposed[0].recipients, ['aya@taty.info'], 'the person responsible in the work programme');
  assert.equal(proposed[1].audience, 'client');
  assert.equal(proposed[1].office_mission_id, 'm1');
  assert.deepEqual(proposed[1].recipients, ['cfo@bletransit.ci'], 'the registered contact, not dg@bletransit.ci from the payload');
  assert.match(proposed[1].body, /^Madame, Monsieur,[\s\S]*PBC-03-02[\s\S]*Cordialement,\nOffice Manager TATY$/);
  assert.deepEqual(r.message_ids, ['msg1', 'msg2']);
  assert.match(r.effect, /brouillon de relance au client \(cfo@bletransit\.ci\)/);
});

test('PBC reminder: no manager and no client contact → nothing proposed, the task stays', async () => {
  for (const opts of [{ role: 'Assistant' }, { email: 'koffi@gmail.com' }]) {
    const w = world(opts);
    let called = false;
    const r = await executeDecision('org', reminder, 'approve', 'Paul', { fetchRows: w.fetchRows, getPersona: async () => PERSONA, proposeMessage: async () => { called = true; } });
    assert.equal(called, false);
    assert.match(r.effect, /Ni responsable ni contact client/);
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

test('review fixes: two decisions at once never act twice; a failed proposal leaves the reminder pending', async () => {
  const none = async (path, o = {}) => (o.method === 'PATCH' ? [] : path.startsWith('office_mission_assignments') ? [{ staff_profile_id: 's2', mission_role: 'Chef de mission' }] : path.startsWith('office_staff_profiles') ? [{ email: 'koffi@taty.info' }] : []);
  const r = await executeDecision('org', { id: 'a1', action_type: 'FOLLOWUP' }, 'approve', 'Paul', { fetchRows: none });
  assert.equal(r.executed, false);
  assert.match(r.effect, /Déjà traitée/);
  const w = world();
  await assert.rejects(executeDecision('org', reminder, 'approve', 'Paul', { fetchRows: w.fetchRows, getPersona: async () => PERSONA, proposeMessage: async () => { throw new Error('INTERNAL_DOMAINS_NOT_CONFIGURED'); } }), /INTERNAL_DOMAINS/);
  assert.equal(w.patches.length, 0, 'still pending, nothing lost');
});
