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
