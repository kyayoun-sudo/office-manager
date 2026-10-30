import test from 'node:test';
import assert from 'node:assert/strict';
import { remindersDue, reminderText, prepareReminders, REMINDER } from '../lib/pbc-loop.js';

// Audit 2026-10-30: pieces requested and left without any reply were only chased by hand.
const DAY = 864e5, NOW = Date.parse('2026-11-20T09:00:00Z');
const sent = (id, doc, daysAgo, extra = {}) => ({ id, document: doc, status: 'requested', responses: [],
  request: { provider_message_id: 'gmail-1', to: ['client@entite.ci'], sent_at: new Date(NOW - daysAgo * DAY).toISOString(), ...extra } });

test('due after the delay, one reminder per conversation, never more than 3, never after a reply', () => {
  const rows = [sent('1', 'Grand livre 2025', 8), sent('2', 'Relevés bancaires', 8), sent('3', 'Contrats', 2),
    { ...sent('4', 'Factures', 9), responses: [{ from: 'client@entite.ci' }] },
    sent('5', 'Balance', 30, { reminders: [{ at: new Date(NOW - 30 * DAY).toISOString() }, { at: new Date(NOW - 20 * DAY).toISOString() }, { at: new Date(NOW - 10 * DAY).toISOString() }] }),
    sent('6', 'PV', 30, { reminders: [{ at: new Date(NOW - 3 * DAY).toISOString() }] })];
  const due = remindersDue(rows, NOW);
  assert.equal(due.length, 1, 'one conversation');
  assert.deepEqual(due[0].items.map(r => r.id), ['1', '2'], 'not 3 (too early), 4 (a reply), 5 (3 already), 6 (reminded 3 days ago)');
  assert.deepEqual(remindersDue(rows, NOW, 0), [], '0 = never');
  assert.equal(REMINDER.max, 3);
});

test('the text names each missing piece, in the firm\'s words, without inventing anything', () => {
  const t = reminderText({ name: 'Audit projet X 2025' }, [{ document: 'Grand livre', period_label: '2025' }, { document: 'Relevés' }], 2);
  assert.match(t.subject, /Relance/); assert.match(t.body, /- Grand livre \(2025\)/); assert.match(t.body, /- Relevés/); assert.match(t.body, /relance n° 2/);
});

test('the reminder is PREPARED (waits for a person), in the same conversation, and remembered on the request', async () => {
  const patched = [], proposed = [];
  const rows = [sent('1', 'Grand livre 2025', 8)];
  const fetchRows = async (path, o) => {
    if (path.startsWith('office_firm_settings')) return [{ settings: {}, updated_at: 't' }];
    if (path.startsWith('office_pbc_requests') && !o) return rows;
    if (path.startsWith('office_missions')) return [{ id: 'M', name: 'Audit X' }];
    if (o?.method === 'PATCH') { patched.push(JSON.parse(o.body)); return [{ ...rows[0], ...JSON.parse(o.body) }]; }
    return [];
  };
  const proposeMessage = async (org, input, account) => { proposed.push({ input, account }); return { id: 'msg-9', status: 'pending_approval' }; };
  const r = await prepareReminders('O', 'M', { fetchRows, proposeMessage, now: () => NOW, audit: async () => null });
  assert.equal(r.prepared, 1);
  assert.equal(proposed[0].account, null, 'an agent proposal, no person behind it');
  assert.equal(proposed[0].input.source, 'agent');
  assert.equal(proposed[0].input.reply_to, 'gmail-1', 'same conversation');
  assert.deepEqual(proposed[0].input.recipients, ['client@entite.ci']);
  assert.ok(patched.some(p => p.request?.reminders?.[0]?.message_id === 'msg-9'));
});

test('settings that cannot be read: no reminder prepared (never on a guessed delay)', async () => {
  const fetchRows = async path => { if (path.startsWith('office_firm_settings')) throw new Error('SUPABASE_503'); return [sent('1', 'GL', 30)]; };
  const r = await prepareReminders('O', 'M', { fetchRows, proposeMessage: async () => { throw new Error('must not be called'); }, now: () => NOW });
  assert.equal(r.skipped, 'SETTINGS_UNREADABLE');
});
