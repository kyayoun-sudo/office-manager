// Paul, 2026-11-16: « le client dit chacun doit avoir ses mails pour pouvoir répondre et tout ; d'autres collaborateurs
// disent qu'ils ne voient pas leurs mails ». Each person links their OWN mailbox; nobody else sees it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectMailbox, finishMailbox, myMailView, refreshMyMail, draftMyReply, sendMyReply, unlinkMailbox, buildReply, _resetPersonalMailCache } from '../lib/personal-mail.js';
import { makeState, encryptToken, SCOPES } from '../lib/google-connection.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', OAUTH_STATE_SECRET: 's'.repeat(40), GOOGLE_TOKEN_ENCRYPTION_KEY: 'k'.repeat(40),
  OFFICE_MANAGER_PUBLIC_URL: 'https://office.example.com' };
const ana = { email: 'ana@cabinet.test', display_name: 'Ana', role: 'auditeur' };
const bob = { email: 'bob@cabinet.test', display_name: 'Bob', role: 'partner' };
const noAudit = { audit: async () => {} };

// A tiny in-memory PostgREST: just what the module asks.
function db(seed = {}) {
  const t = { office_user_mailboxes: [], office_user_mail_items: [], office_app_users: [{ org_id: ORG, email: 'ana@cabinet.test', active: true }, { org_id: ORG, email: 'bob@cabinet.test', active: true }], office_missions: [], ...seed };
  const calls = [];
  const parse = path => { const [table, qs] = path.split('?'); return { table, p: new URLSearchParams(qs || '') }; };
  const match = (row, p) => [...p.entries()].every(([k, v]) => {
    if (['select', 'limit', 'order', 'on_conflict'].includes(k) || k.includes('status')) return true;
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v === 'is.true') return row[k] === true;
    if (v === 'is.null') return row[k] == null;
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(s => s.replace(/"/g, '')).includes(String(row[k]));
    return true;
  });
  async function fetchRows(path, init = {}) {
    const { table, p } = parse(path); calls.push({ table, method: init.method || 'GET', path });
    const rows = t[table] || (t[table] = []);
    if (!init.method) return rows.filter(r => match(r, p)).map(r => ({ ...r }));
    if (init.method === 'POST') {
      const keys = (p.get('on_conflict') || '').split(',').filter(Boolean);
      for (const n of JSON.parse(init.body)) {
        const i = keys.length ? rows.findIndex(r => keys.every(k => r[k] === n[k])) : -1;
        if (i >= 0) rows[i] = { ...rows[i], ...n }; else rows.push({ ...n });
      }
      return null;
    }
    if (init.method === 'PATCH') { for (const r of rows.filter(r => match(r, p))) Object.assign(r, JSON.parse(init.body)); return null; }
    if (init.method === 'DELETE') { t[table] = rows.filter(r => !match(r, p)); return null; }
  }
  return { t, calls, fetchRows };
}

function googleFetch(log, { email = 'ana@cabinet.test', scope = ['openid', 'email', SCOPES.gmailRead, SCOPES.gmailSend].join(' '), refresh = 'r-ana' } = {}) {
  return async (url, init = {}) => {
    log.push({ url: String(url), init });
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      const b = String(init.body);
      if (b.includes('authorization_code')) return json({ access_token: 'at', refresh_token: refresh, scope });
      return json({ access_token: 'at-' + new URLSearchParams(b).get('refresh_token'), expires_in: 3600 });
    }
    if (String(url).includes('userinfo')) return json({ email, email_verified: true, name: 'Ana' });
    if (String(url).includes('/messages?')) return json({ messages: [{ id: 'm1' }, { id: 'm2' }] });
    if (String(url).includes('/messages/m1?format=full')) return json({ id: 'm1', threadId: 't1', snippet: 'Pouvez-vous envoyer le GL ?', internalDate: '1763280000000',
      payload: { headers: [{ name: 'From', value: 'Client <cfo@client.test>' }, { name: 'Subject', value: 'GL 2025' }], mimeType: 'text/plain', body: { data: Buffer.from('Pouvez-vous envoyer le GL ?').toString('base64url') } } });
    if (String(url).includes('/messages/m2?format=full')) return json({ id: 'm2', threadId: 't2', snippet: 'Newsletter', internalDate: '1763280000000',
      payload: { headers: [{ name: 'From', value: 'news@x.test' }, { name: 'Subject', value: 'News' }] } });
    if (String(url).includes('format=metadata')) return json({ payload: { headers: [{ name: 'Message-ID', value: '<abc@client.test>' }] } });
    if (String(url).endsWith('/messages/send')) return json({ id: 'sent-1', threadId: 't1' });
    if (String(url).includes('revoke')) return json({});
    throw new Error('unexpected ' + url);
  };
}
const ai = async () => ({ text: JSON.stringify({ items: [{ id: 'm1', needs_action: true, importance: 'haute', summary: 'Le client demande le GL 2025.', suggested_action: 'Envoyer le GL' }, { id: 'm2', needs_action: false }] }) });

async function linkAna(d) {
  const req = { account: ana, headers: { host: 'office.example.com' } };
  const { url } = connectMailbox(ORG, req, { env });
  const u = new URL(url);
  assert.equal(u.searchParams.get('login_hint'), 'ana@cabinet.test');
  assert.ok(u.searchParams.get('scope').includes(SCOPES.gmailSend) && !u.searchParams.get('scope').includes(SCOPES.drive), 'read + send, never Drive');
  return finishMailbox(ORG, { query: { code: 'c', state: u.searchParams.get('state') }, headers: req.headers }, { ...d, env });
}

test('a person links their own mailbox: token encrypted, never in clear; another Google account is refused', async () => {
  _resetPersonalMailCache();
  const base = db(), log = [];
  const r = await linkAna({ fetchRows: base.fetchRows, fetchImpl: googleFetch(log), ...noAudit });
  assert.equal(r.__redirect, '/accueil.html?mailbox=ok#mes-mails');
  const row = base.t.office_user_mailboxes[0];
  assert.equal(row.user_email, 'ana@cabinet.test');
  assert.ok(row.refresh_token_enc.startsWith('v1.') && !row.refresh_token_enc.includes('r-ana'));

  const other = db(), log2 = [];
  const r2 = await linkAna({ fetchRows: other.fetchRows, fetchImpl: googleFetch(log2, { email: 'someone@else.test' }), ...noAudit });
  assert.equal(r2.__redirect, '/accueil.html?mailbox=MAILBOX_NOT_YOURS#mes-mails');
  assert.equal(other.t.office_user_mailboxes.length, 0);

  const third = db(), log3 = [];
  const r3 = await linkAna({ fetchRows: third.fetchRows, fetchImpl: googleFetch(log3, { scope: 'openid email ' + SCOPES.gmailRead }), ...noAudit });
  assert.equal(r3.__redirect, '/accueil.html?mailbox=MAILBOX_RIGHTS_MISSING#mes-mails');
});

test('the mailbox is read with the person\'s own token; only their items, never the body; a partner sees nothing of it', async () => {
  _resetPersonalMailCache();
  const base = db(), log = [];
  const d = { fetchRows: base.fetchRows, fetchImpl: googleFetch(log), env, ai, ...noAudit };
  await linkAna(d);
  const out = await refreshMyMail(ORG, ana, d);
  assert.deepEqual(out, { new: 2, needs_action: 1 });
  assert.ok(log.some(c => c.url.includes('/messages?') && c.init.headers.Authorization === 'Bearer at-r-ana'), 'Ana\'s own token');
  assert.ok(base.t.office_user_mail_items.every(r => !('body' in r)), 'the body is never kept');
  const mine = await myMailView(ORG, ana, d);
  assert.equal(mine.linked, true);
  assert.deepEqual(mine.items.map(i => i.id), ['m1']);
  const bobs = await myMailView(ORG, bob, d);
  assert.equal(bobs.linked, false);
  await assert.rejects(draftMyReply(ORG, bob, 'm1', 'oui', d), /MAIL_NOT_FOUND/);
  await assert.rejects(sendMyReply(ORG, bob, { id: 'm1', body: 'x' }, d), /MAIL_NOT_FOUND/);
  // Read again: nothing new, the AI is not called again.
  let called = 0;
  assert.deepEqual(await refreshMyMail(ORG, ana, { ...d, ai: async () => { called++; return { text: '{}' }; } }), { new: 0, needs_action: 0 });
  assert.equal(called, 0);
});

test('the reply leaves from the person\'s own address, in the same conversation; the item is done with Gmail\'s id', async () => {
  _resetPersonalMailCache();
  const base = db(), log = [];
  const d = { fetchRows: base.fetchRows, fetchImpl: googleFetch(log), env, ai, ...noAudit };
  await linkAna(d); await refreshMyMail(ORG, ana, d);
  const r = await sendMyReply(ORG, ana, { id: 'm1', subject: 'Re: GL 2025', body: 'Bonjour,\nCi-joint le GL.\nAna' }, d);
  assert.deepEqual(r, { sent: true, gmail_id: 'sent-1', thread_id: 't1' });
  const send = log.find(c => c.url.endsWith('/messages/send'));
  const payload = JSON.parse(send.init.body);
  assert.equal(payload.threadId, 't1');
  const raw = Buffer.from(payload.raw, 'base64url').toString('utf8');
  assert.match(raw, /^From: ana@cabinet\.test\r\nTo: cfo@client\.test\r\n/);
  assert.match(raw, /In-Reply-To: <abc@client\.test>/);
  assert.equal(base.t.office_user_mail_items.find(i => i.id === 'm1').done.gmail_id, 'sent-1');
  assert.deepEqual((await myMailView(ORG, ana, d)).items, []);
});

test('a header cannot be injected through the subject; unlinking revokes at Google and erases token and items', async () => {
  const raw = Buffer.from(buildReply({ from: 'a@x.test', to: 'b@y.test', subject: 'Hi\r\nBcc: evil@z.test', body: 'x' }), 'base64url').toString('utf8');
  assert.ok(!/\r\nBcc:/.test(raw));
  _resetPersonalMailCache();
  const base = db(), log = [];
  const d = { fetchRows: base.fetchRows, fetchImpl: googleFetch(log), env, ai, ...noAudit };
  await linkAna(d); await refreshMyMail(ORG, ana, d);
  await unlinkMailbox(ORG, ana, d);
  assert.ok(log.some(c => c.url.includes('oauth2.googleapis.com/revoke') && String(c.init.body).includes('r-ana')));
  assert.equal(base.t.office_user_mailboxes[0].refresh_token_enc, null);
  assert.equal(base.t.office_user_mail_items.length, 0);
  assert.equal((await myMailView(ORG, ana, d)).linked, false);
});

test('the signed state of a mailbox link carries the person and comes back to the home page', () => {
  const st = makeState(ORG, 'ana@cabinet.test', env, Date.now(), '/accueil.html', 'mailbox');
  const body = JSON.parse(Buffer.from(st.split('.')[0], 'base64url').toString('utf8'));
  assert.equal(body.m, 'mailbox'); assert.equal(body.by, 'ana@cabinet.test'); assert.equal(body.ret, '/accueil.html');
  assert.ok(encryptToken('x', env).startsWith('v1.'));
});

test('an e-mail is linked only to a mission the person may open; the AI never hears of the others', async () => {
  _resetPersonalMailCache();
  const A = '22222222-2222-4222-8222-222222222222', B = '33333333-3333-4333-8333-333333333333';
  const base = db({ office_missions: [{ org_id: ORG, id: A, name: 'Mission A', mission_code: 'A', status: 'fieldwork' }, { org_id: ORG, id: B, name: 'Mission secrète', mission_code: 'B', status: 'fieldwork' }] }), log = [];
  let seen = '';
  const d = { fetchRows: base.fetchRows, fetchImpl: googleFetch(log), env, ...noAudit, accessibleMissionIds: async () => new Set([A]),
    ai: async (_o, req) => { seen = req.input; return { text: JSON.stringify({ items: [{ id: 'm1', needs_action: true, mission_id: B, summary: 's' }] }) }; } };
  await linkAna(d);
  await refreshMyMail(ORG, ana, d);
  assert.ok(seen.includes('Mission A') && !seen.includes('secrète'), 'only the missions Ana may open are given to the AI');
  assert.equal(base.t.office_user_mail_items.find(i => i.id === 'm1').mission_id, null, 'a mission she cannot open is never linked');
});
