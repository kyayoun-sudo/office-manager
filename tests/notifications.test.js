import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotifications, inMissionScope, notifications, visibleChatMessage } from '../lib/notifications.js';

const now = Date.parse('2026-10-13T10:00:00Z');
const manager = { role: 'manager', email: 'manager@firm.example', auth_user_id: 'manager-id' };
function deps(overrides = {}) {
  return {
    learningNotice: async () => ({ due: false }),
    now, accessibleMissionIds: async () => new Set(['my-mission']),
    fetchRows: async path => path.startsWith('office_action_queue?') ? [
      { id: 'pbc-own', summary: 'Own PBC', office_mission_id: 'my-mission' },
      { id: 'pbc-other', summary: 'Secret PBC', office_mission_id: 'other-mission' }
    ] : [],
    cockpit: async () => ({ kpis: [{ key: 'deadlines', items: [
      { label: 'Own deadline', href: '/mission.html?id=my-mission', at: '2026-10-14' },
      { label: 'Secret deadline', href: '/mission.html?id=other-mission', at: '2026-10-14' },
      { label: 'Substring secret', href: '/mission.html?id=my-mission-extra', at: '2026-10-14' },
      { label: 'Unscoped deadline', href: '/mission.html', at: '2026-10-14' }
    ] }] }),
    loadJsonFile: async () => ({ state: { deposits: {
      own: { started_at: '2026-10-13', mission_id: 'my-mission', label: 'Own document', files: [{}] },
      other: { started_at: '2026-10-13', mission_id: 'other-mission', label: 'Secret document', files: [{}] },
      unscoped: { started_at: '2026-10-13', label: 'Unscoped document', files: [{}] }
    } } }),
    pendingActions: async () => ({ actions: [
      { id: 'own', summary: 'Own action', office_mission_id: 'my-mission' },
      { id: 'other', summary: 'Secret action', office_mission_id: 'other-mission' },
      { id: 'closed', summary: 'Closed action', office_mission_id: 'my-mission', last_decision: { decision: 'reject' } }
    ] }),
    openQuestions: async () => [], currentSurvey: async () => ({ survey: null }),
    opportunityTasks: async () => [], tenderTasks: async () => [], ...overrides
  };
}
test('Manager alerts and counts exclude other missions, unscoped records and rejected work', async () => {
  const result = await notifications('firm', manager, deps());
  assert.deepEqual(result.notifications.map(n => n.title).sort(), ['Own PBC', 'Own action', 'Own deadline', '1 document(s) déposé(s) — Own document'].sort());
  assert.equal(result.counts.pending_actions, 1);
  assert.deepEqual(result.viewer, { org_id: 'firm', user_id: 'manager-id' });
});
test('Owner retains global alerts while a worker has no access without assignments', async () => {
  const owner = await notifications('firm', { ...manager, role: 'owner' }, deps({ accessibleMissionIds: async () => null }));
  assert(owner.notifications.some(n => n.title === 'Secret deadline'));
  assert(owner.notifications.some(n => n.title.includes('Unscoped document')));
  const worker = await notifications('firm', { ...manager, role: 'auditor' }, deps({ accessibleMissionIds: async () => new Set() }));
  assert.equal(worker.notifications.length, 0);
  assert.equal(worker.counts.pending_actions, 0);
});
test('Staffing failure stops the request; it never grants global visibility', async () => {
  await assert.rejects(notifications('firm', manager, deps({ accessibleMissionIds: async () => { throw new Error('STAFFING_UNAVAILABLE'); } })), /STAFFING_UNAVAILABLE/);
  await assert.rejects(notifications('firm', null, deps()), /USER_SESSION_REQUIRED/);
});
test('Exact query IDs are used, not substrings or unsafe URLs', () => {
  const ids = new Set(['abc']);
  assert(inMissionScope({ href: '/mission.html?id=abc' }, ids));
  assert(inMissionScope({ href: '/procedure.html?mission_id=abc' }, ids));
  assert(!inMissionScope({ href: '/mission.html?id=abcd' }, ids));
  assert(!inMissionScope({ href: '/mission.html?label=abc' }, ids));
  assert(!inMissionScope({ href: '//elsewhere.example/mission.html?id=abc' }, ids));
});
test('Private messages require participation even for an Owner; groups and mission threads are scoped', () => {
  const ids = new Set(['my-mission']);
  const m = { sender_email: 'colleague@firm.example', conversation: 'dm:colleague@firm.example|manager@firm.example' };
  assert(visibleChatMessage(m, manager, ids));
  assert(!visibleChatMessage({ ...m, conversation: 'dm:other@firm.example|colleague@firm.example' }, { ...manager, role: 'owner' }, null));
  assert(!visibleChatMessage({ ...m, sender_email: manager.email }, manager, ids));
  assert(visibleChatMessage({ ...m, conversation: 'mission:my-mission' }, manager, ids));
  assert(!visibleChatMessage({ ...m, conversation: 'mission:other-mission' }, manager, ids));
  assert(!visibleChatMessage({ ...m, conversation: 'group:g' }, manager, ids, [{ id: 'g', members: ['other@firm.example'] }]));
  assert(visibleChatMessage({ ...m, conversation: 'group:g' }, manager, ids, [{ id: 'g', members: [manager.email] }]));
});
test('Messages and personally routed opportunities survive the mission filter without leaking unrelated DMs', async () => {
  const d = deps({ fetchRows: async path => path.startsWith('office_chat_messages?') ? [
    { id: 'mine', conversation: 'dm:colleague@firm.example|manager@firm.example', sender_email: 'colleague@firm.example', sender_name: 'Colleague', body: 'Please review', created_at: '2026-10-13' },
    { id: 'secret', conversation: 'dm:other@firm.example|colleague@firm.example', sender_email: 'colleague@firm.example', body: 'Secret message' }
  ] : [], opportunityTasks: async () => [{ id: 'opp', title: 'Confirm availability', href: '/opportunites.html?id=opp' }] });
  const result = await notifications('firm', manager, d);
  assert.equal(result.counts.messages, 1);
  assert(result.notifications.some(n => n.title === 'Confirm availability'));
  assert(!JSON.stringify(result).includes('Secret message'));
  assert(result.notifications.find(n => n.type === 'message').href.includes('to=colleague%40firm.example'));
});
test('People questions are limited to the manager’s permitted people', async () => {
  const result = await notifications('firm', manager, deps({
    openQuestions: async () => [{ key: 'mine', staff_id: 'direct', question: 'Direct report question' }, { key: 'secret', staff_id: 'elsewhere', question: 'Secret HR question' }],
    visiblePeople: async () => new Set(['direct@firm.example']),
    fetchRows: async path => path.includes('email=in.') ? [{ id: 'direct', email: 'direct@firm.example' }, { id: 'elsewhere', email: 'other@firm.example' }] : []
  }));
  assert(result.notifications.some(n => n.title === 'Direct report question'));
  assert(!JSON.stringify(result).includes('Secret HR question'));
});
test('Reading is distinct from resolving: work classification is stable and deduplicated', () => {
  const event = { id: 'same', title: 'Review work', href: '/validations.html' };
  const list = buildNotifications({ kpis: [] }, { pending: [event, event], documents: [{ id: 'doc', title: 'Document' }] });
  assert.equal(list.length, 2);
  assert.equal(list.find(n => n.type === 'pending_action').action_required, true);
  assert.equal(list.find(n => n.type === 'new_document').action_required, false);
  assert.equal(list.find(n => n.type === 'pending_action').key, buildNotifications({ kpis: [] }, { pending: [event] })[0].key);
});
