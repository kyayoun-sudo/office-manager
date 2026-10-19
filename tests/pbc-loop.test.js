import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../lib/pbc-loop.js';

// Point 7 (Paul, 2026-10-19): need → existing piece found → request of the missing ones only → validated sending.
const M = '33333333-3333-4333-8333-333333333333';
const manager = { role: 'manager', email: 'm@c.ci', display_name: 'Manager' };
const outsider = { role: 'manager', email: 'x@c.ci' };

function world() {
  const t = { rows: [], messages: {}, submitted: [], audits: [] };
  let n = 0;
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_pbc_requests')) {
      if (o.method === 'POST') { for (const r of JSON.parse(o.body)) if (!t.rows.some(x => x.idempotency_key === r.idempotency_key)) t.rows.push({ id: 'r' + (++n), pieces: [], responses: [], complements: [], history: [], request: {}, control: {}, created_at: String(n).padStart(3, '0'), ...r }); return []; }
      if (o.method === 'PATCH') { const id = decodeURIComponent(path.match(/[?&]id=eq\.([^&]+)/)[1]); Object.assign(t.rows.find(r => r.id === id), JSON.parse(o.body)); return []; }
      return t.rows.filter(r => r.office_mission_id === M);
    }
    if (path.startsWith('office_work_programmes')) return [{ id: 'p', version: 2, cycles: [
      { cycle_code: 'ACH', sop_file_id: 'SOP1', status: 'IN_SCOPE', procedures: [{ code: 'ACH-01', active: true }, { code: 'ACH-02', active: false }] },
      { cycle_code: 'TRE', sop_file_id: 'SOP2', status: 'IN_SCOPE', procedures: [] }] }];
    if (path.startsWith('office_missions')) return [{ id: M, name: 'Audit projet', mission_code: 'PRJ-25', period_label: 'Exercice 2025' }];
    if (path.startsWith('office_agent_messages')) return Object.values(t.messages);
    if (path.startsWith('office_audit_events')) return [];
    return [];
  };
  const d = { fetchRows, audit: async (o, e) => { t.audits.push(e); },
    team: async () => [{ email: 'm@c.ci', mission_function: 'manager' }],
    methodology: async () => ({ sops: [
      { file_id: 'SOP1', file_name: 'SOP Achats.docx', cycle: { code: 'ACH', pbc: [{ document: 'Grand livre fournisseurs', purpose: 'Population des achats' }, { document: 'Factures fournisseurs', purpose: null }] } },
      { file_id: 'SOP2', file_name: 'SOP Trésorerie.docx', cycle: { code: 'TRE', pbc: [] } }] }),
    submit: async (o, m, input, account) => { t.submitted.push(input); const id = 'msg' + t.submitted.length; t.messages[id] = { id, status: 'pending_approval' }; return { message_id: id, status: 'pending_approval' }; } };
  return { t, d };
}

test('the mission\'s period and a document\'s match are read by code, never guessed', () => {
  assert.deepEqual(P.periodOf('Exercice 2025'), { start: '2025-01-01', end: '2025-12-31', label: 'Exercice 2025' });
  assert.equal(P.periodOf('Audit du projet').label, null);
  const need = { document: 'Grand livre fournisseurs', period_start: '2025-01-01', period_end: '2025-12-31' };
  assert.equal(P.matchExisting(need, [{ id: 'a', name: 'GL_fournisseurs_2024.xlsx', type: 'grand livre fournisseurs', period: '2024' }]), null, 'wrong year: not a candidate');
  assert.equal(P.matchExisting(need, [{ id: 'b', name: 'GL_fournisseurs_2025.xlsx', type: 'grand livre fournisseurs', period: '2025' }]).doc.id, 'b');
  assert.equal(P.matchExisting(need, [{ id: 'c', name: 'Statuts.pdf', type: 'statuts' }]), null);
});

test('needs come from the SOPs of the validated programme, once; the mission\'s team only', async () => {
  const { t, d } = world();
  await assert.rejects(P.planNeeds('org', M, outsider, d), /NOT_ON_THIS_MISSION/);
  const r = await P.planNeeds('org', M, manager, d);
  assert.equal(r.proposed, 2); assert.deepEqual(r.cycles_without_pbc, ['TRE']);
  assert.equal(t.rows[0].period_label, 'Exercice 2025'); assert.deepEqual(t.rows[0].procedure_codes, ['ACH-01']);
  await P.planNeeds('org', M, manager, d);
  assert.equal(t.rows.length, 2, 'never created twice');
});

test('a piece already read for the mission is « à confirmer », and only the really missing ones are requested', async () => {
  const { t, d } = world();
  await P.planNeeds('org', M, manager, d);
  const found = await P.findExisting('org', M, manager, { ...d, missionDocuments: async () => [{ id: 'F1', name: 'GL fournisseurs 2025.xlsx', type: 'grand livre fournisseurs', period: '2025' }] });
  assert.equal(found.found.length, 1);
  assert.equal(t.rows[0].status, 'to_confirm'); assert.equal(t.rows[0].pieces[0].file_id, 'F1'); assert.equal(t.rows[0].pieces[0].source, 'existing');
  await assert.rejects(P.draftRequest('org', M, { to: [] }, manager, d), /RECIPIENTS_REQUIRED/);
  const req = await P.draftRequest('org', M, { to: ['cfo@client.com'] }, manager, d);
  assert.equal(req.items, 1);
  assert.match(t.submitted[0].body, /Factures fournisseurs \(Exercice 2025\)/);
  assert.doesNotMatch(t.submitted[0].body, /Grand livre/, 'the piece already found is not requested');
  assert.equal(t.rows[1].status, 'request_pending'); assert.equal(t.rows[1].request.message_id, 'msg1');
  await assert.rejects(P.draftRequest('org', M, { to: ['cfo@client.com'] }, manager, d), /NOTHING_TO_REQUEST/, 'never requested twice');
});

test('« demandée » only once the e-mail is really sent (with its Gmail id); refused → to request again', async () => {
  const { t, d } = world();
  await P.planNeeds('org', M, manager, d);
  await P.draftRequest('org', M, { to: ['cfo@client.com'] }, manager, d);
  await P.syncSending('org', M, d);
  assert.ok(t.rows.every(r => r.status === 'request_pending'), 'pending approval: not « demandée »');
  t.messages.msg1 = { id: 'msg1', status: 'sent', sent_at: '2026-10-19T10:00:00Z', provider_message_id: 'gm-1' };
  await P.syncSending('org', M, d);
  assert.ok(t.rows.every(r => r.status === 'requested' && r.request.provider_message_id === 'gm-1'));
  const { t: t2, d: d2 } = world();
  await P.planNeeds('org', M, manager, d2); await P.draftRequest('org', M, { to: ['cfo@client.com'] }, manager, d2);
  t2.messages.msg1 = { id: 'msg1', status: 'rejected' };
  await P.syncSending('org', M, d2);
  assert.ok(t2.rows.every(r => r.status === 'needed'));
});

test('a person decides: confirm needs a piece; « sans objet » needs a reason; the view counts each state', async () => {
  const { t, d } = world();
  await P.planNeeds('org', M, manager, d);
  await assert.rejects(P.decide('org', M, { id: 'r2', decision: 'accept' }, manager, d), /NO_PIECE_TO_CONFIRM/);
  await assert.rejects(P.decide('org', M, { id: 'r2', decision: 'not_applicable' }, manager, d), /REASON_REQUIRED/);
  await P.decide('org', M, { id: 'r2', decision: 'not_applicable', reason: 'Aucune facture sur la période' }, manager, d);
  await P.findExisting('org', M, manager, { ...d, missionDocuments: async () => [{ id: 'F1', name: 'GL fournisseurs 2025.xlsx', type: 'grand livre fournisseurs', period: '2025' }] });
  await P.decide('org', M, { id: 'r1', decision: 'accept' }, manager, d);
  assert.equal(t.rows[0].status, 'accepted'); assert.equal(t.rows[0].control.confirmed_by, 'm@c.ci');
  const v = await P.pbcView('org', M, manager, d);
  assert.deepEqual(v.summary, { total: 2, missing: 0, waiting: 0, to_confirm: 0, accepted: 1 });
  assert.ok(t.rows[1].history.some(h => h.what === 'NOT_APPLICABLE' && h.reason));
});

// Step 2: replies read in the request's own conversation, with or without a piece; direct deposit; never twice.
function gmailMsg(id, from, at, text, attachments = []) {
  return { id, threadId: 'T1', internalDate: String(Date.parse(at)), payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: 'Re: Demande' }, { name: 'Message-ID', value: '<' + id + '>' }],
    parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(text).toString('base64') } },
      ...attachments.map((a, i) => ({ filename: a, mimeType: 'application/pdf', body: { attachmentId: 'A' + i, size: 10 } }))] } };
}
async function requested(extra = {}) {
  const w = world();
  await P.planNeeds('org', M, manager, w.d);
  await P.draftRequest('org', M, { to: ['cfo@client.com'] }, manager, w.d);
  w.t.messages.msg1 = { id: 'msg1', status: 'sent', sent_at: '2026-10-19T10:00:00Z', provider_message_id: 'gm-1' };
  await P.syncSending('org', M, w.d);
  w.thread = [gmailMsg('gm-1', 'Agent <agent@cabinet.ci>', '2026-10-19T10:00:00Z', 'Demande')];
  w.stored = []; w.received = [];
  w.d = { ...w.d, ...extra, getPersona: async () => ({ sender_email: 'agent@cabinet.ci' }),
    gmail: async path => path.startsWith('/messages/gm-1?') ? { threadId: 'T1' } : path.startsWith('/threads/') ? { messages: w.thread } : { data: Buffer.from('%PDF').toString('base64') },
    storePiece: async (o, mid, f) => { const ex = w.stored.find(x => x.name === f.name); if (ex) return { ...ex, already: true }; const s = { file_id: 'D' + (w.stored.length + 1), name: f.name }; w.stored.push(s); return s; },
    recordReceived: async (o, mid, files) => { w.received.push(...files); } };
  return w;
}

test('a reply without a piece is kept and shown; a later reply with the pieces is matched to each line by its name', async () => {
  const w = await requested();
  w.thread.push(gmailMsg('c-1', 'CFO <cfo@client.com>', '2026-10-19T12:00:00Z', 'Je vous envoie cela demain.'));
  let r = await P.syncReplies('org', M, w.d);
  assert.equal(r.replies, 1);
  assert.ok(w.t.rows.every(x => x.status === 'reply_without_piece'), 'a reply is never a closing');
  assert.equal(w.t.rows[0].responses[0].text, 'Je vous envoie cela demain.');
  assert.equal(w.t.rows[0].request.thread_id, 'T1');
  // Nothing new: nothing done twice.
  assert.equal((await P.syncReplies('org', M, w.d)).replies, 0);
  w.thread.push(gmailMsg('c-2', 'CFO <cfo@client.com>', '2026-10-20T09:00:00Z', 'Voici les pièces.', ['Grand livre fournisseurs 2025.pdf', 'Factures fournisseurs.pdf']));
  r = await P.syncReplies('org', M, w.d);
  assert.equal(r.replies, 1);
  const [gl, inv] = w.t.rows;
  assert.equal(gl.status, 'reply_received'); assert.match(gl.pieces[0].name, /Grand livre/);
  assert.equal(inv.status, 'reply_received'); assert.match(inv.pieces[0].name, /Factures/);
  assert.equal(w.stored.length, 2); assert.equal(w.received.length, 2, 'the pieces join the mission\'s documents, to be read');
  assert.ok(w.stored.every(s => s.name.startsWith('MAIL_2026-10-20_')), 'a name fixed by the message: a replay finds it');
  // Our own messages in the conversation are never replies.
  w.thread.push(gmailMsg('a-2', 'Agent <agent@cabinet.ci>', '2026-10-20T10:00:00Z', 'Merci'));
  assert.equal((await P.syncReplies('org', M, w.d)).replies, 0);
});

test('a piece whose name says nothing goes to « à trier » on every line of the conversation; the label scanner leaves these conversations alone', async () => {
  const w = await requested();
  w.thread.push(gmailMsg('c-3', 'CFO <cfo@client.com>', '2026-10-20T09:00:00Z', 'Ci-joint.', ['scan001.pdf']));
  await P.syncReplies('org', M, w.d);
  assert.ok(w.t.rows.every(x => x.status === 'reply_received' && !x.pieces.length && x.responses.at(-1).unassigned.length === 1));
  const followed = await P.waitingThreads('org', w.d.fetchRows);
  assert.ok(followed.threads.has('T1'));
});

// Security review (2026-10-19): only the people the request was sent to (or the mission's client contacts), with a mail Gmail
// did not flag, get a direct deposit; anyone else waits for a person of the mission.
test('a reply from an unknown sender, or failing authentication, is kept « à vérifier »: nothing deposited until a person accepts it', async () => {
  const w = await requested();
  w.thread.push(gmailMsg('x-1', 'Inconnu <attacker@evil.test>', '2026-10-20T08:00:00Z', 'Voici le grand livre.', ['Grand livre fournisseurs 2025.pdf']));
  const spoofed = gmailMsg('x-2', 'CFO <cfo@client.com>', '2026-10-20T08:30:00Z', 'Factures.', ['Factures fournisseurs.pdf']);
  spoofed.payload.headers.push({ name: 'Authentication-Results', value: 'mx.google.com; dmarc=fail header.from=client.com' });
  w.thread.push(spoofed);
  await P.syncReplies('org', M, w.d);
  assert.equal(w.stored.length, 0, 'nothing written to the Drive');
  assert.equal(w.received.length, 0, 'nothing given to the agents');
  const kept = w.t.rows[0].responses.filter(x => x.quarantined);
  assert.deepEqual(kept.map(x => x.gmail_id), ['x-1', 'x-2']);
  assert.match(kept[1].quarantine_reason, /Authentification/);
  assert.equal((await P.syncReplies('org', M, w.d)).replies, 0, 'not read again by itself');
  await assert.rejects(P.trustReply('org', M, { gmail_id: 'x-1' }, outsider, w.d), /NOT_ON_THIS_MISSION/);
  await P.trustReply('org', M, { gmail_id: 'x-1' }, manager, w.d);
  assert.equal(w.stored.length, 1, 'accepted by a person: deposited');
  const resp = w.t.rows[0].responses.find(x => x.gmail_id === 'x-1');
  assert.equal(resp.trusted_by, 'm@c.ci'); assert.ok(resp.processed);
  assert.equal(w.t.rows[0].responses.filter(x => x.gmail_id === 'x-1').length, 1, 'one entry per message');
});
