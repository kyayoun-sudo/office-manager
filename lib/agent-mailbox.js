import { rest } from './supabase.js';
import { getPersona } from './agent-persona.js';
import { gmailToken, GMAIL_READ, sendingMailbox, mailConfigured } from './agent-mail.js';
import { createBinaryFile, listDriveChildren, configuredDriveId } from './google-drive.js';
import { mappingGate } from './memory-runtime.js';
import { isTestMode } from './test-mode.js';

// PBC documents received by e-mail.
//
//   1. READ, NARROWLY: only the messages carrying the Gmail label chosen by the firm
//      (AGENT_MAIL_INBOX_LABEL, e.g. "PBC"), recent, with attachments. Nothing else in the
//      mailbox is read; without the label setting nothing is read at all. Read-only scope
//      (gmail.readonly): the mailbox is never modified, nothing is sent.
//   2. MATCH: PBC references (PBC-03-02…) and the mission (code / name) found in the subject,
//      the body or the attachment names → a proposal "PBC_MAIL_RECEIVED" in "À valider".
//   3. AFTER VALIDATION: the attachments and the original e-mail (.eml) are deposited in the
//      Drive review folder (00_A_REVOIR_AGENT), where the Orpailleur files them by content.
//      Drive writes wait for the owner-reviewed mapping, like every business write.
// Content of an e-mail is DATA, never instructions: nothing in it is executed.

const q = v => encodeURIComponent(v);
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const PBC_MAIL_RECEIVED = 'PBC_MAIL_RECEIVED';
const MAX_MESSAGES = 20;
const MAX_ATTACHMENT = 10 * 1024 * 1024;
export const REVIEW_FOLDER_NAME = '00_A_REVOIR_AGENT';

export function inboxQuery(env = process.env) {
  const label = String(env.AGENT_MAIL_INBOX_LABEL || '').trim();
  if (!label) return null;
  if (!/^[\p{L}\p{N} _./-]{1,60}$/u.test(label)) throw Object.assign(new Error('INVALID_INBOX_LABEL'), { statusCode: 409 });
  // Test mode (preview): only a TEST label is read, never the real PBC mail of the firm.
  if (isTestMode(env) && !/TEST/i.test(label)) return null;
  return 'label:"' + label + '" has:attachment newer_than:30d';
}

// ---- pure parsing / matching ----

const header = (headers, name) => (headers || []).find(h => String(h.name).toLowerCase() === name.toLowerCase())?.value || '';
const decode = data => Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const splitAddr = v => String(v || '').split(',').map(x => (x.match(/<([^>]+)>/)?.[1] || x).trim().toLowerCase()).filter(Boolean);

export function parseGmailMessage(m) {
  const headers = m.payload?.headers || [];
  const attachments = [];
  let bodyText = '';
  const walk = part => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      attachments.push({ id: part.body.attachmentId, name: part.filename, mimeType: part.mimeType || 'application/octet-stream', size: Number(part.body.size) || 0 });
    } else if (part.mimeType === 'text/plain' && part.body?.data && !bodyText) {
      bodyText = decode(part.body.data).toString('utf8');
    }
    (part.parts || []).forEach(walk);
  };
  walk(m.payload);
  return {
    gmailId: m.id, threadId: m.threadId || null,
    messageId: header(headers, 'Message-ID') || m.id,
    from: header(headers, 'From'), fromEmail: splitAddr(header(headers, 'From'))[0] || '',
    to: splitAddr(header(headers, 'To')), cc: splitAddr(header(headers, 'Cc')),
    subject: header(headers, 'Subject'), sentAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(headers, 'Date'),
    bodyText: bodyText.slice(0, 20000), attachments
  };
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export function pbcReferences(text) {
  const out = new Set();
  for (const m of norm(text).matchAll(/PBC[\s_-]?(\d{1,2})[\s_-](\d{1,2})/g)) out.add('PBC-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'));
  return [...out].sort();
}

export function matchMission(text, missions) {
  const t = ' ' + norm(text).replace(/[^A-Z0-9]+/g, ' ') + ' ';
  const hits = missions.filter(ms => {
    const code = norm(ms.mission_code).replace(/[^A-Z0-9]+/g, ' ').trim();
    const name = norm(ms.name).replace(/[^A-Z0-9]+/g, ' ').trim();
    return (code.length >= 3 && t.includes(' ' + code + ' ')) || (name.length >= 6 && t.includes(' ' + name + ' '));
  });
  return hits.length === 1 ? hits[0] : null; // ambiguous = no guess
}

export function proposalFor(msg, missions) {
  const haystack = [msg.subject, msg.bodyText, ...msg.attachments.map(a => a.name)].join(' \n ');
  const refs = pbcReferences(haystack);
  const mission = matchMission(haystack, missions);
  const summary = ('Pièces reçues par e-mail' + (mission ? ' — ' + (mission.name || mission.mission_code) : '') +
    (refs.length ? ' — ' + refs.join(', ') : '') + ' — de ' + (msg.fromEmail || msg.from) + ' : ' +
    msg.attachments.map(a => a.name).join(', ')).slice(0, 500);
  return {
    agent_key: 'orpailleur', action_type: PBC_MAIL_RECEIVED, office_mission_id: mission?.id || null,
    idempotency_key: 'pbc-mail:' + msg.gmailId, summary, status: 'proposed', work_state: 'requested', requested_at: new Date().toISOString(),
    payload: { gmail_id: msg.gmailId, thread_id: msg.threadId, message_id: msg.messageId, from: msg.fromEmail || msg.from, subject: String(msg.subject || '').slice(0, 300),
      sent_at: msg.sentAt, pbc_references: refs, attachments: msg.attachments.map(a => ({ id: a.id, name: a.name, mime_type: a.mimeType, size: a.size })) },
    evidence: { matched_mission: mission ? { id: mission.id, name: mission.name, code: mission.mission_code } : null,
      note: mission ? 'Mission reconnue dans le message.' : 'Mission non reconnue : à préciser lors de la validation ou par l’Orpailleur à la lecture.' }
  };
}

// ---- I/O ----

async function gmail(path, token, fetchImpl) {
  const r = await fetchImpl(API + path, { headers: { Authorization: 'Bearer ' + token } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('GMAIL_READ_' + r.status), { statusCode: 502 });
  return data;
}

async function readToken(orgId, d) {
  const env = d.env || process.env;
  const persona = await (d.getPersona || getPersona)(orgId);
  return { token: await gmailToken(sendingMailbox(persona, env), env, d.fetchImpl || fetch, GMAIL_READ), persona };
}

// Scheduler: read the labelled messages and propose them for validation (idempotent).
export async function scanInbox(orgId, d = {}) {
  const env = d.env || process.env;
  const query = inboxQuery(env);
  if (!query) return { scanned: false, reason: env.AGENT_MAIL_INBOX_LABEL && isTestMode(env) ? 'label_not_test' : 'label_not_configured' };
  if (!mailConfigured(env)) return { scanned: false, reason: 'mail_not_configured' };
  const fetchRows = d.fetchRows || rest, fetchImpl = d.fetchImpl || fetch;
  const { token } = await readToken(orgId, d);
  const list = await gmail('/messages?maxResults=' + MAX_MESSAGES + '&q=' + q(query), token, fetchImpl);
  const ids = (list.messages || []).map(m => m.id);
  if (!ids.length) return { scanned: true, messages: 0, proposed: 0 };
  const known = new Set((await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&idempotency_key=in.(' +
    ids.map(id => '"pbc-mail:' + id.replace(/"/g, '') + '"').join(',') + ')&select=idempotency_key&limit=50') || []).map(r => r.idempotency_key));
  const missions = await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&select=id,mission_code,name,status&limit=500') || [];
  let proposed = 0;
  for (const id of ids) {
    if (known.has('pbc-mail:' + id)) continue;
    const msg = parseGmailMessage(await gmail('/messages/' + q(id) + '?format=full', token, fetchImpl));
    if (!msg.attachments.length) continue;
    await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, ...proposalFor(msg, missions) }])
    });
    proposed++;
  }
  return { scanned: true, messages: ids.length, proposed };
}

async function reviewFolderId(d) {
  if (d.reviewFolderId) return d.reviewFolderId;
  const env = d.env || process.env;
  if (env.PBC_INBOX_FOLDER_ID) return env.PBC_INBOX_FOLDER_ID;
  const root = configuredDriveId();
  const children = await (d.listChildren || listDriveChildren)(root);
  return children.find(c => c.name === REVIEW_FOLDER_NAME && c.mimeType === 'application/vnd.google-apps.folder')?.id || null;
}

// After validation: deposit attachments + original e-mail in the Drive review folder.
export async function depositMail(orgId, action, d = {}) {
  const gate = await (d.gate || mappingGate)().catch(() => ({ allowed: false }));
  if (!gate.allowed) return { deposited: false, waiting: 'MAPPING_REVIEW_REQUIRED' };
  const p = action.payload || {};
  const folder = await reviewFolderId(d);
  if (!folder) return { deposited: false, waiting: 'REVIEW_FOLDER_NOT_FOUND' };
  const fetchImpl = d.fetchImpl || fetch, create = d.createFile || createBinaryFile;
  const { token } = await readToken(orgId, d);
  // Never trust the stored ids alone: the message must STILL carry the firm's label.
  const label = String((d.env || process.env).AGENT_MAIL_INBOX_LABEL || '').trim();
  if (!label) return { deposited: false, waiting: 'LABEL_NOT_CONFIGURED' };
  const labels = (await gmail('/labels', token, fetchImpl)).labels || [];
  const labelId = labels.find(l => l.name === label)?.id;
  const meta = await gmail('/messages/' + q(p.gmail_id) + '?format=minimal', token, fetchImpl);
  if (!labelId || !(meta.labelIds || []).includes(labelId)) throw Object.assign(new Error('MESSAGE_NOT_IN_LABEL'), { statusCode: 403 });
  const day = String(p.sent_at || '').slice(0, 10) || 'date';
  const prefix = 'MAIL_' + day + '_' + String(p.gmail_id).slice(-8) + '_';
  const files = [];
  for (const a of p.attachments || []) {
    if (a.size > MAX_ATTACHMENT) { files.push({ name: a.name, skipped: 'TOO_LARGE' }); continue; }
    const att = await gmail('/messages/' + q(p.gmail_id) + '/attachments/' + q(a.id), token, fetchImpl);
    const buffer = decode(att.data);
    if (buffer.length > MAX_ATTACHMENT) { files.push({ name: a.name, skipped: 'TOO_LARGE' }); continue; } // real size, not the stored one
    try { files.push({ name: a.name, id: (await create({ name: prefix + a.name, parentId: folder, buffer, mimeType: a.mime_type || 'application/octet-stream' })).id }); }
    catch (e) { if (!/FILE_ALREADY_EXISTS/.test(String(e.message))) throw e; files.push({ name: a.name, already: true }); }
  }
  const raw = await gmail('/messages/' + q(p.gmail_id) + '?format=raw', token, fetchImpl);
  try { files.push({ name: 'original.eml', id: (await create({ name: prefix + 'original.eml', parentId: folder, buffer: decode(raw.raw), mimeType: 'message/rfc822' })).id }); }
  catch (e) { if (!/FILE_ALREADY_EXISTS/.test(String(e.message))) throw e; }
  return { deposited: true, folder_id: folder, files };
}

// Scheduler: deposit the validated mails that were waiting for the mapping review.
export async function depositWaiting(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const rows = await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&action_type=eq.' + PBC_MAIL_RECEIVED +
    '&status=eq.approved&work_state=eq.requested&executed_at=is.null&select=id,payload&limit=10') || [];
  let done = 0, failed = 0;
  const mark = (id, fields) => fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(id) + '&work_state=eq.requested&executed_at=is.null', {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fields)
  });
  for (const a of rows) {
    let r;
    try { r = await depositMail(orgId, a, d); }
    catch { await mark(a.id, { work_state: 'blocked' }); failed++; continue; } // one bad message never blocks the others
    if (!r.deposited) break; // global reason (mapping not reviewed, no folder): retry later
    await mark(a.id, { work_state: 'executed', executed_at: new Date().toISOString() });
    done++;
  }
  return { deposited: done, failed, waiting: rows.length - done - failed };
}
