// THE MISSING-DOCUMENTS LOOP OF A MISSION (Paul, 2026-10-19, point 7). One register (office_pbc_requests, db/pbc-requests.sql),
// one line per expected document, keeping the durable link: need → existing piece found → request of the missing ones only →
// e-mail to the right person (validated before sending) → reply in the request's own Gmail conversation (with or without a
// piece) → content checked → renamed and filed → working file → verified. A reply is never a closing: a person confirms a
// piece (Paul: « une personne confirme »); a partial piece or the wrong period prepares a precise complement request.
// Built from what exists: the SOPs' « PBC principale » (lib/methodology.js), the validated programme (lib/work-programme.js),
// the documents the agents already read for the mission (lib/mission-files.js), the validated sending (lib/mission-write.js
// → lib/agent-mail.js), the mission's PIECES_RECUES (lib/mission-quick.js).
import { rest } from './supabase.js';
import { audit } from './audit-log.js';
import { onTeam as onTeamOf } from './mission-function.js';

const FIRM_LEADS = ['owner', 'partner'];

const q = encodeURIComponent;
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const cut = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nowIso = d => (d.now ? new Date(d.now()) : new Date()).toISOString();

export const PBC_STATUS = Object.freeze({
  needed: 'À demander', request_pending: 'Demande en attente de validation', requested: 'Demandée — en attente de réponse',
  reply_received: 'Réponse reçue — à contrôler', reply_without_piece: 'Réponse sans pièce — à lire', to_confirm: 'Pièce à confirmer',
  complement_pending: 'Complément en attente de validation', complement_requested: 'Complément demandé', accepted: 'Reçue et confirmée', not_applicable: 'Sans objet'
});
// Still missing = to be requested. A candidate found among the mission's documents is NOT requested (it is to be confirmed).
const OPEN_FOR_REQUEST = ['needed'];

const tableMissing = e => (/office_pbc_requests|relation|PGRST205|42P01/i.test(String(e?.message || e)) ? fail('PBC_SQL_NOT_INSTALLED', 503) : e);
export async function listRequests(orgId, missionId, fetchRows = rest) {
  return await fetchRows(`office_pbc_requests?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&select=*&order=created_at.asc&limit=500`).catch(e => { throw tableMissing(e); }) || [];
}
async function patchRow(orgId, row, fields, entry, d) {
  const fetchRows = d.fetchRows || rest, at = nowIso(d);
  const history = [...(row.history || []), { at, ...entry }].slice(-100);
  await fetchRows(`office_pbc_requests?org_id=eq.${q(orgId)}&id=eq.${q(row.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, history, updated_at: at }) });
  return { ...row, ...fields, history, updated_at: at };
}

// The period the mission covers, read from its label (« Exercice 2025 », « 2024-2025 »): a whole year, or nothing (never guessed).
export function periodOf(label) {
  const years = [...String(label || '').matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]));
  if (!years.length) return { start: null, end: null, label: null };
  const a = Math.min(...years), b = Math.max(...years);
  return { start: `${a}-01-01`, end: `${b}-12-31`, label: a === b ? 'Exercice ' + a : `${a}-${b}` };
}
const keyOf = (missionId, cycle, document) => `pbc:${missionId}:${fold(cycle || '-')}:${fold(document).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120)}`;

// 1. NEEDS: the « PBC principale » of the SOP of each cycle of the validated programme. Created once (idempotent).
export async function planNeeds(orgId, missionId, account, d = {}) {
  mayWork(account, await (d.team || teamOf)(orgId, missionId, d));
  const fetchRows = d.fetchRows || rest;
  const progs = await fetchRows(`office_work_programmes?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&status=eq.validated&select=id,version,cycles&order=version.desc&limit=1`) || [];
  const programme = progs[0];
  if (!programme) throw fail('PROGRAMME_NOT_VALIDATED', 409);
  const lib = await (d.methodology || (async () => (await import('./methodology.js')).methodologyState({}, orgId)))();
  const mission = (await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=id,period_label&limit=1`).catch(() => fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=id&limit=1`)))?.[0] || {};
  const period = periodOf(mission.period_label);
  const rows = [], noPbc = [];
  for (const cycle of (programme.cycles || []).filter(c => c.status !== 'N/A_JUSTIFIED')) {
    const sop = (lib.sops || []).find(s => s.file_id === cycle.sop_file_id) || (lib.sops || []).find(s => s.cycle?.code && s.cycle.code === cycle.cycle_code);
    const list = sop?.cycle?.pbc || [];
    if (!list.length) { noPbc.push(cycle.cycle_code || cycle.cycle_title); continue; }
    const codes = (cycle.procedures || []).filter(p => p.active).map(p => p.code);
    for (const p of list) rows.push({ org_id: orgId, office_mission_id: missionId, idempotency_key: keyOf(missionId, cycle.cycle_code, p.document),
      document: cut(p.document, 300), purpose: cut(p.purpose, 600), cycle_code: cut(cycle.cycle_code, 40), procedure_codes: codes,
      period_start: period.start, period_end: period.end, period_label: period.label, status: 'needed', created_by: account.email,
      history: [{ at: nowIso(d), by: account.email, what: 'NEED', source: 'SOP « ' + (sop.file_name || sop.cycle?.title || '') + ' », programme v' + programme.version }] });
  }
  if (rows.length) await fetchRows('office_pbc_requests?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(rows) }).catch(e => { throw tableMissing(e); });
  return { proposed: rows.length, cycles_without_pbc: noPbc, period };
}

// 2. EXISTING: the documents the agents already read for this mission (by their CONTENT: type, period, summary) that look like a
// need become candidates — « à confirmer », never « reçue », and never requested again while a person has not decided.
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'l', 'd', 'a', 'au', 'aux', 'en', 'pour', 'par', 'sur', 'un', 'une', 'ou']);
const SYN = [[/\bgl\b|grand[ -]?livre/g, 'grandlivre'], [/balance[s]? (generale|comptable)|\bbg\b/g, 'balance'], [/releve[s]? (de compte |bancaire)|releves? de banque/g, 'relevebancaire'],
  [/etats? financiers?|\bef\b/g, 'etatsfinanciers'], [/rapprochement[s]? bancaire[s]?/g, 'rapprochement']];
export function tokens(text) {
  let t = fold(text).replace(/[_./-]+/g, ' ');
  for (const [re, w] of SYN) t = t.replace(re, ' ' + w + ' ');
  return [...new Set(t.split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)))];
}
export function matchExisting(need, docs) {
  const want = tokens(need.document);
  if (!want.length) return null;
  let best = null;
  for (const doc of docs) {
    const have = new Set(tokens([doc.type, doc.role, doc.name, doc.summary].filter(Boolean).join(' ')));
    const score = want.filter(w => have.has(w)).length / want.length;
    const years = [...String([doc.period, doc.name, doc.summary].join(' ')).matchAll(/\b(20\d{2})\b/g)].map(m => Number(m[1]));
    const y0 = need.period_start ? Number(String(need.period_start).slice(0, 4)) : null, y1 = need.period_end ? Number(String(need.period_end).slice(0, 4)) : null;
    const periodOk = !y0 || !years.length ? null : years.some(y => y >= y0 && y <= y1);
    if (score >= 0.6 && periodOk !== false && (!best || score > best.score)) best = { doc, score, period_ok: periodOk };
  }
  return best;
}
export async function findExisting(orgId, missionId, account, d = {}) {
  mayWork(account, await (d.team || teamOf)(orgId, missionId, d));
  const rows = (await listRequests(orgId, missionId, d.fetchRows || rest)).filter(r => r.status === 'needed');
  const docs = await (d.missionDocuments || (async id => (await import('./mission-files.js')).missionDocuments(id, d)))(missionId).catch(() => []);
  const found = [];
  for (const r of rows) {
    const m = matchExisting(r, docs);
    if (!m) continue;
    const piece = { file_id: m.doc.id || m.doc.file_id, name: m.doc.name, url: m.doc.url || null, source: 'existing', at: nowIso(d) };
    await patchRow(orgId, r, { status: 'to_confirm', pieces: [...(r.pieces || []), piece],
      control: { proposed: m.period_ok === true ? 'conforme' : 'a_verifier', by: 'code', reasons: [`Document déjà lu pour la mission : « ${m.doc.name} »${m.doc.period ? ', période ' + m.doc.period : ''} (ressemblance ${Math.round(m.score * 100)} %).`,
        m.period_ok === null ? 'Période du document non lue : à vérifier.' : 'Période compatible avec la mission.'], at: nowIso(d) } },
      { by: account.email, what: 'EXISTING_FOUND', file_id: piece.file_id }, d);
    found.push({ id: r.id, document: r.document, piece: piece.name });
  }
  return { checked: rows.length, found };
}

// 3. REQUEST of the missing ones only: one e-mail per recipient, written by the code from the register (refs, document, period),
// through the validated sending (a manager approves; a manager may send it at once). Linked to every line it asks for.
export function requestText(mission, items, period) {
  const lines = items.map(r => `- ${r.ref ? r.ref + ' — ' : ''}${r.document}${r.period_label ? ' (' + r.period_label + ')' : ''}${r.purpose ? ' : ' + r.purpose : ''}`);
  return { subject: `Demande de documents — ${mission.name}${mission.mission_code ? ' [' + mission.mission_code + ']' : ''}`,
    body: `Bonjour,\n\nDans le cadre de notre mission « ${mission.name} »${period ? ' (' + period + ')' : ''}, pourriez-vous nous transmettre les documents suivants :\n\n${lines.join('\n')}\n\nVous pouvez répondre directement à ce message en joignant les documents. Si un document n'existe pas ou n'est pas applicable, merci de nous l'indiquer en réponse.\n\nNous vous remercions par avance.\n` };
}
export async function draftRequest(orgId, missionId, body = {}, account, d = {}) {
  mayWork(account, await (d.team || teamOf)(orgId, missionId, d));
  const fetchRows = d.fetchRows || rest;
  const all = await listRequests(orgId, missionId, fetchRows);
  const wanted = Array.isArray(body.ids) && body.ids.length ? new Set(body.ids.map(String)) : null;
  const items = all.filter(r => OPEN_FOR_REQUEST.includes(r.status) && (!wanted || wanted.has(String(r.id))));
  if (!items.length) throw fail('NOTHING_TO_REQUEST', 409);
  const to = (Array.isArray(body.to) ? body.to : []).map(e => String(e).trim().toLowerCase()).filter(Boolean);
  if (!to.length) throw fail('RECIPIENTS_REQUIRED');
  const mission = (await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=id,name,mission_code&limit=1`))?.[0];
  if (!mission) throw fail('MISSION_NOT_FOUND', 404);
  const text = requestText(mission, items, items.find(r => r.period_label)?.period_label || null);
  const submit = d.submit || (await import('./mission-write.js')).submit;
  const sent = await submit(orgId, missionId, { purpose: 'pbc', to, cc: body.cc || [], subject: cut(body.subject, 200) || text.subject, body: cut(body.body, 10000) || text.body,
    request: 'Demande des pièces manquantes : ' + items.map(r => r.document).join(' ; '), send: body.send === true }, account, d);
  for (const r of items) await patchRow(orgId, r, { status: 'request_pending', request: { message_id: sent.message_id, to, at: nowIso(d), by: account.email } },
    { by: account.email, what: 'REQUEST_DRAFTED', message_id: sent.message_id }, d);
  await (d.audit || audit)(orgId, { agent: 'mission-controller', mission_id: missionId, action_type: 'PBC_REQUEST_PREPARED', status: 'succeeded',
    decision: items.length + ' pièce(s) demandée(s) à ' + to.join(', '), approved_by: cut(account.display_name || account.email, 120), output_ref: 'message:' + sent.message_id }, { fetchRows }).catch(() => null);
  return { message_id: sent.message_id, status: sent.status, items: items.length };
}

// 4. The sending decided by a person: sent (with its Gmail id) → « demandée »; refused → back to « à demander ».
export async function syncSending(orgId, missionId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const rows = (await listRequests(orgId, missionId, fetchRows)).filter(r => ['request_pending', 'complement_pending'].includes(r.status));
  const ids = [...new Set(rows.map(r => r.status === 'complement_pending' ? (r.complements || []).at(-1)?.message_id : r.request?.message_id).filter(Boolean))];
  if (!ids.length) return { updated: 0 };
  const msgs = new Map((await fetchRows(`office_agent_messages?org_id=eq.${q(orgId)}&id=in.(${ids.map(q).join(',')})&select=id,status,sent_at,provider_message_id`).catch(() => []) || []).map(m => [m.id, m]));
  let updated = 0;
  for (const r of rows) {
    const complement = r.status === 'complement_pending', mid = complement ? (r.complements || []).at(-1)?.message_id : r.request?.message_id;
    const m = msgs.get(mid);
    if (!m) continue;
    if (m.status === 'sent' && m.provider_message_id) {
      // SENT only with the Gmail id (principle 8): the conversation is read from it.
      const fields = complement
        ? { status: 'complement_requested', complements: (r.complements || []).map((c, i, all) => (i === all.length - 1 ? { ...c, sent_at: m.sent_at, provider_message_id: m.provider_message_id } : c)) }
        : { status: 'requested', request: { ...r.request, sent_at: m.sent_at, provider_message_id: m.provider_message_id } };
      await patchRow(orgId, r, fields, { what: complement ? 'COMPLEMENT_SENT' : 'REQUEST_SENT', provider_message_id: m.provider_message_id }, d); updated++;
    } else if (['rejected', 'failed'].includes(m.status)) {
      await patchRow(orgId, r, { status: complement ? 'to_confirm' : 'needed' }, { what: complement ? 'COMPLEMENT_' + m.status.toUpperCase() : 'REQUEST_' + m.status.toUpperCase() }, d); updated++;
    }
  }
  return { updated };
}

// A person's decision on a line: the piece is confirmed (« reçue »), the line is « sans objet » (reason), or reopened.
export async function decide(orgId, missionId, body = {}, account, d = {}) {
  const team = await (d.team || teamOf)(orgId, missionId, d);
  mayWork(account, team);
  const row = (await listRequests(orgId, missionId, d.fetchRows || rest)).find(r => String(r.id) === String(body.id));
  if (!row) throw fail('PBC_REQUEST_NOT_FOUND', 404);
  const reason = cut(String(body.reason || '').trim(), 600);
  if (body.decision === 'accept') {
    if (!(row.pieces || []).length) throw fail('NO_PIECE_TO_CONFIRM', 409);
    return patchRow(orgId, row, { status: 'accepted', control: { ...(row.control || {}), confirmed_by: account.email, confirmed_at: nowIso(d), note: reason } }, { by: account.email, what: 'ACCEPTED' }, d);
  }
  if (body.decision === 'not_applicable') {
    if (!reason) throw fail('REASON_REQUIRED');
    return patchRow(orgId, row, { status: 'not_applicable' }, { by: account.email, what: 'NOT_APPLICABLE', reason }, d);
  }
  if (body.decision === 'reopen') return patchRow(orgId, row, { status: 'needed' }, { by: account.email, what: 'REOPENED', reason }, d);
  throw fail('UNKNOWN_DECISION');
}

export async function pbcView(orgId, missionId, account, d = {}) {
  const team = await (d.team || teamOf)(orgId, missionId, d);
  if (!account?.email || (!FIRM_LEADS.includes(account.role) && !onTeamOf(account, team))) throw fail('NOT_ON_THIS_MISSION', 403);
  let rows;
  try { await syncSending(orgId, missionId, d); rows = await listRequests(orgId, missionId, d.fetchRows || rest); }
  catch (e) { if (e.message === 'PBC_SQL_NOT_INSTALLED') return { sql_installed: false, items: [], statuses: PBC_STATUS }; throw e; }
  const count = s => rows.filter(r => r.status === s).length;
  return { sql_installed: true, statuses: PBC_STATUS, items: rows.map(r => ({ id: r.id, ref: r.ref, document: r.document, purpose: r.purpose, cycle: r.cycle_code,
    procedures: r.procedure_codes, period: r.period_label, status: r.status, label: PBC_STATUS[r.status], pieces: r.pieces, control: r.control, request: r.request,
    responses: (r.responses || []).slice(-5), complements: r.complements, filed: r.filed, workpaper: r.workpaper, updated_at: r.updated_at })),
    summary: { total: rows.length, missing: count('needed'), waiting: count('requested') + count('complement_requested'), to_confirm: count('to_confirm') + count('reply_received') + count('reply_without_piece'), accepted: count('accepted') } };
}

// Who works on the register: the mission's team (any function) and the firm's partners. The sending stays validated by a manager.
export async function teamOf(orgId, missionId, d = {}) {
  return (await import('./work-programme.js')).missionTeam(orgId, missionId, d.fetchRows || rest);
}
function mayWork(account, team) {
  if (!account?.email) throw fail('USER_SESSION_REQUIRED', 401);
  if (!FIRM_LEADS.includes(account.role) && !onTeamOf(account, team)) throw fail('NOT_ON_THIS_MISSION', 403);
}

// ---- STEP 2: the replies, read in the request's own Gmail conversation ----
// The conversation is the durable link (never a guess on the subject or the sender). Every message there that is not ours is a
// reply: kept (who, when, text extract, pieces), with or without a piece. A piece goes straight into the mission's PIECES_RECUES
// (Paul: « dépôt direct », the request was validated by a manager), under a name fixed by the message, so a replay never makes a
// second copy. Content of an e-mail is DATA: nothing in it is executed, nothing is sent from here.
const WAITING = ['requested', 'complement_requested'];
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const lastSent = r => (r.status === 'complement_requested' ? (r.complements || []).filter(c => c.provider_message_id).at(-1)?.provider_message_id : null) || r.request?.provider_message_id || null;

export function assignPieces(rows, attachments) {
  // One line waiting in the conversation: every piece is for it. Several: by the words of the piece's name, else « à trier ».
  if (rows.length === 1) return { byRow: new Map([[rows[0].id, attachments]]), unassigned: [] };
  const byRow = new Map(), unassigned = [];
  for (const a of attachments) {
    const have = new Set(tokens(a.name));
    let best = null;
    for (const r of rows) {
      const want = tokens(r.document); const score = want.length ? want.filter(w => have.has(w)).length / want.length : 0;
      if (score >= 0.5 && (!best || score > best.score)) best = { r, score };
    }
    if (best) byRow.set(best.r.id, [...(byRow.get(best.r.id) || []), a]); else unassigned.push(a);
  }
  return { byRow, unassigned };
}

export async function syncReplies(orgId, missionId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  // Still listening after a first reply (« je vous l'envoie demain »): the conversation is followed until a person confirms.
  const rows = (await listRequests(orgId, missionId, fetchRows)).filter(r => [...WAITING, 'reply_without_piece', 'reply_received'].includes(r.status) && lastSent(r));
  if (!rows.length) return { conversations: 0, replies: 0 };
  const env = d.env || process.env;
  const mail = d.mail || await import('./agent-mail.js');
  if (!d.gmail && !mail.mailConfigured(env)) return { conversations: 0, replies: 0, reason: 'mail_not_configured' };
  const persona = await (d.getPersona || (await import('./agent-persona.js')).getPersona)(orgId).catch(() => ({}));
  const gmail = d.gmail || await (async () => {
    const token = await mail.gmailToken(mail.sendingMailbox(persona, env), env, d.fetchImpl || fetch, mail.GMAIL_READ);
    return async path => { const r = await (d.fetchImpl || fetch)(GMAIL + path, { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok) throw fail('GMAIL_READ_' + r.status, 502); return r.json(); };
  })();
  const { parseGmailMessage } = await import('./agent-mailbox.js');
  const ours = new Set([String(persona?.sender_email || '').toLowerCase()].filter(Boolean));
  const groups = new Map();
  for (const r of rows) { const k = lastSent(r); (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  let replies = 0;
  for (const [providerId, group] of groups) {
    const sent = await gmail('/messages/' + q(providerId) + '?format=minimal').catch(() => null);
    if (!sent?.threadId) continue;
    const thread = await gmail('/threads/' + q(sent.threadId) + '?format=full').catch(() => null);
    const known = new Set(group.flatMap(r => (r.responses || []).map(x => x.gmail_id)));
    const sentAt = Math.min(...group.map(r => Date.parse(r.request?.sent_at || '') || 0));
    const fresh = (thread?.messages || []).map(parseGmailMessage)
      .filter(m => m.gmailId !== providerId && !known.has(m.gmailId) && !ours.has(String(m.fromEmail || '').toLowerCase()) && (Date.parse(m.sentAt) || 0) >= sentAt - 60000)
      .sort((a, b) => (Date.parse(a.sentAt) || 0) - (Date.parse(b.sentAt) || 0));
    for (const m of fresh) {
      const pieces = [];
      for (const a of m.attachments) {
        if (a.size > 20 * 1024 * 1024) { pieces.push({ name: a.name, skipped: 'TOO_LARGE' }); continue; }
        const att = await gmail('/messages/' + q(m.gmailId) + '/attachments/' + q(a.id));
        const buffer = Buffer.from(String(att.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const stored = await (d.storePiece || (await import('./mission-quick.js')).storeReceivedPiece)(orgId, missionId,
          { name: 'MAIL_' + String(m.sentAt || '').slice(0, 10) + '_' + String(m.gmailId).slice(-8) + '_' + a.name, buffer, mime: a.mimeType }, d);
        pieces.push({ file_id: stored.file_id, name: stored.name, original_name: a.name, url: stored.url || null, source: 'mail', gmail_id: m.gmailId, at: m.sentAt });
      }
      const response = { gmail_id: m.gmailId, message_id: m.messageId, thread_id: sent.threadId, from: m.fromEmail || m.from, at: m.sentAt,
        subject: cut(m.subject, 200), text: cut(String(m.bodyText || '').replace(/\n>.*$/gs, '').trim(), 600), pieces: pieces.map(p => p.name) };
      const live = group.filter(r => WAITING.includes(r.status) || r.status === 'reply_received' || r.status === 'reply_without_piece');
      const usable = pieces.filter(p => p.file_id);
      const { byRow, unassigned } = assignPieces(live, usable);
      for (const r of live) {
        const mine = byRow.get(r.id) || [];
        const status = mine.length || unassigned.length ? 'reply_received' : (r.status === 'reply_received' ? 'reply_received' : 'reply_without_piece');
        const updated = await patchRow(orgId, r, { status, responses: [...(r.responses || []), { ...response, unassigned: unassigned.map(p => p.file_id) }].slice(-30),
          pieces: [...(r.pieces || []), ...mine], request: { ...r.request, thread_id: sent.threadId } },
          { what: mine.length ? 'PIECE_RECEIVED' : 'REPLY_RECEIVED', gmail_id: m.gmailId, pieces: mine.map(p => p.name) }, d);
        Object.assign(r, updated);
      }
      if (usable.length) {
        // The pieces join the mission's documents and are read by the agents (same path as a piece put by a person).
        await (d.recordReceived || (async (o, mid, files) => (await import('./mission-quick.js')).piecesReceived(o, d.req || null,
          { mission_id: mid, files: files.map(f => ({ id: f.file_id })), note: 'Reçu par e-mail en réponse à la demande de pièces' },
          { email: 'mission-controller', display_name: 'Mission Controller (IA)' }, d)))(orgId, missionId, usable).catch(() => null);
      }
      await (d.audit || audit)(orgId, { agent: 'mission-controller', mission_id: missionId, action_type: usable.length ? 'PBC_PIECES_RECEIVED' : 'PBC_REPLY_WITHOUT_PIECE', status: 'succeeded',
        decision: `${response.from} : ${usable.length} pièce(s)${unassigned.length ? ', ' + unassigned.length + ' à trier' : ''}`, source_ref: 'gmail:' + m.gmailId }, { fetchRows }).catch(() => null);
      replies++;
    }
  }
  return { conversations: groups.size, replies };
}

// The scheduler: every mission with a request waiting. Also used by the « label » scanner to leave these conversations to us.
export async function waitingThreads(orgId, fetchRows = rest) {
  const rows = await fetchRows(`office_pbc_requests?org_id=eq.${q(orgId)}&status=in.(${['request_pending', 'complement_pending', ...WAITING, 'reply_received', 'reply_without_piece', 'to_confirm'].join(',')})&select=office_mission_id,request&limit=2000`).catch(() => []) || [];
  return { missions: [...new Set(rows.map(r => r.office_mission_id))], threads: new Set(rows.map(r => r.request?.thread_id).filter(Boolean)) };
}
export async function pbcPass(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const { missions } = await waitingThreads(orgId, fetchRows);
  const out = [];
  for (const id of missions.slice(0, 30)) {
    try { await syncSending(orgId, id, d); out.push({ mission_id: id, ...(await syncReplies(orgId, id, d)) }); }
    catch (e) { out.push({ mission_id: id, error: cut(e.message || e, 160) }); }
  }
  return { missions: out.length, results: out };
}
