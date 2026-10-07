import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { proposeMessage, decideMessage, listMessages, buildMime, sendViaGmail, sendingMailbox, assertColleaguesOnly, messageDue, proposeTeamMessage, contentHash } from '../lib/agent-mail.js';
import { ROUTES } from '../api/app.js';

const PERSONA = { agent_display_name: 'Office Manager TATY', sender_email: 'assistant@taty.info', reply_to: 'hit@taty.info',
  internal_domains: ['taty.info'], internal_tone: 'nouchi_fun', internal_frequency: 'daily' };

function db() {
  const rows = []; let n = 0;
  const fetchRows = async (path, o = {}) => {
    const m = o.method || 'GET';
    const [table, qs] = path.split('?');
    const p = new URLSearchParams(qs || '');
    const match = r => [...p].every(([k, v]) => ['select', 'order', 'limit'].includes(k) || (v.startsWith('eq.') ? String(r[k]) === v.slice(3) : v.startsWith('gte.') ? String(r[k] || '') >= v.slice(4) : true));
    if (table === 'office_app_users') return [{ email: 'aya@taty.info' }, { email: 'koffi@taty.info' }, { email: 'client@gmail.com' }, { email: 'assistant@taty.info' }];
    if (table === 'office_agent_runs') return [{ summary: 'BLE TRANSIT : 3 pièces PBC manquantes.' }];
    if (table !== 'office_agent_messages') return [];
    if (m === 'POST') { const r = { id: 'm' + (++n), created_at: new Date(Date.now() + n).toISOString(), ...JSON.parse(o.body)[0] }; rows.push(r); return [{ ...r }]; }
    if (m === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, JSON.parse(o.body))); return hit.map(r => ({ ...r })); }
    return rows.filter(match).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(r => ({ ...r }));
  };
  return { rows, fetchRows };
}

const manager = { role: 'manager', display_name: 'Aya', email: 'aya@taty.info' };
const collaborator = { role: 'collaborator', display_name: 'Koffi', email: 'koffi@taty.info' };

test('rule: colleagues only — a client address is refused, the message is not even stored', async () => {
  const { rows, fetchRows } = db();
  await assert.rejects(proposeMessage('org', { recipients: 'aya@taty.info, client@entreprise.ci', subject: 'Point', body: 'Salut' }, manager,
    { fetchRows, getPersona: async () => PERSONA }), e => e.message === 'RECIPIENT_OUTSIDE_FIRM' && e.outside[0] === 'client@entreprise.ci');
  assert.equal(rows.length, 0);
  assert.throws(() => assertColleaguesOnly(['aya@taty.info'], { ...PERSONA, internal_domains: [] }), /INTERNAL_DOMAINS_NOT_CONFIGURED/);
  assert.throws(() => assertColleaguesOnly(['aya@taty.info'], { ...PERSONA, sender_email: '' }), /AGENT_SENDER_NOT_CONFIGURED/);
  assert.throws(() => assertColleaguesOnly(['aya@taty.info.evil.com'], PERSONA), /RECIPIENT_OUTSIDE_FIRM/, 'look-alike domain');
});

test('validation before sending: proposed → pending; collaborator cannot validate; manager edits, validates, it is sent', async () => {
  const { rows, fetchRows } = db();
  const sent = [];
  const d = { fetchRows, getPersona: async () => PERSONA, send: async (msg, persona) => { sent.push({ msg, persona }); return 'gmail-123'; },
    draftInternalMessage: async (orgId, { topic }) => ({ subject: 'On dit quoi la team ?', body: 'Ya fohi : ' + topic }) };
  const p = await proposeMessage('org', { recipients: ['Aya@taty.info', 'koffi@taty.info'], topic: 'relancer les PBC' }, collaborator, d);
  assert.equal(p.status, 'pending_approval');
  assert.deepEqual(p.recipients, ['aya@taty.info', 'koffi@taty.info']);
  assert.equal(sent.length, 0, 'nothing leaves before validation');
  await assert.rejects(decideMessage('org', { id: p.id, decision: 'approve' }, collaborator, d), /ROLE_NOT_ALLOWED/);
  const r = await decideMessage('org', { id: p.id, decision: 'approve', body: 'Texte corrigé par Aya' }, manager, d);
  assert.equal(r.status, 'sent');
  assert.equal(r.provider_message_id, 'gmail-123');
  assert.equal(sent[0].msg.body, 'Texte corrigé par Aya', 'the validated text is what is sent');
  assert.equal(rows[0].content_sha256, contentHash(sent[0].msg));
  assert.equal(rows[0].decided_by, 'Aya');
  await assert.rejects(decideMessage('org', { id: p.id, decision: 'approve' }, manager, d), /NOT_PENDING/, 'never sent twice');
});

test('a validator cannot slip a client in, and a domain removed before sending stops the send', async () => {
  const { rows, fetchRows } = db();
  let calls = 0;
  const d = { fetchRows, send: async () => { throw new Error('must not send'); },
    getPersona: async () => (++calls <= 3 ? PERSONA : { ...PERSONA, internal_domains: ['autre.ci'] }) };
  const p = await proposeMessage('org', { recipients: 'aya@taty.info', subject: 'Point', body: 'Salut' }, manager, d);
  await assert.rejects(decideMessage('org', { id: p.id, decision: 'approve', recipients: 'aya@taty.info, dg@client.ci' }, manager, d), /RECIPIENT_OUTSIDE_FIRM/);
  assert.equal(rows[0].status, 'pending_approval');
  await assert.rejects(decideMessage('org', { id: p.id, decision: 'approve' }, manager, d), /RECIPIENT_OUTSIDE_FIRM/);
  assert.equal(rows[0].status, 'failed', 'checked again right before sending');
});

test('reject needs a reason; listing counts pending', async () => {
  const { fetchRows } = db();
  const d = { fetchRows, getPersona: async () => PERSONA, env: {} };
  const p = await proposeMessage('org', { recipients: 'aya@taty.info', subject: 'Point', body: 'Salut' }, manager, d);
  await proposeMessage('org', { recipients: 'koffi@taty.info', subject: 'Point 2', body: 'Salut' }, manager, d);
  await assert.rejects(decideMessage('org', { id: p.id, decision: 'reject' }, manager, d), /COMMENT_REQUIRED/);
  const r = await decideMessage('org', { id: p.id, decision: 'reject', comment: 'Pas maintenant' }, manager, d);
  assert.equal(r.status, 'rejected');
  const l = await listMessages('org', d);
  assert.equal(l.pending, 1);
  assert.equal(l.mail_configured, false);
});

test('mail format: UTF-8 subject, internal recipients, body intact', () => {
  const raw = buildMime({ fromName: 'Office Manager TATY', from: 'assistant@taty.info', to: ['aya@taty.info'], subject: 'On dit quoi la team ? Ça va ?', body: 'Ya fohi 😉\nÀ demain', replyTo: 'hit@taty.info' });
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(text, /^From: Office Manager TATY <assistant@taty\.info>\r\nTo: aya@taty\.info\r\nReply-To: hit@taty\.info\r\nSubject: =\?UTF-8\?B\?/);
  const body = text.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Ya fohi 😉\nÀ demain');
  assert.ok(!/Bcc|Cc:/i.test(text));
  const inj = Buffer.from(buildMime({ from: 'assistant@taty.info', to: ['aya@taty.info'], subject: 'x\r\nBcc: client@gmail.com', body: 'b' }), 'base64url').toString('utf8');
  assert.ok(!/\r\nBcc:/.test(inj), 'no header injection through the subject');
});

test('Gmail sending as the agent address; missing delegation is explained', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'om@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) };
  const calls = [];
  const fetchImpl = async (url, o) => {
    calls.push({ url, o });
    if (url.includes('oauth2')) {
      const jwt = new URLSearchParams(o.body).get('assertion').split('.')[1];
      const claims = JSON.parse(Buffer.from(jwt, 'base64url').toString());
      assert.equal(claims.sub, 'assistant@taty.info');
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/gmail.send');
      return { ok: true, json: async () => ({ access_token: 'tok' }) };
    }
    return { ok: true, json: async () => ({ id: 'gm-1' }) };
  };
  const id = await sendViaGmail({ recipients: ['aya@taty.info'], subject: 'S', body: 'B' }, PERSONA, { env, fetchImpl });
  assert.equal(id, 'gm-1');
  assert.match(calls[1].url, /gmail\/v1\/users\/me\/messages\/send/);
  const denied = async () => ({ ok: false, json: async () => ({ error: 'unauthorized_client' }) });
  await assert.rejects(sendViaGmail({ recipients: ['aya@taty.info'], subject: 'S', body: 'B' }, PERSONA, { env, fetchImpl: denied }), /MAIL_DELEGATION_MISSING/);
  await assert.rejects(sendViaGmail({ recipients: ['aya@taty.info'], subject: 'S', body: 'B' }, PERSONA, { env: {}, fetchImpl }), /MAIL_NOT_CONFIGURED/);
});

test('agent initiative: proposes (never sends) one team message when due, colleagues only', async () => {
  const { rows, fetchRows } = db();
  const monday = { weekday: 1, minutes: 9 * 60 + 15, date: '2026-10-12' };
  assert.equal(messageDue('few_per_week', { ...monday, weekday: 2 }, null, Date.now()), false);
  assert.equal(messageDue('daily', { ...monday, minutes: 8 * 60 }, null, Date.now()), false, 'not before 9:00');
  const d = { fetchRows, getPersona: async () => PERSONA, now: () => new Date(),
    draftInternalMessage: async (orgId, { topic }) => ({ subject: 'Bonjour la team', body: topic }) };
  const r = await proposeTeamMessage('org', monday, d);
  assert.equal(r.proposed, true);
  assert.equal(rows[0].status, 'pending_approval');
  assert.equal(rows[0].source, 'agent');
  assert.deepEqual(rows[0].recipients, ['aya@taty.info', 'koffi@taty.info'], 'no client, not itself');
  assert.match(rows[0].body, /BLE TRANSIT/);
  assert.equal((await proposeTeamMessage('org', monday, d)).reason, 'not_due', 'once a day at most');
  assert.equal((await proposeTeamMessage('org', monday, { ...d, getPersona: async () => ({ ...PERSONA, internal_frequency: 'off' }) })).reason, 'not_configured');
});

test('routes and page: managers validate, everyone can ask; the page states the rule', () => {
  assert.deepEqual(ROUTES.messages.GET.userRoles, ['owner', 'partner', 'manager']);
  assert.deepEqual(ROUTES.messages.POST.userRoles, ['owner', 'partner', 'manager', 'collaborator']);
  const html = readFileSync(new URL('../validations.html', import.meta.url), 'utf8');
  assert.ok(!/innerHTML/.test(html));
  assert.match(html, /uniquement aux collègues/);
  assert.match(html, /Valider et envoyer/);
  assert.match(readFileSync(new URL('../db/INSTALL_TOUT.sql', import.meta.url), 'utf8'), /office_agent_messages/);
});

test('alias of a person\'s mailbox: signs in as the real mailbox, sends From the alias', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = { AGENT_MAIL_MAILBOX: 'PaulKomenan@taty.info', GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'om@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) };
  assert.equal(sendingMailbox(PERSONA, env), 'paulkomenan@taty.info');
  assert.equal(sendingMailbox(PERSONA, {}), 'assistant@taty.info');
  assert.throws(() => sendingMailbox(PERSONA, { AGENT_MAIL_MAILBOX: 'paul@gmail.com' }), /AGENT_MAILBOX_OUTSIDE_FIRM/);
  let sub = null, raw = null;
  const fetchImpl = async (url, o) => {
    if (url.includes('oauth2')) { sub = JSON.parse(Buffer.from(new URLSearchParams(o.body).get('assertion').split('.')[1], 'base64url')).sub; return { ok: true, json: async () => ({ access_token: 't' }) }; }
    raw = JSON.parse(o.body).raw; return { ok: true, json: async () => ({ id: 'g' }) };
  };
  await sendViaGmail({ recipients: ['aya@taty.info'], subject: 'S', body: 'B' }, PERSONA, { env, fetchImpl });
  assert.equal(sub, 'paulkomenan@taty.info');
  assert.match(Buffer.from(raw, 'base64url').toString(), /^From: Office Manager TATY <assistant@taty\.info>/);
});
