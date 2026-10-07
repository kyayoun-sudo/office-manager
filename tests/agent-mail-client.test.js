import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeMessage, decideMessage, contentHash } from '../lib/agent-mail.js';

// Client e-mails (rule of 2026-10-07): draft by the agent, validated (and editable) by a
// manager, sent only to the contact registered on the mission.
const PERSONA = { sender_email: 'paulkomenan@taty.info', internal_domains: ['taty.info'], internal_tone: 'nouchi_fun' };

function world(contacts = ['cfo@client.ci']) {
  const rows = [];
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_missions')) return path.includes('id=eq.m1') ? [{ id: 'm1', client_contact_emails: contacts }] : [];
    if (path.startsWith('office_agent_messages')) {
      if (o.method === 'POST') { const r = { id: 'msg' + (rows.length + 1), ...JSON.parse(o.body)[0] }; rows.push(r); return [r]; }
      if (o.method === 'PATCH') { const id = path.match(/&id=eq\.([^&]+)/)?.[1]; const r = rows.find(x => x.id === id); if (!r) return []; Object.assign(r, JSON.parse(o.body)); return [r]; }
      if (path.includes('status=eq.sent')) return [];
      const id = path.match(/&id=eq\.([^&]+)/)?.[1];
      return rows.filter(x => !id || x.id === id);
    }
    return [];
  };
  return { rows, fetchRows };
}
const draft = { audience: 'client', office_mission_id: 'm1', recipients: ['cfo@client.ci'], subject: 'Relance — documents attendus', body: 'Madame, Monsieur, …', source: 'agent' };

test('a client draft only goes to the registered contact, formal tone, needs a written text', async () => {
  const w = world();
  const m = await proposeMessage('org', draft, null, { fetchRows: w.fetchRows, getPersona: async () => PERSONA });
  assert.equal(m.audience, 'client');
  assert.equal(m.tone, 'formal');
  assert.equal(m.status, 'pending_approval');
  await assert.rejects(proposeMessage('org', { ...draft, recipients: ['autre@client.ci'] }, null, { fetchRows: w.fetchRows, getPersona: async () => PERSONA }), /RECIPIENT_NOT_CLIENT_CONTACT/);
  await assert.rejects(proposeMessage('org', { ...draft, office_mission_id: null }, null, { fetchRows: w.fetchRows, getPersona: async () => PERSONA }), /MISSION_REQUIRED_FOR_CLIENT_MAIL/);
  await assert.rejects(proposeMessage('org', { ...draft, office_mission_id: 'm1' }, null, { fetchRows: world([]).fetchRows, getPersona: async () => PERSONA }), /CLIENT_CONTACT_NOT_REGISTERED/);
  await assert.rejects(proposeMessage('org', { ...draft, body: '' }, null, { fetchRows: w.fetchRows, getPersona: async () => PERSONA }), /CLIENT_DRAFT_REQUIRES_TEXT/);
  // Colleague messages are unchanged: a client address is refused there.
  await assert.rejects(proposeMessage('org', { recipients: ['cfo@client.ci'], subject: 's', body: 'b' }, null, { fetchRows: w.fetchRows, getPersona: async () => PERSONA }), /RECIPIENT_OUTSIDE_FIRM/);
});

test('validation: only a manager-level account; edits are what is sent; the recipient cannot be changed to another address', async () => {
  const w = world();
  const sent = [];
  const d = { fetchRows: w.fetchRows, getPersona: async () => PERSONA, send: async msg => { sent.push(msg); return 'gmail-1'; } };
  const m = await proposeMessage('org', draft, null, d);
  await assert.rejects(decideMessage('org', { id: m.id, decision: 'approve', seen_sha256: m.content_sha256 }, { role: 'collaborator' }, d), /ROLE_NOT_ALLOWED/);
  await assert.rejects(decideMessage('org', { id: m.id, decision: 'approve', seen_sha256: m.content_sha256, recipients: ['pirate@evil.com'] }, { role: 'manager', display_name: 'Serge' }, d), /RECIPIENT_NOT_CLIENT_CONTACT/);
  assert.equal(sent.length, 0);
  const r = await decideMessage('org', { id: m.id, decision: 'approve', seen_sha256: m.content_sha256, body: 'Madame, Monsieur, texte corrigé par Serge.' }, { role: 'manager', display_name: 'Serge' }, d);
  assert.equal(r.status, 'sent');
  assert.equal(sent[0].body, 'Madame, Monsieur, texte corrigé par Serge.');
  assert.deepEqual(sent[0].recipients, ['cfo@client.ci']);
  assert.equal(r.decided_by, 'Serge');
  assert.equal(r.content_sha256, contentHash(sent[0]));
});
