import test from 'node:test';
import assert from 'node:assert/strict';
import { collaboration } from '../lib/live-collaboration.js';
import { chatState, sendChat } from '../lib/chat.js';
const org = 'firm-a', now = Date.parse('2026-10-16T12:00:00Z');
const account = { email: 'manager@example.com', role: 'manager', auth_user_id: 'manager-id' };
const messages = [
 { id: 'one', conversation: 'cabinet', sender_email: 'other@example.com', created_at: '2026-10-16T11:59:00Z' },
 { id: 'two', conversation: 'cabinet', sender_email: account.email, created_at: '2026-10-16T11:59:30Z' },
 { id: 'secret', conversation: 'mission:00000000-0000-0000-0000-000000000001', sender_email: 'other@example.com', created_at: '2026-10-16T11:59:45Z' }
];
function deps(read = []) {
 const calls = [];
 return { now: () => now, calls, fetchRows: async (path, options) => {
  calls.push({ path, options });
  if (options) return [];
  assert.ok(path.includes('org_id=eq.firm-a'), path);
  if (path.startsWith('office_chat_messages')) return messages;
  if (path.startsWith('office_chat_reads')) { assert.ok(path.includes('email=eq.manager%40example.com')); return read; }
  if (path.startsWith('office_presence')) { assert.ok(path.includes('last_seen_at=gte.')); return [{ email: 'other@example.com' }, { email: 'outsider@example.com' }, { email: 'disabled@example.com' }]; }
  if (path.startsWith('office_firm_settings')) return [{ settings: { managers_see_direct_reports: true } }];
  if (path.includes('reports_to=eq.')) return [{ email: 'other@example.com' }];
  if (path.startsWith('office_app_users')) return [{ email: 'other@example.com', display_name: 'Team member' }, { email: 'outsider@example.com' }];
  return [];
 } };
}
test('unread excludes own messages and unauthorized mission; manager presence limited to active reports', async () => {
 const d = deps(); const r = await collaboration(org, account, {}, d);
 assert.deepEqual(r.unread_ids, ['one']); assert.deepEqual(r.people, [{ email: 'other@example.com', name: 'Team member' }]);
});
test('server read cursor clears conversation through displayed message; identity cannot be supplied', async () => {
 const d = deps([{ message_id: 'two' }]); assert.equal((await collaboration(org, account, {}, d)).unread, 0);
 await collaboration(org, account, { action: 'heartbeat', email: 'victim@example.com', org_id: 'firm-b' }, d);
 const row = JSON.parse(d.calls.find(c => c.options)?.options.body)[0];
 assert.equal(row.org_id, org); assert.equal(row.email, account.email);
});
test('cannot mark a hidden message read or send/read a non-assigned mission', async () => {
 await assert.rejects(collaboration(org, account, { action: 'read', conversation: 'cabinet', message_id: 'secret' }, deps()), /MESSAGE_NOT_VISIBLE/);
 const conversation = messages[2].conversation;
 await assert.rejects(chatState(org, account, { conversation }, deps()), /CONVERSATION_FORBIDDEN/);
 await assert.rejects(sendChat(org, account, { conversation, body: 'hello' }, deps()), /NOT_ON_THIS_MISSION/);
});
test('ordinary auditor gets no presence roster; failed presence read never reports offline', async () => {
 const d = deps(); const r = await collaboration(org, { ...account, role: 'auditor' }, {}, d);
 assert.equal(r.presence_visible, false); assert.deepEqual(r.people, []);
 assert.ok(!d.calls.some(c => c.path.startsWith('office_presence')));
 await assert.rejects(collaboration(org, account, {}, { ...deps(), fetchRows: async () => { throw new Error('offline'); } }), /offline/);
});
