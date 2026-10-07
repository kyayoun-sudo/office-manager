import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { getPersona, isInternal, domainOf, draftInternalMessage } from './agent-persona.js';
import { isTestMode } from './test-mode.js';

// The agent's e-mails, as decided by Paul (2026-10-07):
//   - it writes to COLLEAGUES (addresses of the firm's domains);
//   - every message waits for a human validation before it leaves.
// Rule updated the same day (Paul): e-mails to CLIENTS are allowed as DRAFTS proposed by the
// agent (formal tone), reviewed — and editable — by an owner / partner / manager in
// "À valider", sent only after that validation and only to the client contact registered on
// the mission (audience 'client', see missionClientContacts).
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
const EMAIL = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]+$/;
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

// ---- Test sandbox (added 2026-10-07 for the "TATY TEST" run in preview) ----
// In a Vercel PREVIEW deployment (or with AGENT_MAIL_SANDBOX=on), mail can only ever go to
// a closed list of Paul's own mailboxes, whatever an agent or a person asks:
//   AGENT_MAIL_SANDBOX_COLLEAGUES  addresses playing the firm's team (count as colleagues)
//   AGENT_MAIL_SANDBOX_CLIENTS     addresses playing clients (e.g. a CFO)
// Any other recipient is refused at the last gate, right before Gmail. A preview with
// no list sends nothing at all. Production (VERCEL_ENV=production) is unchanged.
const listFrom = v => String(v || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => EMAIL.test(x));

export function mailSandbox(env = process.env) {
  // Same definition as the rest of the test mode (never active in production).
  if (!isTestMode(env)) return null;
  const colleagues = listFrom(env.AGENT_MAIL_SANDBOX_COLLEAGUES);
  const clients = listFrom(env.AGENT_MAIL_SANDBOX_CLIENTS);
  return { colleagues, clients, all: new Set([...colleagues, ...clients]) };
}

export function assertSandboxRecipients(recipients, env = process.env) {
  const box = mailSandbox(env);
  if (!box) return;
  if (!box.all.size) throw fail('MAIL_SANDBOX_EMPTY', 409);
  const outside = recipients.filter(e => !box.all.has(String(e).toLowerCase()));
  if (outside.length) throw fail('MAIL_SANDBOX_RECIPIENT_REFUSED', 403, { outside });
}

// A colleague = an address of the firm's domains, or (test mode only) one of Paul's
// addresses listed as playing the team.
export function isColleague(email, persona, env = process.env) {
  if (isInternal(email, persona)) return true;
  const box = mailSandbox(env);
  return Boolean(box && box.colleagues.includes(String(email || '').toLowerCase()));
}

// The rule itself: every recipient (and the sender) must belong to the firm.
// In the test sandbox, Paul's addresses listed as colleagues count as the firm's team.
export function assertColleaguesOnly(recipients, persona, env = process.env) {
  if (!persona?.internal_domains?.length) throw fail('INTERNAL_DOMAINS_NOT_CONFIGURED', 409);
  const box = mailSandbox(env);
  const sandboxColleague = e => Boolean(box && box.colleagues.includes(String(e).toLowerCase()));
  const outside = recipients.filter(e => !isInternal(e, persona) && !sandboxColleague(e));
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
  // Last gate, for every message whatever its path: in the test sandbox, only Paul's addresses.
  assertSandboxRecipients(message.recipients || [], env);
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

// ---- client e-mails (rule of 2026-10-07): draft by the agent, validated by a manager ----
// A client e-mail can ONLY go to the client contact(s) registered on the mission
// (office_missions.client_contact_emails): never to an address typed by an agent.
export async function missionClientContacts(orgId, missionId, fetchRows) {
  if (!missionId) throw fail('MISSION_REQUIRED_FOR_CLIENT_MAIL');
  const m = (await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) + '&select=id,client_contact_emails&limit=1'))?.[0];
  if (!m) throw fail('MISSION_NOT_FOUND', 404);
  return (m.client_contact_emails || []).map(e => String(e).toLowerCase()).filter(e => EMAIL.test(e));
}

export function assertClientRecipients(recipients, contacts) {
  if (!contacts.length) throw fail('CLIENT_CONTACT_NOT_REGISTERED', 409);
  const outside = recipients.filter(e => !contacts.includes(String(e).toLowerCase()));
  if (outside.length) throw fail('RECIPIENT_NOT_CLIENT_CONTACT', 400, { outside });
}

async function checkAudience(orgId, audience, recipients, missionId, persona, fetchRows) {
  if (audience === 'client') assertClientRecipients(recipients, await missionClientContacts(orgId, missionId, fetchRows));
  else assertColleaguesOnly(recipients, persona);
}

// Propose a message. With subject+body it is stored as written; with a topic the agent drafts it.
export async function proposeMessage(orgId, input = {}, account = null, d = {}) {
  const x = deps(d);
  const persona = await x.loadPersona(orgId);
  const recipients = cleanRecipients(input.recipients);
  const audience = input.audience === 'client' ? 'client' : 'colleagues';
  const missionId = input.office_mission_id || null;
  await checkAudience(orgId, audience, recipients, missionId, persona, x.fetchRows);
  if (audience === 'client' && (!String(input.subject || '').trim() || !String(input.body || '').trim())) throw fail('CLIENT_DRAFT_REQUIRES_TEXT');
  let subject = String(input.subject || '').trim(), body = String(input.body || '').trim();
  if (!subject || !body) {
    const drafted = await x.draft(orgId, { topic: input.topic, recipients }, d.draftDeps || {});
    subject = subject || drafted.subject; body = body || drafted.body;
  }
  if (!subject || subject.length > 200) throw fail('INVALID_SUBJECT');
  if (!body || body.length > 10000) throw fail('INVALID_BODY');
  const row = { org_id: orgId, recipients, subject, body, tone: audience === 'client' ? 'formal' : persona.internal_tone, source: input.source === 'agent' ? 'agent' : 'person',
    topic: String(input.topic || '').slice(0, 2000) || null, status: 'pending_approval', requested_by: who(account) || String(input.requested_by || '').slice(0, 120) || null };
  // Column added by db/agent-messages-client.sql: only written for client e-mails, so the
  // colleague messages keep working on a database not yet migrated.
  if (audience === 'client') Object.assign(row, { audience, office_mission_id: missionId });
  row.content_sha256 = contentHash(row);
  const [saved] = await x.fetchRows('office_agent_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) });
  return saved;
}

export async function listMessages(orgId, d = {}) {
  const x = deps(d);
  const rows = await x.fetchRows('office_agent_messages?org_id=eq.' + q(orgId) +
    '&select=*&order=created_at.desc&limit=60') || [];
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
  // The validator approves what they SAW: the screen sends back the fingerprint it displayed.
  if (!input.seen_sha256) throw fail('SEEN_HASH_REQUIRED');
  if (input.seen_sha256 !== current.content_sha256) throw fail('MESSAGE_CHANGED_RELOAD', 409);

  // Edits made by the validator are what gets sent (and what is hashed).
  const message = {
    recipients: input.recipients ? cleanRecipients(input.recipients) : current.recipients,
    subject: String(input.subject ?? current.subject).trim(),
    body: String(input.body ?? current.body).trim()
  };
  if (!message.subject || !message.body) throw fail('INVALID_BODY');
  const persona = await x.loadPersona(orgId);
  const audience = current.audience === 'client' ? 'client' : 'colleagues';
  await checkAudience(orgId, audience, message.recipients, current.office_mission_id, persona, x.fetchRows); // check 2: at approval

  const today = decidedAt.slice(0, 10);
  const sentToday = (await x.fetchRows('office_agent_messages?org_id=eq.' + q(orgId) + '&status=eq.sent&sent_at=gte.' + q(today + 'T00:00:00Z') + '&select=id&limit=' + (MAX_SENT_PER_DAY + 1)) || []).length;
  if (sentToday >= MAX_SENT_PER_DAY) throw fail('DAILY_LIMIT_REACHED', 429);

  const claimed = await patch({ ...message, content_sha256: contentHash(message), status: 'sending', decided_by: who(account),
    decided_at: decidedAt, decision_comment: String(input.comment || '').slice(0, 1000) || null, error: null }, current.status);
  if (!claimed) throw fail('ALREADY_DECIDED', 409);
  let providerId;
  try {
    const fresh = await x.loadPersona(orgId);
    await checkAudience(orgId, audience, message.recipients, current.office_mission_id, fresh, x.fetchRows); // check 3: right before sending
    providerId = await x.send(message, fresh, d.sendDeps || {});
  } catch (e) {
    const code = String(e.message || e);
    // Refused before or by Gmail (known codes): nothing left → "failed", can be validated again.
    // Anything else (network cut, timeout): Gmail MAY have sent it → stays "sending", to check,
    // and can NOT be validated again (no double send).
    const surelyNotSent = /^(MAIL_|GMAIL_SEND_|AGENT_|RECIPIENT_|INTERNAL_DOMAINS|CLIENT_CONTACT_|MISSION_)/.test(code);
    await patch(surelyNotSent ? { status: 'failed', error: code.slice(0, 500) } : { error: ('À VÉRIFIER (envoi peut-être parti) : ' + code).slice(0, 500) });
    throw Object.assign(e, { statusCode: e.statusCode || 502 });
  }
  // Gmail accepted it: from here on it is never "failed" (a write error leaves it "sending").
  const sent = await patch({ status: 'sent', sent_at: x.now().toISOString(), provider_message_id: providerId }).catch(() => null);
  return sent || { id, status: 'sending', provider_message_id: providerId, warning: 'SENT_BUT_NOT_RECORDED' };
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
    .map(u => String(u.email || '').toLowerCase()).filter(e => isColleague(e, persona) && e !== persona.sender_email.toLowerCase());
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
