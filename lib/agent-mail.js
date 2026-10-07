import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { getPersona, isInternal, domainOf, draftInternalMessage } from './agent-persona.js';

// The agent's e-mails, as decided by Paul (2026-10-07):
//   - it writes to COLLEAGUES only (addresses of the firm's domains), NEVER to clients;
//   - every message waits for a human validation before it leaves.
//
// Flow: proposed (by a person, or by the agent itself on its schedule)
//       → pending_approval → [owner / partner / manager] approve → sending → sent
//                                                      or reject → rejected
// The colleague-only rule is checked three times: when proposed, when approved, and
// right before sending (against the CURRENT firm domains). An external address is
// refused, never "trimmed": the message is not sent at all.
//
// Sending: Gmail API with the firm's Google service account, acting as the agent's
// address — or the real mailbox it is an alias of (AGENT_MAIL_MAILBOX) — (domain-wide
// delegation, scope gmail.send — set once by the Workspace super admin). Without it, messages stay validated-but-not-sent and say why.

const q = v => encodeURIComponent(v);
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const VALIDATORS = new Set(['owner', 'partner', 'manager']);
const MAX_RECIPIENTS = 30;
const MAX_SENT_PER_DAY = 100;

export function contentHash(m) {
  return crypto.createHash('sha256').update(JSON.stringify([m.recipients, m.subject, m.body])).digest('hex');
}

export function cleanRecipients(list) {
  const raw = Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/);
  const out = [...new Set(raw.map(x => String(x).trim().toLowerCase()).filter(Boolean))];
  if (!out.length) throw fail('RECIPIENTS_REQUIRED');
  if (out.length > MAX_RECIPIENTS) throw fail('TOO_MANY_RECIPIENTS');
  const invalid = out.filter(e => !EMAIL.test(e));
  if (invalid.length) throw fail('INVALID_RECIPIENTS', 400, { outside: invalid });
  return out;
}

// The rule itself: every recipient (and the sender) must belong to the firm.
export function assertColleaguesOnly(recipients, persona) {
  if (!persona?.internal_domains?.length) throw fail('INTERNAL_DOMAINS_NOT_CONFIGURED', 409);
  const outside = recipients.filter(e => !isInternal(e, persona));
  if (outside.length) throw fail('RECIPIENT_OUTSIDE_FIRM', 400, { outside });
  if (!persona.sender_email || !isInternal(persona.sender_email, persona)) throw fail('AGENT_SENDER_NOT_CONFIGURED', 409);
}

// ---- MIME + Gmail ----

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const encodeHeader = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64(s) + '?=';
const oneLine = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();

export function buildMime({ fromName, from, to, subject, body, replyTo }) {
  const lines = [
    'From: ' + (fromName ? encodeHeader(oneLine(fromName)) + ' ' : '') + '<' + oneLine(from) + '>',
    'To: ' + to.map(oneLine).join(', '),
    ...(replyTo ? ['Reply-To: ' + oneLine(replyTo)] : []),
    'Subject: ' + encodeHeader(oneLine(subject)),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'X-Office-Manager: internal-validated',
    '',
    b64(String(body || '')).replace(/.{76}/g, '$&\r\n')
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

function serviceAccount(env) {
  const raw = env.AGENT_MAIL_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function mailConfigured(env = process.env) {
  return Boolean(serviceAccount(env));
}

export const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_READ = 'https://www.googleapis.com/auth/gmail.readonly';

export async function gmailToken(sender, env, fetchImpl, scope = GMAIL_SEND) {
  const account = serviceAccount(env);
  if (!account) throw fail('MAIL_NOT_CONFIGURED', 409);
  const now = Math.floor(Date.now() / 1000);
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: account.client_email, sub: sender, scope,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600
  });
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(String(account.private_key || '').replace(/\\n/g, '\n')).toString('base64url');
  const r = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature })
  });
  const data = await r.json().catch(() => ({}));
  // unauthorized_client = the delegation (gmail.send for the agent address) is not set yet.
  if (!r.ok) throw fail(data.error === 'unauthorized_client' ? 'MAIL_DELEGATION_MISSING' : 'MAIL_AUTH_FAILED', 409);
  return data.access_token;
}

// The mailbox Google signs in as. Usually the agent's own address; when the agent's address
// is an ALIAS of a person's mailbox (no extra licence), AGENT_MAIL_MAILBOX names that real
// mailbox: the app signs in as it and writes "From: <alias>". It must be in the firm's domains.
export function sendingMailbox(persona, env = process.env) {
  const box = String(env.AGENT_MAIL_MAILBOX || '').trim().toLowerCase();
  if (!box) return persona.sender_email;
  if (!EMAIL.test(box) || !isInternal(box, persona)) throw fail('AGENT_MAILBOX_OUTSIDE_FIRM', 409);
  return box;
}

export async function sendViaGmail(message, persona, { env = process.env, fetchImpl = fetch } = {}) {
  const token = await gmailToken(sendingMailbox(persona, env), env, fetchImpl);
  const raw = buildMime({ fromName: persona.agent_display_name, from: persona.sender_email, to: message.recipients,
    subject: message.subject, body: message.body, replyTo: persona.reply_to || null });
  const r = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw fail('GMAIL_SEND_' + r.status, 502);
  return data.id || null;
}

// ---- workflow ----

function deps(d = {}) {
  return {
    fetchRows: d.fetchRows || rest,
    loadPersona: d.getPersona || (id => getPersona(id)),
    draft: d.draftInternalMessage || draftInternalMessage,
    send: d.send || sendViaGmail,
    now: d.now || (() => new Date())
  };
}

const who = account => account?.display_name || account?.email || null;

// Propose a message. With subject+body it is stored as written; with a topic the agent drafts it.
export async function proposeMessage(orgId, input = {}, account = null, d = {}) {
  const x = deps(d);
  const persona = await x.loadPersona(orgId);
  const recipients = cleanRecipients(input.recipients);
  assertColleaguesOnly(recipients, persona);
  let subject = String(input.subject || '').trim(), body = String(input.body || '').trim();
  if (!subject || !body) {
    const drafted = await x.draft(orgId, { topic: input.topic, recipients }, d.draftDeps || {});
    subject = subject || drafted.subject; body = body || drafted.body;
  }
  if (!subject || subject.length > 200) throw fail('INVALID_SUBJECT');
  if (!body || body.length > 10000) throw fail('INVALID_BODY');
  const row = { org_id: orgId, recipients, subject, body, tone: persona.internal_tone, source: input.source === 'agent' ? 'agent' : 'person',
    topic: String(input.topic || '').slice(0, 2000) || null, status: 'pending_approval', requested_by: who(account) || String(input.requested_by || '').slice(0, 120) || null };
  row.content_sha256 = contentHash(row);
  const [saved] = await x.fetchRows('office_agent_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) });
  return saved;
}

export async function listMessages(orgId, d = {}) {
  const x = deps(d);
  const rows = await x.fetchRows('office_agent_messages?org_id=eq.' + q(orgId) +
    '&select=id,recipients,subject,body,tone,source,topic,status,requested_by,decided_by,decided_at,decision_comment,sent_at,error,created_at&order=created_at.desc&limit=60') || [];
  const persona = await x.loadPersona(orgId).catch(() => null);
  return { messages: rows, pending: rows.filter(r => r.status === 'pending_approval').length,
    sender: persona?.sender_email || null, mail_configured: mailConfigured(d.env || process.env) };
}

// Approve (optionally with edits) and send, or reject. Validators only.
export async function decideMessage(orgId, input = {}, account = null, d = {}) {
  const x = deps(d);
  if (!account || !VALIDATORS.has(account.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const id = String(input.id || '');
  const current = (await x.fetchRows('office_agent_messages?org_id=eq.' + q(orgId) + '&id=eq.' + q(id) + '&select=*&limit=1'))?.[0];
  if (!current) throw fail('MESSAGE_NOT_FOUND', 404);
  const decidedAt = x.now().toISOString();
  const patch = (fields, onlyIf) => x.fetchRows('office_agent_messages?org_id=eq.' + q(orgId) + '&id=eq.' + q(id) + (onlyIf ? '&status=eq.' + q(onlyIf) : ''), {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...fields, updated_at: decidedAt })
  }).then(r => r?.[0] || null);

  if (input.decision === 'reject') {
    if (current.status !== 'pending_approval' && current.status !== 'failed') throw fail('NOT_PENDING', 409);
    const comment = String(input.comment || '').trim();
    if (comment.length < 3) throw fail('COMMENT_REQUIRED');
    return patch({ status: 'rejected', decided_by: who(account), decided_at: decidedAt, decision_comment: comment.slice(0, 1000) }, current.status);
  }
  if (input.decision !== 'approve') throw fail('INVALID_DECISION');
  if (!['pending_approval', 'failed'].includes(current.status)) throw fail('NOT_PENDING', 409);

  // Edits made by the validator are what gets sent (and what is hashed).
  const message = {
    recipients: input.recipients ? cleanRecipients(input.recipients) : current.recipients,
    subject: String(input.subject ?? current.subject).trim(),
    body: String(input.body ?? current.body).trim()
  };
  if (!message.subject || !message.body) throw fail('INVALID_BODY');
  const persona = await x.loadPersona(orgId);
  assertColleaguesOnly(message.recipients, persona); // check 2: at approval

  const today = decidedAt.slice(0, 10);
  const sentToday = (await x.fetchRows('office_agent_messages?org_id=eq.' + q(orgId) + '&status=eq.sent&sent_at=gte.' + q(today + 'T00:00:00Z') + '&select=id&limit=' + (MAX_SENT_PER_DAY + 1)) || []).length;
  if (sentToday >= MAX_SENT_PER_DAY) throw fail('DAILY_LIMIT_REACHED', 429);

  const claimed = await patch({ ...message, content_sha256: contentHash(message), status: 'sending', decided_by: who(account),
    decided_at: decidedAt, decision_comment: String(input.comment || '').slice(0, 1000) || null, error: null }, current.status);
  if (!claimed) throw fail('ALREADY_DECIDED', 409);
  try {
    const fresh = await x.loadPersona(orgId);
    assertColleaguesOnly(message.recipients, fresh); // check 3: right before sending
    const providerId = await x.send(message, fresh, d.sendDeps || {});
    return await patch({ status: 'sent', sent_at: x.now().toISOString(), provider_message_id: providerId });
  } catch (e) {
    await patch({ status: 'failed', error: String(e.message || e).slice(0, 500) });
    throw Object.assign(e, { statusCode: e.statusCode || 502 });
  }
}

// ---- spontaneous team messages (agent's own initiative, still validated) ----

const FREQUENCY_DAYS = { daily: [1, 2, 3, 4, 5], few_per_week: [1, 3, 5], weekly: [1] };

export function messageDue(frequency, local, lastProposedAt, now) {
  const days = FREQUENCY_DAYS[frequency];
  if (!days || !days.includes(local.weekday) || local.minutes < 9 * 60) return false;
  return !lastProposedAt || now - Date.parse(lastProposedAt) > 20 * 3600 * 1000;
}

// Called by the scheduler tick. Proposes (never sends) one team message when due.
export async function proposeTeamMessage(orgId, local, d = {}) {
  const x = deps(d);
  const persona = await x.loadPersona(orgId);
  if (!persona.sender_email || !persona.internal_domains?.length || persona.internal_frequency === 'off') return { proposed: false, reason: 'not_configured' };
  const last = (await x.fetchRows('office_agent_messages?org_id=eq.' + q(orgId) + '&source=eq.agent&select=created_at&order=created_at.desc&limit=1'))?.[0]?.created_at;
  if (!messageDue(persona.internal_frequency, local, last, x.now().getTime())) return { proposed: false, reason: 'not_due' };
  const team = (await x.fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&active=eq.true&select=email&limit=200') || [])
    .map(u => String(u.email || '').toLowerCase()).filter(e => isInternal(e, persona) && e !== persona.sender_email.toLowerCase());
  if (!team.length) return { proposed: false, reason: 'no_colleagues' };
  let context = '';
  try {
    context = (await x.fetchRows('office_agent_runs?org_id=eq.' + q(orgId) + '&agent_key=eq.grand-controleur&status=eq.verified&select=summary&order=started_at.desc&limit=1'))?.[0]?.summary || '';
  } catch { context = ''; }
  const topic = 'Petit mot du jour à l’équipe : les priorités et une touche d’humour. ' +
    (context ? 'Appuie-toi sur le dernier point du Grand Contrôleur (sans données de clients sensibles) : ' + context.slice(0, 1200) : 'Encourage l’équipe et rappelle de mettre à jour les missions.');
  const saved = await proposeMessage(orgId, { recipients: team, topic, source: 'agent', requested_by: 'Agent (initiative)' }, null, d);
  return { proposed: true, id: saved?.id };
}

export { domainOf };
