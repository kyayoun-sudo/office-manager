import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, readPersonalState, personalMailStart, ownedMailbox, completePersonalMail,
  personalAccessToken, personalDisconnect } from '../lib/personal-mail-oauth.js';
import { syncPersonalMail, listPersonalMail, savePersonalDraft, sendPersonalDraft } from '../lib/personal-mail-inbox.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BOX_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const BOX_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const MSG_A = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
const DRAFT_A = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa';
const env = { PERSONAL_MAIL_ENCRYPTION_KEY: 'unit-test-only-secret-with-32-chars', GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret', MICROSOFT_CLIENT_ID: 'ms-client', MICROSOFT_CLIENT_SECRET: 'ms-secret',
  OFFICE_MANAGER_PUBLIC_URL: 'https://example.test' };
const ACTOR_A = { auth_user_id: USER_A, role: 'owner' };
const ACTOR_B = { auth_user_id: USER_B, role: 'collaborator' };
const mailbox = { id: BOX_A, org_id: ORG_A, user_id: USER_A, provider: 'google', email: 'a@example.test',
  refresh_token_enc: seal('secret-refresh-A', 'oauth-token:' + [ORG_A, USER_A, 'google', 'a@example.test'].join(':'), env),
  ai_enabled: false, status: 'connected' };
const boxB = { ...mailbox, id: BOX_B, user_id: USER_B, email: 'b@example.test' };

test('encrypted personal OAuth state uses authenticated cabinet/user, PKCE and no Drive scope', () => {
  const start = personalMailStart(ORG_A, ACTOR_A, 'google', {}, { env });
  const u = new URL(start.url);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(!u.searchParams.get('scope').includes('auth/drive'));
  assert.equal(u.searchParams.get('redirect_uri'), 'https://example.test/oauth/google/callback');
  const state = readPersonalState(u.searchParams.get('state'), env);
  assert.equal(state.org, ORG_A);
  assert.equal(state.uid, USER_A);
  assert.ok(state.verifier.length > 32);
  assert.throws(() => readPersonalState(u.searchParams.get('state') + 'x', env), /PERSONAL_MAIL_STATE_INVALID/);
  const ms = personalMailStart(ORG_B, ACTOR_B, 'microsoft', {}, { env });
  assert.equal(new URL(ms.url).searchParams.get('redirect_uri'), 'https://example.test/api/app?route=personal-mail-callback');
});

test('different subjects cannot decrypt each other’s mailbox secret', () => {
  const ciphertext = seal('private-token', 'oauth-token:' + ORG_A + ':' + USER_A, env);
  assert.equal(unseal(ciphertext, 'oauth-token:' + ORG_A + ':' + USER_A, env), 'private-token');
  assert.throws(() => unseal(ciphertext, 'oauth-token:' + ORG_A + ':' + USER_B, env), /PERSONAL_MAIL_SECRET_INVALID/);
});

test('owner role cannot read another colleague mailbox, nor another cabinet', async () => {
  const db = async path => {
    if (path.includes('org_id=eq.' + ORG_A) && path.includes('user_id=eq.' + USER_A) && path.includes('id=eq.' + BOX_A)) return [mailbox];
    return [];
  };
  assert.equal((await ownedMailbox(ORG_A, ACTOR_A, BOX_A, { db })).email, mailbox.email);
  await assert.rejects(ownedMailbox(ORG_A, ACTOR_B, BOX_A, { db }), /PERSONAL_MAILBOX_NOT_FOUND/);
  await assert.rejects(ownedMailbox(ORG_B, ACTOR_A, BOX_A, { db }), /PERSONAL_MAILBOX_NOT_FOUND/);
});

test('OAuth callback verifies the still-active account and stores token encrypted under the correct user', async () => {
  const request = personalMailStart(ORG_A, ACTOR_A, 'google', {}, { env });
  const state = new URL(request.url).searchParams.get('state');
  const writes = [];
  const db = async (path, options = {}) => {
    if (path.startsWith('office_app_users?')) return [{ auth_user_id: USER_A }];
    if (path.startsWith('office_email_accounts?on_conflict')) { writes.push(JSON.parse(options.body)[0]); return []; }
    throw new Error('unexpected ' + path);
  };
  const response = x => new Response(JSON.stringify(x), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async u => {
    if (String(u).includes('/token')) return response({ access_token: 'a-token', refresh_token: 'new-refresh-UNSAFE',
      scope: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send' });
    if (String(u).includes('userinfo')) return response({ email: 'a@example.test', email_verified: true });
    if (String(u).includes('/profile')) return response({ emailAddress: 'a@example.test' });
    throw new Error('unknown provider URL');
  };
  const r = await completePersonalMail({ query: { state, code: 'authorization-code' } }, { env, db, fetchImpl });
  assert.equal(r.email, 'a@example.test');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].org_id, ORG_A);
  assert.equal(writes[0].user_id, USER_A);
  assert.ok(writes[0].refresh_token_enc.startsWith('pm1.'));
  assert.ok(!writes[0].refresh_token_enc.includes('UNSAFE'));
});

test('revoked refresh token requires reconnect, never falls back to owner access', async () => {
  const patches = [];
  const db = async (path, opts) => { patches.push({ path, opts }); return []; };
  const fetchImpl = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  await assert.rejects(personalAccessToken(mailbox, { db, fetchImpl, env }), /PERSONAL_MAIL_RECONNECT_REQUIRED/);
  assert.ok(JSON.parse(patches[0].opts.body).status === 'reconnect_required');
  assert.ok(patches[0].path.includes('user_id=eq.' + USER_A));
});

test('sync uses mailbox-specific credentials and persists only scoped messages', async () => {
  const recorded = [];
  const db = async (path, opts = {}) => {
    if (path.startsWith('office_email_accounts?') && path.includes('select=*')) return [mailbox];
    if (path.startsWith('office_personal_mail_items?') && !opts.method) return [];
    if (path.startsWith('office_personal_mail_items?on_conflict=')) { recorded.push(...JSON.parse(opts.body)); return []; }
    if (opts.method === 'PATCH') return [];
    throw new Error('Unexpected DB path: ' + path);
  };
  const fetchImpl = async url => {
    url = String(url);
    if (url.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'private-A' }));
    if (url.includes('/messages?')) return new Response(JSON.stringify(url.includes('in%3Asent') ? { messages: [] } : { messages: [{ id: 'mail-A' }] }));
    if (url.includes('/messages/mail-A')) return new Response(JSON.stringify({
      id: 'mail-A', threadId: 'thread-A', internalDate: String(Date.now()), labelIds: ['INBOX','UNREAD'], snippet: 'Bonjour, le grand livre.',
      payload: { headers: [{ name: 'From', value: 'Client <client@example.test>' }, { name: 'Subject', value: 'GL requis' }] }
    }));
    throw new Error('Unexpected fetch ' + url);
  };
  const r = await syncPersonalMail(ORG_A, ACTOR_A, BOX_A, { db, env, fetchImpl });
  assert.equal(r.added, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].user_id, USER_A);
  assert.equal(recorded[0].org_id, ORG_A);
  assert.equal(recorded[0].mailbox_id, BOX_A);
  assert.equal(recorded[0].sender_email, 'client@example.test');
});

test('a draft is not sent without explicit confirmation', async () => {
  await assert.rejects(sendPersonalDraft(ORG_A, ACTOR_A, BOX_A, DRAFT_A, false), /PERSONAL_MAIL_SEND_CONFIRMATION_REQUIRED/);
});

test('reply draft cannot be redirected to an arbitrary external recipient', async () => {
  const db = async (path) => {
    if (path.startsWith('office_email_accounts?')) return [mailbox];
    if (path.startsWith('office_personal_mail_items?')) return [{ id: MSG_A, sender_email: 'client@example.test', provider_message_id: 'provider-msg' }];
    throw Error('Unexpected ' + path);
  };
  await assert.rejects(savePersonalDraft(ORG_A, ACTOR_A, BOX_A,
    { recipient: 'attacker@example.test', subject: 'Re', body: 'Hello', reply_to_id: MSG_A }, { db }),
  /PERSONAL_MAIL_REPLY_RECIPIENT_MISMATCH/);
});


test('AI consent applied after first sync classifies previously cached private messages', async () => {
  const row = { ...mailbox, ai_enabled: true };
  const patched = [];
  let aiCalls = 0;
  const db = async (path, opts = {}) => {
    if (path.startsWith('office_email_accounts?') && path.includes('select=*')) return [row];
    if (path.startsWith('office_personal_mail_items?') && !opts.method) return [
      { id: MSG_A, provider_message_id: 'mail-A', folder: 'inbox', needs_action: null, unread: false, has_attachments: false }
    ];
    if (opts.method === 'PATCH') { patched.push({ path, data: JSON.parse(opts.body) }); return []; }
    throw Error('unhandled DB ' + path);
  };
  const fetchImpl = async url => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'private-A' }));
    if (u.includes('/messages?')) return new Response(JSON.stringify(u.includes('in%3Asent') ? { messages: [] } : { messages: [{ id: 'mail-A' }] }));
    if (u.includes('/messages/mail-A')) return new Response(JSON.stringify({
      id: 'mail-A', threadId: 'thread-A', internalDate: String(Date.now()), labelIds: ['INBOX','UNREAD'],
      snippet: 'Le grand livre est demandé', payload: { headers: [
        { name: 'From', value: 'Client <client@example.test>' }, { name: 'Subject', value: 'GL' }
      ] }
    }));
    throw Error('unexpected provider ' + u);
  };
  const ai = async () => {
    aiCalls++;
    return { text: JSON.stringify({ items: [{ id: 'mail-A', needs_action: true, importance: 'haute', category: 'document',
      summary: 'Grand livre demandé', suggested_action: 'Préparer le grand livre', deadline: '' }] }) };
  };
  const result = await syncPersonalMail(ORG_A, ACTOR_A, BOX_A, { db, env, fetchImpl, ai });
  assert.equal(result.added, 0);
  assert.equal(aiCalls, 1);
  assert.ok(patched.some(p => p.path.includes('office_personal_mail_items?') && p.data.needs_action === true));
  assert.ok(patched.every(p => p.path.includes('user_id=eq.' + USER_A)));
});

test('Gmail personal send uses the connected person only and requires atomic draft ownership', async () => {
  const draft = { id: DRAFT_A, user_id: USER_A, mailbox_id: BOX_A, recipient: 'client@example.test', subject: 'Bonjour',
    body: 'Voici mon message', reply_to_provider_id: null, status: 'draft' };
  let draftStatus = 'draft';
  const providerRequests = [];
  const db = async (path, opts = {}) => {
    if (path.startsWith('office_email_accounts?') && path.includes('select=*')) return [mailbox];
    if (path.startsWith('office_personal_mail_drafts?') && !opts.method) return draftStatus === 'draft' ? [draft] : [];
    if (path.startsWith('office_personal_mail_drafts?') && opts.method === 'PATCH') {
      const next = JSON.parse(opts.body);
      if (next.status === 'sending' && draftStatus === 'draft') { draftStatus = 'sending'; return [{ ...draft, status: 'sending' }]; }
      if (next.status === 'sent') draftStatus = 'sent';
      return [];
    }
    throw Error('unexpected ' + path);
  };
  const fetchImpl = async (url, options) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'private-A' }));
    if (u.includes('/messages/send')) { providerRequests.push(options); return new Response(JSON.stringify({ id: 'sent-A' })); }
    throw Error('unexpected provider ' + u);
  };
  assert.deepEqual(await sendPersonalDraft(ORG_A, ACTOR_A, BOX_A, DRAFT_A, true, { db, env, fetchImpl }),
    { sent: true, accepted_by_provider: true });
  assert.equal(draftStatus, 'sent');
  assert.equal(providerRequests.length, 1);
  const raw = Buffer.from(JSON.parse(providerRequests[0].body).raw, 'base64url').toString();
  assert.match(raw, /From: a@example.test/);
  assert.match(raw, /To: client@example.test/);
  await assert.rejects(sendPersonalDraft(ORG_A, ACTOR_A, BOX_A, DRAFT_A, true, { db, env, fetchImpl }), /PERSONAL_DRAFT_NOT_SENDABLE/);
  assert.equal(providerRequests.length, 1);
});


test('an auditor cannot bypass firm approval by emailing a registered mission client from a personal mailbox', async () => {
  const privateBox = { ...boxB, org_id: ORG_A, user_id: USER_B, status: 'connected' };
  let transmissions = 0;
  const db = async (path, opts = {}) => {
    if (path.startsWith('office_email_accounts?') && path.includes('user_id=eq.' + USER_B)) return [privateBox];
    if (path.startsWith('office_personal_mail_drafts?') && path.includes('select=')) return [{
      id: DRAFT_A, recipient: 'client@example.test', subject: 'Documents', body: 'Voici le GL', status: 'draft'
    }];
    if (path.startsWith('office_missions?')) {
      assert.match(path, new RegExp('org_id=eq.' + ORG_A));
      assert.match(decodeURIComponent(path), /client_contact_emails=cs.\{client@example.test\}/);
      return [{ id: 'client-mission' }];
    }
    if (opts.method === 'PATCH') transmissions++;
    throw Error('Unexpected query ' + path);
  };
  await assert.rejects(sendPersonalDraft(ORG_A, ACTOR_B, BOX_B, DRAFT_A, true, { db, env }), /PERSONAL_MAIL_CLIENT_REQUIRES_FIRM_APPROVAL/);
  assert.equal(transmissions, 0, 'client communication cannot even claim an outbound draft');
});
