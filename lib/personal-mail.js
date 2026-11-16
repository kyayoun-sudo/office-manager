// CHACUN SA BOÎTE E-MAIL (Paul, 2026-11-16 : « le client dit chacun doit avoir ses mails pour pouvoir répondre et tout ;
// d'autres collaborateurs disent qu'ils ne voient pas leurs mails »).
// Before: ONE mailbox per firm (the Google account connected in Paramètres), shown only to owner / partners / managers.
// Now each person may link THEIR OWN Google mailbox (any role):
//   - Google asks the person (read + send, never Drive); the mailbox must be the person's own account e-mail;
//   - recent messages are read and the AI says which need an action (summary, mission, suggested action) — the body is
//     never kept, only what the AI understood (office_user_mail_items);
//   - the AI drafts a reply, the person corrects it; « Envoyer » sends it FROM THEIR OWN ADDRESS, in the same Gmail
//     conversation (the click of the person is the decision; « sent » only with Gmail's id);
//   - nobody else sees a person's mailbox or its items, owner and partners included (every query is filtered on the
//     signed-in account); « Délier » revokes Google's access and erases the token and the items.
// The firm's mailbox (lib/mail-triage.js) is unchanged. E-mail content is DATA: nothing in it is ever executed or followed.
import { rest } from './supabase.js';
import { encryptToken, decryptToken, exchangeCode, startMailboxConnect, googleClientCredentials, SCOPES } from './google-connection.js';
import { gmail, parseMessage, TRIAGE, REPLY } from './mail-triage.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { LIVE_FILTER } from './mission-status.js';
import { accessibleMissionIds } from './mission-access.js';

const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const cut = (s, n) => String(s ?? '').slice(0, n);
const ORDER = ['anthropic', 'openai', 'gemini'];
const QUERY = 'in:inbox newer_than:7d -category:promotions -category:social -category:forums';
const MAX = 30, LIST = 40;
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const RANK = { haute: 0, moyenne: 1, basse: 2 };
const emailOf = account => String(account?.email || '').trim().toLowerCase();
const keyOf = (orgId, email) => orgId + '|' + email;
const tokens = new Map(); // org|email -> { token, exp }

function me(account) {
  const email = emailOf(account);
  if (!email) throw fail('USER_SESSION_REQUIRED', 401);
  return email;
}

async function mailboxRow(orgId, email, fetchRows) {
  return (await fetchRows('office_user_mailboxes?org_id=eq.' + q(orgId) + '&user_email=eq.' + q(email) + '&select=google_email,refresh_token_enc,scopes,connected_at,revoked_at,last_triage_at,last_error&limit=1'))?.[0] || null;
}
const linked = row => Boolean(row && row.refresh_token_enc && !row.revoked_at);

// 1. « Relier ma boîte e-mail »: the address of Google's consent page, for the signed-in person only.
export function connectMailbox(orgId, req, d = {}) {
  return startMailboxConnect(orgId, req, me(req.account), d.env);
}

// 2. Google's return (lib/google-signin.js completeGoogleReturn, state mode « mailbox »). No session comes back with Google:
// the person is the account e-mail the server signed in the state; the mailbox must be that same address.
export async function finishMailbox(orgId, req, d = {}) {
  const fetchRows = d.fetchRows || rest, env = d.env || process.env;
  const back = code => ({ __redirect: '/accueil.html?mailbox=' + q(code) + '#mes-mails' });
  let x;
  try { x = await (d.exchangeCode || exchangeCode)(orgId, req, d); }
  catch (e) { return back(String(e.message || e).split(':')[0].slice(0, 60)); }
  if (x.st.m !== 'mailbox') throw fail('OAUTH_STATE_INVALID');
  const email = String(x.st.by || '').toLowerCase();
  if (!email || x.email !== email) return back('MAILBOX_NOT_YOURS');
  const person = (await fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&email=eq.' + q(email) + '&select=active&limit=1'))?.[0];
  if (!person?.active) return back('NOT_IN_THIS_CABINET');
  if (!x.scopes.includes(SCOPES.gmailRead) || !x.scopes.includes(SCOPES.gmailSend)) return back('MAILBOX_RIGHTS_MISSING');
  if (!x.refresh) return back('GOOGLE_NO_REFRESH_TOKEN');
  const now = new Date().toISOString();
  await fetchRows('office_user_mailboxes?on_conflict=org_id,user_email', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: orgId, user_email: email, google_email: x.email, refresh_token_enc: encryptToken(x.refresh, env), scopes: x.scopes,
      connected_at: now, revoked_at: null, last_error: null, updated_at: now }])
  });
  tokens.delete(keyOf(orgId, email));
  await audit(orgId, { action_type: 'PERSONAL_MAILBOX_LINKED', source_ref: 'user:' + email, decision: email + ' a relié sa boîte e-mail (lecture et envoi)' }, d);
  return back('ok');
}

async function accessToken(orgId, email, d = {}) {
  const fetchRows = d.fetchRows || rest, fetchImpl = d.fetchImpl || fetch, env = d.env || process.env;
  const k = keyOf(orgId, email), c = tokens.get(k);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const row = await mailboxRow(orgId, email, fetchRows);
  if (!linked(row)) throw fail('MAILBOX_NOT_LINKED', 409);
  const client = googleClientCredentials(env);
  if (!client) throw fail('GOOGLE_CLIENT_NOT_CONFIGURED', 503);
  const r = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decryptToken(row.refresh_token_enc, env), client_id: client.id, client_secret: client.secret })
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) {
    // Access withdrawn at Google (password changed, access removed): said, and the person relinks.
    const code = t.error === 'invalid_grant' ? 'MAILBOX_ACCESS_REVOKED' : 'MAILBOX_TOKEN_FAILED';
    await fetchRows('office_user_mailboxes?org_id=eq.' + q(orgId) + '&user_email=eq.' + q(email), { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_error: code, updated_at: new Date().toISOString() }) }).catch(() => null);
    throw fail(code, 409);
  }
  tokens.set(k, { token: t.access_token, exp: Date.now() + (Number(t.expires_in) || 3000) * 1000 });
  return t.access_token;
}

// What the person sees: their link, and their messages that need an action (most important first).
export async function myMailView(orgId, account, d = {}) {
  const fetchRows = d.fetchRows || rest, email = me(account);
  const row = await mailboxRow(orgId, email, fetchRows);
  if (!linked(row)) return { linked: false, email, last_error: row?.last_error || null };
  const items = await fetchRows('office_user_mail_items?org_id=eq.' + q(orgId) + '&user_email=eq.' + q(email) +
    '&needs_action=is.true&done=is.null&select=id,thread_id,from_text,from_email,subject,received_at,summary,importance,category,mission_id,suggested_action,deadline&order=received_at.desc&limit=' + LIST) || [];
  items.sort((a, b) => (RANK[a.importance] ?? 3) - (RANK[b.importance] ?? 3) || String(b.received_at).localeCompare(String(a.received_at)));
  return { linked: true, email, google_email: row.google_email, last_triage_at: row.last_triage_at, last_error: row.last_error, items };
}

// « Relire ma boîte »: the recent messages not seen yet are read and understood by the AI.
export async function refreshMyMail(orgId, account, d = {}) {
  const fetchRows = d.fetchRows || rest, fetchImpl = d.fetchImpl || fetch, email = me(account);
  const token = await accessToken(orgId, email, d);
  const list = await gmail('/messages?maxResults=' + MAX + '&q=' + q(QUERY), token, fetchImpl);
  const ids = (list.messages || []).map(m => m.id);
  const known = ids.length ? new Set((await fetchRows('office_user_mail_items?org_id=eq.' + q(orgId) + '&user_email=eq.' + q(email) +
    '&id=in.(' + ids.map(i => '"' + String(i).replace(/[^A-Za-z0-9_-]/g, '') + '"').join(',') + ')&select=id') || []).map(r => r.id)) : new Set();
  const fresh = ids.filter(id => !known.has(id));
  const now = new Date().toISOString();
  const stamp = extra => fetchRows('office_user_mailboxes?org_id=eq.' + q(orgId) + '&user_email=eq.' + q(email), { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_triage_at: now, updated_at: now, ...extra }) });
  if (!fresh.length) { await stamp({ last_error: null }); return { new: 0, needs_action: 0 }; }
  const msgs = [];
  for (const id of fresh) { try { msgs.push(parseMessage(await gmail('/messages/' + q(id) + '?format=full', token, fetchImpl))); } catch { /* skipped, read next time */ } }
  // Only the missions this person may open (owner / partners: all; others: the ones they are staffed on). The AI never
  // hears of another mission, and an e-mail is never linked to a mission the person cannot see.
  const allowed = await (d.accessibleMissionIds || accessibleMissionIds)(orgId, account, fetchRows).catch(() => new Set());
  const missions = allowed !== null && !allowed.size ? [] : ((await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&' + LIVE_FILTER + '&select=id,name,mission_code&limit=300').catch(() => [])) || [])
    .filter(m => allowed === null || allowed.has(m.id));
  let out = [];
  try {
    const r = await (d.ai || firstAvailable)(ORDER, { instructions: TRIAGE, maxTokens: 6000,
      input: 'MISSIONS : ' + JSON.stringify(missions.map(m => ({ id: m.id, name: m.name, code: m.mission_code }))) + '\n\nE-MAILS :\n' + JSON.stringify(msgs.map(m => ({ id: m.id, from: m.from, subject: m.subject, date: m.date, body: m.body || m.snippet }))) });
    out = parseJsonLoose(r.text).items || [];
  } catch (e) {
    // AI out of service: nothing is classified by the code instead; the messages are read again next time.
    await stamp({ last_error: 'AI_UNAVAILABLE' });
    throw fail('AI_UNAVAILABLE: ' + cut(e.message || e, 160), 503);
  }
  const missionIds = new Set(missions.map(m => m.id));
  const rows = msgs.map(m => {
    const a = out.find(x => x.id === m.id) || {};
    return { org_id: orgId, user_email: email, id: m.id, thread_id: m.thread_id, from_text: cut(m.from, 300), from_email: cut(m.from_email, 254), subject: cut(m.subject, 300),
      received_at: m.date && !Number.isNaN(Date.parse(m.date)) ? new Date(m.date).toISOString() : now, snippet: cut(m.snippet, 300),
      needs_action: Boolean(a.needs_action), importance: ['haute', 'moyenne', 'basse'].includes(a.importance) ? a.importance : 'basse', category: cut(a.category || 'autre', 30),
      summary: cut(a.summary || m.snippet, 400), mission_id: missionIds.has(a.mission_id) ? a.mission_id : null, suggested_action: cut(a.suggested_action, 300),
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(a.deadline || '') ? a.deadline : null, triaged_at: now };
  });
  if (rows.length) await fetchRows('office_user_mail_items?on_conflict=org_id,user_email,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  await stamp({ last_error: null });
  return { new: rows.length, needs_action: rows.filter(r => r.needs_action).length };
}

async function myItem(orgId, email, id, fetchRows) {
  const it = (await fetchRows('office_user_mail_items?org_id=eq.' + q(orgId) + '&user_email=eq.' + q(email) + '&id=eq.' + q(String(id || '')) + '&select=*&limit=1'))?.[0];
  if (!it) throw fail('MAIL_NOT_FOUND', 404);
  return it;
}

// The AI drafts; the person corrects. Nothing is sent here.
export async function draftMyReply(orgId, account, id, instruction, d = {}) {
  const fetchRows = d.fetchRows || rest, email = me(account);
  const it = await myItem(orgId, email, id, fetchRows);
  const r = await (d.ai || firstAvailable)(ORDER, { instructions: REPLY, maxTokens: 2000,
    input: 'E-MAIL REÇU de ' + it.from_text + ' — objet « ' + it.subject + ' » :\n' + (it.snippet || '') + '\nRésumé : ' + (it.summary || '') +
      '\n\nCE QUE VEUT RÉPONDRE ' + (account?.display_name || 'la personne') + ' : ' + cut(instruction, 2000) + '\nSignature : ' + (account?.display_name || '') });
  let x = {};
  try { x = parseJsonLoose(r.text); } catch { x = { body: r.text }; }
  return { to: it.from_email, subject: cut(x.subject || ('Re: ' + it.subject), 200), body: cut(x.body || '', 10000) };
}

const oneLine = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const encodeWord = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
// The reply as Gmail expects it: same conversation (threadId + In-Reply-To / References), the person's own address.
export function buildReply({ from, to, subject, body, inReplyTo, references }) {
  const head = ['From: ' + oneLine(from), 'To: ' + oneLine(to), 'Subject: ' + encodeWord(oneLine(subject)), 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  if (inReplyTo) { head.push('In-Reply-To: ' + oneLine(inReplyTo)); head.push('References: ' + oneLine([references, inReplyTo].filter(Boolean).join(' '))); }
  const b64 = Buffer.from(String(body || ''), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(head.join('\r\n') + '\r\n\r\n' + b64, 'utf8').toString('base64url');
}

// « Envoyer »: the person's click is the decision. Sent from their own mailbox, to the sender of the message, in its conversation.
export async function sendMyReply(orgId, account, input, d = {}) {
  const fetchRows = d.fetchRows || rest, fetchImpl = d.fetchImpl || fetch, email = me(account);
  const it = await myItem(orgId, email, input.id, fetchRows);
  const subject = cut(oneLine(input.subject) || ('Re: ' + it.subject), 200), body = cut(input.body, 20000);
  if (!body.trim()) throw fail('EMPTY_REPLY', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(it.from_email || '')) throw fail('SENDER_ADDRESS_UNKNOWN', 409);
  const row = await mailboxRow(orgId, email, fetchRows);
  if (!linked(row) || !(row.scopes || []).includes(SCOPES.gmailSend)) throw fail('MAILBOX_NOT_LINKED', 409);
  const token = await accessToken(orgId, email, d);
  const meta = await gmail('/messages/' + q(it.id) + '?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References', token, fetchImpl).catch(() => ({}));
  const h = n => (meta.payload?.headers || []).find(x => x.name.toLowerCase() === n)?.value || '';
  const raw = buildReply({ from: row.google_email, to: it.from_email, subject, body, inReplyTo: h('message-id'), references: h('references') });
  const r = await fetchImpl(GMAIL + '/messages/send', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, threadId: it.thread_id || undefined }) });
  const sent = await r.json().catch(() => ({}));
  if (!r.ok || !sent.id) throw fail('GMAIL_SEND_' + r.status, 502);
  const now = new Date().toISOString();
  await fetchRows('office_user_mail_items?org_id=eq.' + q(orgId) + '&user_email=eq.' + q(email) + '&id=eq.' + q(it.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ done: { at: now, how: 'répondu', gmail_id: sent.id } }) });
  // Traced without the content (who, when, to whom, Gmail's id): the e-mail itself stays in the person's mailbox.
  await audit(orgId, { action_type: 'PERSONAL_MAIL_SENT', source_ref: 'gmail:' + sent.id, decision: email + ' a répondu à ' + it.from_email, mission_id: it.mission_id || null }, d);
  return { sent: true, gmail_id: sent.id, thread_id: sent.threadId || it.thread_id };
}

export async function markMyMailDone(orgId, account, id, how = 'traité', d = {}) {
  const fetchRows = d.fetchRows || rest, email = me(account);
  await myItem(orgId, email, id, fetchRows);
  await fetchRows('office_user_mail_items?org_id=eq.' + q(orgId) + '&user_email=eq.' + q(email) + '&id=eq.' + q(String(id)), { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ done: { at: new Date().toISOString(), how: cut(how, 60) } }) });
  return { id, done: true };
}

// « Délier »: Google's access is revoked, the token and the items are erased; the trace stays in the audit log.
export async function unlinkMailbox(orgId, account, d = {}) {
  const fetchRows = d.fetchRows || rest, fetchImpl = d.fetchImpl || fetch, env = d.env || process.env, email = me(account);
  const row = await mailboxRow(orgId, email, fetchRows);
  if (row?.refresh_token_enc) {
    try { await fetchImpl('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: decryptToken(row.refresh_token_enc, env) }) }); } catch { /* erased here in any case */ }
  }
  const now = new Date().toISOString();
  if (row) await fetchRows('office_user_mailboxes?org_id=eq.' + q(orgId) + '&user_email=eq.' + q(email), { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ refresh_token_enc: null, scopes: [], revoked_at: now, last_error: null, updated_at: now }) });
  await fetchRows('office_user_mail_items?org_id=eq.' + q(orgId) + '&user_email=eq.' + q(email), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  tokens.delete(keyOf(orgId, email));
  await audit(orgId, { action_type: 'PERSONAL_MAILBOX_UNLINKED', source_ref: 'user:' + email, decision: email + ' a délié sa boîte e-mail' }, d);
  return { linked: false };
}

async function audit(orgId, e, d) {
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'user', status: 'done', ...e }).catch(() => null);
}

export function _resetPersonalMailCache() { tokens.clear(); }
