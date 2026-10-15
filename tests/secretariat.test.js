import test from 'node:test';
import assert from 'node:assert/strict';
import { approveDocument, recordSending, secretariatView, onTime, findSentMessage } from '../lib/secretariat.js';
import { TEMPLATES_FILE } from '../lib/doc-templates.js';

function world(doc, extra = {}) {
  const files = new Map([['TPL', { name: TEMPLATES_FILE, buf: Buffer.from(JSON.stringify({ templates: [], documents: [doc] })), mt: 't0' }]]); let n = 0;
  const drive = {
    findFilesByExactName: async name => [...files.entries()].filter(([, f]) => f.name === name).map(([id, f]) => ({ id, modifiedTime: f.mt })),
    downloadBuffer: async id => files.get(id).buf,
    createBinary: async ({ name, parentId, buffer }) => { const id = 'P' + (++n); files.set(id, { name, parent: parentId, buf: buffer, mt: 'c' }); return { id }; },
    updateBinary: async (id, { buffer }) => { files.get(id).buf = buffer; files.get(id).mt = 'u' + (++n); },
    getMeta: async id => ({ id, parents: ['OPPF'], modifiedTime: files.get(id)?.mt })
  };
  const seen = { events: [], opp: null, tender: null };
  return { files, seen, d: { drive, folder: 'MEM', audit: async () => ({}), emit: async (o, e) => { seen.events.push(e); },
    recordOpportunitySending: async (id, s) => { seen.opp = { id, ...s }; return { id, tender_id: 'T1' }; }, submittedBySecretariat: async (id, x) => { seen.tender = { id, ...x }; }, ...extra } };
}
const mi = () => ({ id: 'DOC-1', kind: 'mi', status: 'to_review', missing: [], by: 's@c.ci', word: { id: 'W1', name: 'MI_X.docx' }, pdf: { id: 'P0', name: 'MI_X.pdf' }, target: { kind: 'opportunity', id: 'o1', deadline: '2026-10-30' } });
const docOf = files => JSON.parse(files.get('TPL').buf).documents[0];
const sec = { role: 'secretary', email: 's@c.ci' }, partner = { role: 'partner', email: 'p@c.ci' };

test('approval by the right person before sending; an engagement letter is never approved by the one who prepared it', async () => {
  const { files, d } = world(mi());
  await assert.rejects(recordSending('org', { document_id: 'DOC-1', channel: 'plateforme' }, sec, d), /APPROVAL_FIRST/);
  await assert.rejects(approveDocument('org', { document_id: 'DOC-1' }, sec, d), /ROLE_NOT_ALLOWED/);
  await approveDocument('org', { document_id: 'DOC-1' }, { role: 'bdm', email: 'b@c.ci' }, d);
  assert.equal(docOf(files).status, 'approved');
  const lm = world({ ...mi(), kind: 'lettre_mission', by: 'p@c.ci' });
  await assert.rejects(approveDocument('org', { document_id: 'DOC-1' }, partner, lm.d), /NO_SELF_APPROVAL/);
  const todo = world({ ...mi(), missing: ['HONORAIRES'] });
  await assert.rejects(approveDocument('org', { document_id: 'DOC-1' }, partner, todo.d), /FIELDS_TO_COMPLETE/);
});

test('sent from the secretariat mailbox: the message found is the proof, its real date is compared with the deadline; Firm Manager and tender watch know', async () => {
  const { files, seen, d } = world({ ...mi(), status: 'approved' }, { mailbox: async () => 'secretariat@c.ci',
    gmailToken: async () => 'tok', fetchImpl: async url => ({ ok: true, json: async () => /messages\?/.test(url) ? { messages: [{ id: 'm1' }] } : { id: 'm1', threadId: 't1', internalDate: String(Date.parse('2026-10-31T09:00:00Z')), payload: { headers: [{ name: 'To', value: 'proc@bailleur.org' }] } } }) });
  const r = await recordSending('org', { document_id: 'DOC-1', channel: 'email_secretariat' }, sec, d);
  assert.equal(r.sending.status, 'sent'); assert.equal(r.sending.proof.message_id, 'm1'); assert.equal(r.sending.sent_at, '2026-10-31T09:00:00.000Z');
  assert.equal(r.sending.on_time, false, 'sent the day after the deadline');
  assert.equal(seen.opp.id, 'o1'); assert.deepEqual([seen.tender.id, seen.tender.on_time], ['T1', false]);
  assert.equal(seen.events[0].type, 'DOCUMENT_SENT'); assert.equal(seen.events[0].consumer, 'firm-manager');
  assert.equal(docOf(files).status, 'sent');
});

test('sent on the platform: the receipt is filed next to the document; without proof it stays « déclaré », never « envoyé »', async () => {
  const a = world({ ...mi(), status: 'approved' });
  const r = await recordSending('org', { document_id: 'DOC-1', channel: 'plateforme', sent_at: '2026-10-29', name: 'accuse.pdf', base64: Buffer.from('%PDF').toString('base64') }, sec, a.d);
  assert.equal(r.sending.status, 'sent'); assert.equal(r.sending.on_time, true);
  assert.equal([...a.files.values()].find(f => /^PREUVE_ENVOI_MI_X_accuse\.pdf$/.test(f.name)).parent, 'OPPF');
  const b = world({ ...mi(), status: 'approved' });
  assert.equal((await recordSending('org', { document_id: 'DOC-1', channel: 'plateforme' }, sec, b.d)).sending.status, 'declared');
  await assert.rejects(recordSending('org', { document_id: 'DOC-1', channel: 'plateforme' }, { role: 'auditor' }, b.d), /ROLE_NOT_ALLOWED/);
  assert.equal(onTime('2026-10-30T22:00:00Z', '2026-10-30'), true);
});

test('the secretariat sees the MI to prepare, nearest deadline first', async () => {
  const { d } = world(mi(), { listOpportunities: async () => ({ opportunities: [{ id: 'o2', title: 'B', status: 'go', deadline: '2026-12-01' }, { id: 'o3', title: 'C', status: 'go', deadline: '2026-11-01' }, { id: 'o4', status: 'stop' }] }) });
  const v = await secretariatView('org', sec, d);
  assert.deepEqual(v.mi_to_prepare.map(x => x.opportunity_id), ['o3', 'o2']); assert.equal(v.me.may_send, true);
});

test('secretariat next action follows the dossier, and a sent CV never hides an offer', async () => {
  const { d } = world({ ...mi(), kind: 'cv', status: 'sent', target: { kind: 'opportunity', id: 'offer' } }, {
    listOpportunities: async () => ({ opportunities: [
      { id: 'ami', status: 'go', kind: 'AMI' }, { id: 'offer', status: 'phase0', kind: 'DDP' },
      { id: 'waiting', status: 'go', commercial: { stage: 'mi_waiting', document_kind: null } },
      { id: 'awarded', status: 'won', commercial: { stage: 'awarded', document_kind: 'lettre_mission', label: 'Finaliser la lettre', href: '/secretariat.html?kind=lettre_mission' } }
    ] })
  });
  const v = await secretariatView('org', sec, d);
  assert.equal(v.document_queue.find(x => x.opportunity_id === 'ami').document_kind, 'mi');
  assert.equal(v.document_queue.find(x => x.opportunity_id === 'offer').document_kind, 'proposition');
  assert.equal(v.document_queue.some(x => x.opportunity_id === 'waiting'), false);
  assert.equal(v.document_queue.find(x => x.opportunity_id === 'awarded').document_kind, 'lettre_mission');
});
