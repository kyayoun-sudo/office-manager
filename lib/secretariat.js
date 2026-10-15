import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { updateJsonFile } from './mapping-scan.js';
import { templatesState, TEMPLATES_FILE, KINDS } from './doc-templates.js';
import { gmailToken, GMAIL_READ } from './agent-mail.js';
import { emit } from './event-bus.js';
import { audit } from './audit-log.js';
import { commercialState } from './opportunity-workflow.js';

// THE SECRETARIAT (Paul, 2026-10-12: « elle envoie les MI, les lettres de mission, les rapports ; du mail du secrétariat, ou
// sur la plateforme dédiée et elle reçoit un mail ; il faut que le Firm Manager et/ou le Mission Controller sachent leur
// date d'envoi : ça peut nous aider au cas où elle a envoyé avant ou après la date limite »).
// A prepared document (lib/doc-templates.js) goes: to complete → reviewed / approved by the right person (a partner for an
// engagement letter or a report; a partner, manager or BDM for an MI) → SENT. « Envoyé » needs a proof: the message found
// in the secretariat mailbox (its id and its real date), or the platform's receipt / the confirmation e-mail filed with
// the document. Without proof it stays « déclaré envoyé » (never « envoyé »). The date is compared with the deadline;
// the opportunity (Firm Manager), the tender watch and the mission (Mission Controller) get it.

const q = encodeURIComponent;
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const cut = (s, n) => s == null || s === '' ? null : String(s).slice(0, n);
export const SENDERS = ['secretary', 'owner', 'partner', 'manager'];
export const mayRecordSending = (account, doc) => SENDERS.includes(account?.role) && (account.role !== 'manager' || doc.kind === 'lettre_mission');
export const APPROVERS = { mi: ['owner', 'partner', 'manager', 'bdm'], proposition: ['owner', 'partner', 'manager', 'bdm'], lettre_mission: ['owner', 'partner'], rapport: ['owner', 'partner'], cv: ['owner', 'partner', 'manager', 'bdm'], autre: ['owner', 'partner', 'manager'] };
export const CHANNELS = { email_secretariat: 'Mail du secrétariat', plateforme: 'Plateforme du bailleur / du client', main_propre: 'Remis en main propre', autre: 'Autre' };
const MAX_BYTES = 3 * 1024 * 1024;

async function changeDoc(id, fn, d) {
  let out = null;
  await updateJsonFile(TEMPLATES_FILE, s => { const x = (s?.documents || []).find(y => y.id === id); if (!x) throw fail('DOCUMENT_NOT_FOUND', 404); out = fn(x); return s; }, { drive: d.drive || driveAdapter, folder: d.folder });
  return out;
}

// On time? The date limit is a day: sent on that day (or before) is on time.
export function onTime(sentAt, deadline) {
  if (!deadline || !sentAt) return null;
  return String(sentAt).slice(0, 10) <= String(deadline).slice(0, 10);
}

export async function secretariatView(orgId, account, d = {}) {
  const st = await templatesState(d);
  const requests = ['owner', 'partner', 'manager', 'supervisor', 'bdm', 'secretary'].includes(account?.role)
    ? (await (d.documentRequests || (await import('./file-index.js')).documentRequests)(orgId, d).catch(() => [])).filter(r => !r.mission_id) : [];
  const references = ['owner', 'partner', 'manager', 'supervisor', 'bdm', 'secretary'].includes(account?.role)
    ? (await (await import('./file-index.js')).documentReferences(orgId, d).catch(() => [])).filter(r => !r.mission_id) : [];
  const docs = (st.documents || []).slice().reverse().map(doc => ({ ...doc, may_send: mayRecordSending(account, doc) }));
  // MI to prepare: opportunities the firm decided to pursue, with a deadline, without a sent MI.
  let opps = [];
  try {
    const { listOpportunities } = await import('./opportunities.js');
    opps = (await (d.listOpportunities || listOpportunities)(orgId, d)).opportunities || [];
  } catch { opps = []; }
  const sentFor = new Set(docs.filter(x => x.status === 'sent' && x.target?.kind === 'opportunity').map(x => x.target.id + ':' + x.kind));
  const todo = opps.filter(o => ['go', 'phase0', 'phase1', 'won'].includes(o.status) && o.commercial?.stage !== 'lost').map(o => {
    const c = o.commercial?.stage ? o.commercial : commercialState(o);
    return { opportunity_id: o.id, mission_id: o.mission_id || null, title: o.title, client: o.client, deadline: o.deadline, next_action: c.label, document_kind: c.document_kind, href: c.href,
    days_left: o.deadline ? Math.ceil((Date.parse(o.deadline + 'T23:59:59Z') - Date.now()) / 86400000) : null }; });
  const queue = todo.filter(o => !o.document_kind ? !['mi_waiting', 'proposal_waiting', 'lost'].includes(opps.find(x => x.id === o.opportunity_id)?.commercial?.stage) : !sentFor.has(o.opportunity_id + ':' + o.document_kind))
    .sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
  return { kinds: KINDS, channels: CHANNELS, templates: (st.templates || []).filter(t => t.active), references, requests, documents: docs.slice(0, 200), mi_to_prepare: queue, document_queue: queue,
    me: { may_send: SENDERS.includes(account?.role), role: account?.role || null } };
}

// The right person reviews / approves the prepared document (never the one who prepared it, for a letter or a report).
export async function approveDocument(orgId, body, account, d = {}) {
  const st = await templatesState(d);
  const doc = (st.documents || []).find(x => x.id === body.document_id); if (!doc) throw fail('DOCUMENT_NOT_FOUND', 404);
  if (!(APPROVERS[doc.kind] || APPROVERS.autre).includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  if (['lettre_mission', 'rapport'].includes(doc.kind) && String(doc.by || '').toLowerCase() === String(account.email || '').toLowerCase()) throw fail('NO_SELF_APPROVAL', 403);
  if ((doc.missing || []).length && !body.completed) throw fail('FIELDS_TO_COMPLETE', 409, { missing: doc.missing });
  const at = new Date().toISOString();
  const r = await changeDoc(doc.id, x => { if (['sent', 'declared'].includes(x.status)) throw fail('ALREADY_SENT', 409); x.status = 'approved'; x.approved_by = account.email; x.approved_at = at; x.completed_in_word = Boolean(body.completed); return x; }, d);
  await (d.audit || audit)(orgId, { agent: 'firm-manager', action_type: 'DOCUMENT_APPROVED', approved_by: account.email, approved_at: at, output_ref: `${KINDS[doc.kind]} : ${doc.word?.name}` }).catch(() => null);
  return { document: r };
}

// The message sent from the secretariat mailbox (read-only search): its id and real date are the proof.
export async function findSentMessage(mailbox, fileNames, d = {}) {
  const fetchImpl = d.fetchImpl || fetch;
  const token = await (d.gmailToken || gmailToken)(mailbox, d.env || process.env, fetchImpl, GMAIL_READ);
  for (const name of fileNames.filter(Boolean)) {
    const query = `in:sent filename:"${String(name).replace(/"/g, '')}" newer_than:60d`;
    const r = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=3&q=' + q(query), { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw fail('GMAIL_READ_' + r.status, 409);
    const list = (await r.json()).messages || [];
    if (!list.length) continue;
    const m = await (await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + q(list[0].id) + '?format=metadata&metadataHeaders=To&metadataHeaders=Subject', { headers: { Authorization: 'Bearer ' + token } })).json();
    const h = Object.fromEntries((m.payload?.headers || []).map(x => [x.name.toLowerCase(), x.value]));
    return { message_id: m.id, thread_id: m.threadId, sent_at: new Date(Number(m.internalDate)).toISOString(), to: cut(h.to, 300), subject: cut(h.subject, 200), file: name };
  }
  return null;
}

async function secretariatMailbox(orgId, d) {
  const rows = await (d.fetchRows || rest)('office_firm_settings?org_id=eq.' + q(orgId) + '&select=settings&limit=1').catch(() => null);
  return cut(rows?.[0]?.settings?.secretariat_email, 200);
}

// The sending, recorded with its proof; the opportunity / tender / mission are told.
export async function recordSending(orgId, body, account, d = {}) {
  if (!SENDERS.includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const drive = d.drive || driveAdapter;
  const st = await templatesState(d);
  const doc = (st.documents || []).find(x => x.id === body.document_id); if (!doc) throw fail('DOCUMENT_NOT_FOUND', 404);
  if (!mayRecordSending(account, doc)) throw fail('ROLE_NOT_ALLOWED', 403);
  if (!['approved', 'declared'].includes(doc.status)) throw fail('APPROVAL_FIRST', 409);
  const channel = CHANNELS[body.channel] ? body.channel : null; if (!channel) throw fail('CHANNEL_REQUIRED');
  let proof = null, sentAt = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(String(body.sent_at || '')) ? new Date(String(body.sent_at).length === 10 ? body.sent_at + 'T12:00:00Z' : body.sent_at).toISOString() : null;
  if (channel === 'email_secretariat') {
    const box = await (d.mailbox || (() => secretariatMailbox(orgId, d)))();
    if (box) {
      const found = await findSentMessage(box, [doc.package?.name, doc.pdf?.name, doc.word?.name], d).catch(e => ({ error: e.message }));
      if (found?.message_id) { proof = { kind: 'gmail', mailbox: box, ...found }; sentAt = found.sent_at; }
      else if (found?.error) proof = null;
    }
  }
  if (!proof && body.base64) {
    // The platform's receipt or the confirmation e-mail, filed next to the document.
    const buffer = Buffer.from(String(body.base64), 'base64');
    if (!buffer.length) throw fail('FILE_EMPTY'); if (buffer.length > MAX_BYTES) throw fail('FILE_TOO_LARGE');
    const folder = (await drive.getMeta(doc.word.id)).parents?.[0];
    const name = `PREUVE_ENVOI_${doc.word.name.replace(/\.docx$/i, '')}_${String(body.name || 'accuse').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}`;
    const f = await drive.createBinary({ name, parentId: folder, buffer, mimeType: cut(body.mime, 120) || 'application/pdf' });
    proof = { kind: 'receipt', file_id: f.id, name };
  }
  if (!proof && body.link) proof = { kind: 'link', url: cut(body.link, 500) };
  if (!sentAt) sentAt = new Date().toISOString();
  const deadline = doc.target?.deadline || null;
  const ok = onTime(sentAt, deadline);
  // « Envoyé » only with a proof (principle: SENT exists only if the action really happened and was checked).
  const status = proof && proof.kind !== 'link' ? 'sent' : 'declared';
  const sending = { kind: doc.kind, document_id: doc.id, channel, sent_at: sentAt, deadline, on_time: ok, proof, recipients: cut(body.recipients, 300), platform: cut(body.platform, 200), by: account.email, recorded_at: new Date().toISOString(), status, document: doc.word?.name };
  const saved = await changeDoc(doc.id, x => { x.status = status; x.sending = sending; return x; }, d);
  if (doc.target?.kind === 'opportunity') {
    const o = await (d.recordOpportunitySending || (async (...a) => (await import('./opportunities.js')).recordOpportunitySending(...a)))(doc.target.id, sending, d).catch(() => null);
    if (status === 'sent' && o?.tender_id && ['mi', 'proposition'].includes(doc.kind)) await (d.submittedBySecretariat || (async (...a) => (await import('./tender-watch.js')).submittedBySecretariat(...a)))(o.tender_id, { at: sentAt, proof: proof?.kind || null, on_time: ok }, d).catch(() => null);
  }
  await (d.emit || emit)(orgId, { type: status === 'sent' ? 'DOCUMENT_SENT' : 'DOCUMENT_SENT_DECLARED', agent: 'secretariat', actor: account.email, engagement_id: doc.target?.kind === 'mission' ? doc.target.id : null, object_type: 'document', object_id: doc.id,
    consumer: doc.target?.kind === 'mission' ? 'mission-controller' : 'firm-manager', idempotency_key: (status === 'sent' ? 'DOCUMENT_SENT:' : 'DOCUMENT_SENT_DECLARED:') + doc.id, source: proof?.message_id ? 'gmail:' + proof.message_id : proof?.file_id ? 'drive:' + proof.file_id : 'declared',
    payload: { kind: doc.kind, sent_at: sentAt, deadline, on_time: ok, status, target: doc.target?.kind + ':' + doc.target?.id } }).catch(() => null);
  await (d.audit || audit)(orgId, { agent: 'secretariat', mission_id: doc.target?.kind === 'mission' ? doc.target.id : null, action_type: status === 'sent' ? 'DOCUMENT_SENT' : 'DOCUMENT_SENT_DECLARED',
    approved_by: account.email, executed_at: sentAt, verified_at: status === 'sent' ? new Date().toISOString() : null, source_ref: proof?.message_id ? 'gmail:' + proof.message_id : proof?.file_id ? 'drive:' + proof.file_id : null,
    output_ref: `${KINDS[doc.kind]} : ${doc.word?.name} — ${CHANNELS[channel]}${deadline ? (ok ? ', avant la date limite' : ', APRÈS la date limite') : ''}` }).catch(() => null);
  return { document: saved, sending };
}

export async function saveSecretariatSettings(orgId, body, account, d = {}) {
  if (!['owner', 'partner', 'it_admin'].includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const email = cut(String(body.secretariat_email || '').trim().toLowerCase(), 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('EMAIL_INVALID');
  const fetchRows = d.fetchRows || rest;
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + q(orgId) + '&select=settings&limit=1').catch(() => null);
  const settings = { ...((Array.isArray(rows) && rows[0]?.settings) || {}), secretariat_email: email || null };
  await fetchRows('office_firm_settings?on_conflict=org_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ org_id: orgId, settings, updated_by: account.email, updated_at: new Date().toISOString() }]) });
  return { secretariat_email: email || null };
}
