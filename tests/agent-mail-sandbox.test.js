import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mailSandbox, assertSandboxRecipients, assertColleaguesOnly, sendViaGmail } from '../lib/agent-mail.js';

// Test run "TATY TEST" in preview: mail can only reach Paul's own mailboxes.
const PERSONA = { sender_email: 'paulkomenan@taty.info', internal_domains: ['taty.info'], agent_display_name: 'Office Manager TEST' };
const PREVIEW = {
  VERCEL_ENV: 'preview',
  AGENT_MAIL_SANDBOX_COLLEAGUES: 'kpaulyann@yahoo.fr, paul.manager.test@gmail.com',
  AGENT_MAIL_SANDBOX_CLIENTS: 'paul.cfo.test@gmail.com'
};

test('sandbox is active in preview only (or when forced), production unchanged', () => {
  assert.equal(mailSandbox({ VERCEL_ENV: 'production' }), null);
  assert.equal(mailSandbox({}), null);
  assert.ok(mailSandbox({ AGENT_MAIL_SANDBOX: 'on' }));
  const box = mailSandbox(PREVIEW);
  assert.deepEqual(box.colleagues, ['kpaulyann@yahoo.fr', 'paul.manager.test@gmail.com']);
  assert.deepEqual(box.clients, ['paul.cfo.test@gmail.com']);
});

test('in preview: a preview without a list sends nothing; any address outside the list is refused', () => {
  assert.throws(() => assertSandboxRecipients(['kpaulyann@yahoo.fr'], { VERCEL_ENV: 'preview' }), /MAIL_SANDBOX_EMPTY/);
  assert.doesNotThrow(() => assertSandboxRecipients(['KPaulYann@yahoo.fr', 'paul.cfo.test@gmail.com'], PREVIEW));
  // Even a real colleague of the firm is refused during the test: the workers are never written to.
  assert.throws(() => assertSandboxRecipients(['yvan@taty.info'], PREVIEW), /MAIL_SANDBOX_RECIPIENT_REFUSED/);
  assert.throws(() => assertSandboxRecipients(['kpaulyann@yahoo.fr', 'client@real-company.ci'], PREVIEW), /MAIL_SANDBOX_RECIPIENT_REFUSED/);
});

test('Paul’s addresses playing the team count as colleagues in the sandbox, the CFO address does not', () => {
  assert.doesNotThrow(() => assertColleaguesOnly(['paul.manager.test@gmail.com'], PERSONA, PREVIEW));
  assert.throws(() => assertColleaguesOnly(['paul.cfo.test@gmail.com'], PERSONA, PREVIEW), /RECIPIENT_OUTSIDE_FIRM/);
  // Outside the sandbox, a gmail address is never a colleague.
  assert.throws(() => assertColleaguesOnly(['paul.manager.test@gmail.com'], PERSONA, { VERCEL_ENV: 'production' }), /RECIPIENT_OUTSIDE_FIRM/);
});

test('last gate: sendViaGmail refuses before any Google call when a recipient is outside the list', async () => {
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return { ok: true, json: async () => ({ access_token: 't', id: 'm1' }) }; };
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = { ...PREVIEW, GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) };
  await assert.rejects(sendViaGmail({ recipients: ['yvan@taty.info'], subject: 's', body: 'b' }, PERSONA, { env, fetchImpl }), /MAIL_SANDBOX_RECIPIENT_REFUSED/);
  assert.equal(calls.length, 0, 'nothing reached Google');
  assert.equal(await sendViaGmail({ recipients: ['paul.cfo.test@gmail.com'], subject: 's', body: 'b' }, PERSONA, { env, fetchImpl }), 'm1');
});
