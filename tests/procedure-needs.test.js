import test from 'node:test';
import assert from 'node:assert/strict';
import { aimOf, procedureNeeds, requestForNeeds, depositForNeed } from '../lib/procedure-needs.js';

const card = { code: 'ACH-01', title: 'Walkthrough achats', objective: 'Comprendre le processus achats', risk: 'Dépenses fictives', assertion: 'Réalité',
  sampling_mode: 'walkthrough', steps: [{ text: 'Suivre une facture du bon de commande au paiement' }, { text: 'Reporte dans le WP', common: true }], ask: ['Grand livre 2025', 'Procédure achats écrite'] };

test('the aim of a walkthrough is explained from the SOP card, without AI', () => {
  const a = aimOf(card, { sampling_mode: 'walkthrough' });
  assert.equal(a.objective, 'Comprendre le processus achats');
  assert.match(a.how, /UNE transaction réelle de bout en bout/);
  assert.deepEqual(a.steps, ['Suivre une facture du bon de commande au paiement']);
});

test('the documents the SOP asks for become lines of the mission register; missing ones are flagged; client contacts proposed', async () => {
  let ensured = null;
  const rows = [{ id: 'R1', document: 'Grand livre 2025', status: 'needed' }, { id: 'R2', document: 'Procédure achats écrite', status: 'to_confirm', pieces: [{ name: 'PROC.pdf' }] }];
  const loop = { periodOf: () => ({ label: 'Exercice 2025' }), PBC_STATUS: { needed: 'À demander', to_confirm: 'Pièce à confirmer' },
    ensureProcedureNeeds: async (o, m, x) => { ensured = ensured || x; return rows; }, findExisting: async () => ({}) };
  const r = await procedureNeeds('org', 'M', 'ACH-01', { email: 'a@x', role: 'auditor' }, {
    context: async () => ({ cycle: { cycle_code: 'C02' }, line: { code: 'ACH-01', sampling_mode: 'walkthrough' } }),
    methodology: async () => ({ sops: [{ procedures: [card] }] }), loop,
    fetchRows: async () => [{ id: 'M', period_label: '2025', client_contact_emails: ['dg@client.org'] }] });
  assert.deepEqual(ensured.documents, ['Grand livre 2025', 'Procédure achats écrite']);
  assert.deepEqual(r.items.map(i => [i.id, i.missing]), [['R1', true], ['R2', false]]);
  assert.deepEqual(r.contacts, ['dg@client.org']); assert.equal(r.may_send, false);
});

test('an auditor prepares the e-mail (a manager validates it); only a manager may send it at once', async () => {
  const calls = [];
  const loop = { draftRequest: async (o, m, b) => { calls.push(b); return { message_id: 'MSG', status: 'pending_approval', items: b.ids.length }; } };
  await requestForNeeds('org', 'M', 'ACH-01', { ids: ['R1'], to: ['dg@client.org'], send: true }, { email: 'a@x', role: 'auditor' }, { loop });
  await requestForNeeds('org', 'M', 'ACH-01', { ids: ['R1'], to: ['dg@client.org'], send: true }, { email: 'm@x', role: 'manager' }, { loop });
  assert.deepEqual(calls.map(c => c.send), [false, true]);
  await assert.rejects(requestForNeeds('org', 'M', 'ACH-01', { ids: [] }, { email: 'a@x', role: 'auditor' }, { loop }), /CHOOSE_DOCUMENTS/);
});

test('a document dropped in its zone goes into the mission pieces, is attached « à confirmer » and read by the agents', async () => {
  const seen = [];
  const quick = { uploadPiece: async (o, b) => { seen.push('upload:' + b.name); return { file_id: 'F1', name: b.name }; }, piecesReceived: async (o, req, b) => { seen.push('read:' + b.files[0].id); return {}; } };
  const loop = { attachPiece: async (o, m, b) => { seen.push('attach:' + b.id + ':' + b.file_id); return { id: b.id, status: 'to_confirm' }; } };
  const r = await depositForNeed('org', 'M', 'ACH-01', { id: 'R1', name: 'GL_2025.xlsx', base64: 'eA==' }, { email: 'a@x' }, {}, { quick, loop });
  assert.deepEqual(seen, ['upload:GL_2025.xlsx', 'attach:R1:F1', 'read:F1']);
  assert.equal(r.status, 'to_confirm');
});

test('direct Drive uploads are checked before attaching; failed verification never registers a foreign file', async () => {
  const seen = [];
  const quick = { verifyReceivedPiece: async () => ({file_id:'F1',name:'verified.pdf'}),
    piecesReceived: async () => {seen.push('read');return {};}};
  const loop = {attachPiece:async(o,m,b)=>{seen.push(b.name);return {status:'to_confirm'};}};
  await depositForNeed('org','M','ACH-01',{id:'R1',file_id:'F1',name:'FORGED'},{email:'a@x'}, {}, {quick,loop});
  assert.deepEqual(seen,['verified.pdf','read']);
  quick.verifyReceivedPiece=async()=>{throw new Error('PIECE_NOT_VERIFIED');};
  await assert.rejects(depositForNeed('org','M','ACH-01',{id:'R1',file_id:'FOREIGN'},{email:'a@x'}, {}, {quick,loop}),/PIECE_NOT_VERIFIED/);
  assert.equal(seen.length,2);
});
