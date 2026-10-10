import { rest } from './supabase.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';

// THE ORPAILLEUR ASKS ONLY WHAT IS MISSING, AND READS THE ANSWER (2026-10-08, from its own
// description: « je demande uniquement ce qui me manque… lors de mes passages suivants je cherche
// les réponses… je lis ce qu'il a réellement dit… sa réponse devient une partie de mon audit trail…
// je ne lui annonce jamais une action avant de l'avoir vérifiée »).
//  - the file waits in 00_A_REVOIR_AGENT;
//  - one question, to the mission's manager, else the person who saved the file (a member), else the
//    firm's documentary referent; never the same question twice;
//  - an e-mail to a COLLEAGUE goes at once when the agents work on their own (Paramètres), else it
//    waits in « À valider »; its message and thread are kept;
//  - at the next passes the reply is read, what it confirms is kept (with its reference), the file
//    is decided again with it; once the file is really filed (checked in Drive), a thank-you follows.

const q = encodeURIComponent;
const cut = (s, n) => String(s ?? '').slice(0, n);
export const REVIEW_FOLDER = '00_A_REVOIR_AGENT';
const SYSTEM = { role: 'owner', display_name: 'Orpailleur (envoi automatique à un collègue)', email: null };

async function memberEmails(orgId, fetchRows) {
  const { firmMembers } = await import('./firm-members.js');
  const f = await firmMembers(orgId, { fetchRows }).catch(() => ({ members: [] }));
  return f.members.filter(m => m.email);
}

// Who to ask: the mission's manager; else the member who saved the file; else the referent.
export async function whoToAsk(orgId, f, x, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const members = d.members || await memberEmails(orgId, fetchRows);
  const isMember = e => members.some(m => m.email === String(e || '').toLowerCase());
  const client = String(x.client || '').trim();
  if (client) {
    const missions = await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&select=id,name&limit=300').catch(() => []) || [];
    const words = client.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
    const m = missions.find(mi => words.length && words.every(w => String(mi.name || '').toLowerCase().includes(w)));
    if (m) {
      const team = await fetchRows('office_mission_assignments?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(m.id) + '&select=staff_profile_id,mission_role&limit=50').catch(() => []) || [];
      const lead = team.find(t => /manager|chef|responsable|lead|associ/i.test(String(t.mission_role || '')));
      if (lead) {
        const s = (await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=eq.' + q(lead.staff_profile_id) + '&select=email,full_name&limit=1').catch(() => []))?.[0];
        if (s?.email && isMember(s.email)) return { email: s.email.toLowerCase(), why: 'manager de la mission « ' + m.name + ' »' };
      }
    }
  }
  const saver = String(f.by || '').toLowerCase();
  if (saver && isMember(saver)) return { email: saver, why: 'a enregistré le fichier' };
  // The documentary referent: the owner's choice (Paramètres), else « Yvan » if he is a member, else the owner.
  const ref = members.find(m => d.referent && m.email === String(d.referent).toLowerCase()) || members.find(m => /\byvan\b/i.test(m.full_name || ''));
  if (ref) return { email: ref.email, why: 'référent documentaire' };
  const owners = await fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&role=eq.owner&active=eq.true&select=email&limit=1').catch(() => []) || [];
  return owners[0]?.email ? { email: String(owners[0].email).toLowerCase(), why: 'propriétaire' } : null;
}

export async function askMissing(orgId, f, x, st, d = {}) {
  st.asked = st.asked || {};
  if (st.asked[f.id] && ['open', 'answered'].includes(st.asked[f.id].status)) return { skipped: 'ALREADY_ASKED' };
  const to = await (d.whoToAsk || whoToAsk)(orgId, f, x, d);
  // The file waits in 00_A_REVOIR_AGENT (never deleted, its first place is kept).
  let moved = null;
  if (d.leaveInPlace !== true) try {
    const td = d.tidyDrive || (await import('./tidy-drive.js')).tidyDrive;
    const review = d.reviewFolderId || await reviewFolder(d);
    const from = (f.parents || [])[0] || null;
    if (review && from !== review && td.canWrite?.() !== false) { await td.move(f.id, from, review, null); moved = { from, to: review }; }
  } catch { moved = null; }
  const record = { at: new Date().toISOString(), status: 'open', file: { id: f.id, name: f.name, path: f.path, url: f.webViewLink || null, from_parent: (f.parents || [])[0] || null },
    known: cut(x.known, 600) || null, missing: cut(x.missing || x.question, 600), question: cut(x.question, 600), to: to?.email || null, why: to?.why || null, moved, message_id: null, sent: false };
  if (to?.email) {
    const body = 'Bonjour,\n\nJe range le Drive du cabinet et il me manque une seule information sur « ' + f.name + ' ».\n\n' +
      (record.known ? 'Ce que je sais déjà : ' + record.known + '\n' : '') + 'Ce qui me manque : ' + record.missing + '\n\n' + (record.question ? record.question + '\n\n' : '') +
      (f.webViewLink ? 'Le fichier : ' + f.webViewLink + '\n' : '') + (moved ? 'Il attend dans ' + REVIEW_FOLDER + '.' : 'Le fichier reste à son emplacement actuel.') + ' Votre réponse aidera à proposer son classement.\n\nMerci !';
    try {
      const mail = await import('./agent-mail.js');
      const saved = await (d.proposeMessage || mail.proposeMessage)(orgId, { recipients: [to.email], source: 'agent', requested_by: 'Orpailleur', subject: 'Une question sur un fichier : ' + cut(f.name, 150), body }, null, d.mailDeps || {});
      record.message_id = saved?.id || null;
      // Colleagues only, and only when the agents work on their own: sent at once (all checks of the
      // normal sending apply: colleagues only, daily limit, Gmail).
      if (saved?.id && d.autoSend) {
        const sent = await (d.decideMessage || mail.decideMessage)(orgId, { id: saved.id, decision: 'approve', seen_sha256: saved.content_sha256 }, SYSTEM, d.mailDeps || {}).catch(e => ({ error: String(e.message || e) }));
        record.sent = !sent?.error && sent?.status === 'sent'; record.send_error = sent?.error ? cut(sent.error, 160) : null;
      }
    } catch (e) { record.send_error = cut(e.message || e, 160); }
  }
  st.asked[f.id] = record;
  // Event bus: the Mission Controller knows a document waits for a person's answer.
  await (d.emit || (await import('./event-bus.js')).emit)(orgId, { type: 'NEEDS_HUMAN_CLASSIFICATION', agent: 'orpailleur', object_type: 'drive_file', object_id: f.id, source: 'drive:' + f.id,
    idempotency_key: 'NEEDS_HUMAN_CLASSIFICATION:' + f.id + ':' + String(record.missing || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60),
    payload: { name: f.name, missing: record.missing, known: record.known, asked: record.to, client: x.client || null } }, { fetchRows: d.fetchRows }).catch(() => null);
  return record;
}

let reviewCache = null;
async function reviewFolder(d) {
  if (reviewCache) return reviewCache;
  const { firmDriveId } = await import('./google-connection.js');
  const root = d.root || firmDriveId();
  if (!root) return null;
  const { driveAdapter } = await import('./drive-adapter.js');
  const kids = await (d.drive || driveAdapter).listChildren(root).catch(() => []) || [];
  const f = kids.find(k => k.name === REVIEW_FOLDER && k.mimeType === 'application/vnd.google-apps.folder');
  if (f) reviewCache = f.id;
  return reviewCache;
}

const READ_REPLY = `Une personne du cabinet répond à une question de l'Orpailleur (agent documentaire) sur un fichier. Dis exactement ce que la réponse CONFIRME (rien de plus), et si elle répond à ce qui manquait.
JSON STRICT : {"answers_missing":true|false,"confirms":"(ce qui est confirmé, en une ou deux phrases)","client":"","mission":"","period":"","destination_hint":"","other":""}`;

// At each pass: the replies to the open questions are read; what they confirm is kept with its reference.
export async function checkAnswers(orgId, st, d = {}) {
  const out = [];
  for (const [fileId, a] of Object.entries(st.asked || {})) {
    if (a.status !== 'open' || !a.message_id) continue;
    try {
      const t = await (d.messageThread || (await import('./agent-mail.js')).messageThread)(orgId, a.message_id, d.mailDeps || {});
      const replies = (t.thread || []).filter(m => !m.from_agent && String(m.text || '').trim());
      if (!replies.length) continue;
      const last = replies[replies.length - 1];
      let parsed = null;
      try { parsed = parseJsonLoose((await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: READ_REPLY, input: 'QUESTION : ' + a.missing + '\nDÉJÀ SU : ' + (a.known || '') + '\n\nRÉPONSE DE ' + last.from + ' :\n' + cut(last.text, 4000), maxTokens: 800 })).text); } catch { parsed = null; }
      Object.assign(a, { status: 'answered', answered_at: new Date().toISOString(), answer: cut(parsed?.confirms || last.text, 1200), answer_by: cut(last.from, 200),
        answer_ref: { gmail_id: last.gmail_id, thread_id: t.thread_id || null, date: last.date || null }, answer_details: parsed || null, provider_message_id: (t.thread || []).find(m => m.from_agent)?.gmail_id || null });
      out.push(fileId);
    } catch { /* Gmail not readable now: tried again at the next pass */ }
  }
  return out;
}

// Once the file is really filed (checked in Drive): thank the person, in the same conversation.
export async function thankAfterVerified(orgId, a, effect, d = {}) {
  if (!a || a.status !== 'answered' || a.thanked || !a.to) return null;
  const mail = await import('./agent-mail.js');
  const saved = await (d.proposeMessage || mail.proposeMessage)(orgId, { recipients: [a.to], source: 'agent', requested_by: 'Orpailleur', reply_to: a.provider_message_id || undefined,
    subject: 'Merci — « ' + cut(a.file?.name, 120) + ' » est traité', body: 'Bonjour,\n\nMerci. Grâce à votre confirmation (« ' + cut(a.answer, 300) + ' »), voici ce qui a effectivement été traité, vérifié dans le Drive :\n' + cut(effect, 600) + '\n\nBonne journée.' }, null, d.mailDeps || {}).catch(() => null);
  if (saved?.id && d.autoSend) await (d.decideMessage || mail.decideMessage)(orgId, { id: saved.id, decision: 'approve', seen_sha256: saved.content_sha256 }, SYSTEM, d.mailDeps || {}).catch(() => null);
  a.thanked = true; a.status = 'resolved'; a.resolved_at = new Date().toISOString();
  return saved;
}
