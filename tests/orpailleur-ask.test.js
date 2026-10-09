import test from 'node:test';
import assert from 'node:assert/strict';
import { askMissing, checkAnswers, thankAfterVerified, whoToAsk } from '../lib/orpailleur-ask.js';

const F = 'application/vnd.google-apps.folder';
const members = [{ full_name: 'Yvan Kouassi', email: 'yvan@taty.info' }, { full_name: 'Awa Traoré', email: 'awa@taty.info' }];

test('generic REVIEW preserves the original file location and the question says so', async () => {
  const moves = [], mails = [];
  const record = await askMissing('org', { id: 'f', name: 'document.pdf', path: '/Personnel/document.pdf', parents: ['P'] },
    { known: 'Document personnel', missing: 'Destination souhaitée', question: 'Où le ranger ?' }, {}, {
      leaveInPlace: true, whoToAsk: async () => ({ email: 'owner@example.invalid' }),
      reviewFolderId: 'REV', tidyDrive: { move: async (...args) => moves.push(args) },
      proposeMessage: async (org, m) => { mails.push(m); return { id: 'draft' }; }, emit: async () => null
    });
  assert.deepEqual(moves, []); assert.equal(record.moved, null);
  assert.equal(record.file.from_parent, 'P');
  assert.match(mails[0].body, /reste à son emplacement actuel/);
  assert.doesNotMatch(mails[0].body, /Il attend dans 00_A_REVOIR_AGENT/);
});

function storeDrive(store) {
  return {
    findFilesByExactName: async name => store[name] ? [{ id: name, modifiedTime: 't' }] : [],
    downloadBuffer: async id => Buffer.from(JSON.stringify(store[id])),
    getMeta: async () => ({ modifiedTime: 't' }),
    updateBinary: async (id, { buffer }) => { store[id] = JSON.parse(buffer.toString()); },
    createBinary: async ({ name, buffer }) => { store[name] = JSON.parse(buffer.toString()); return { id: name }; }
  };
}

test('Orpailleur asks only what is missing, to the mission manager; the file waits in 00_A_REVOIR_AGENT; never twice', async () => {
  const fetchRows = async path => {
    if (path.startsWith('office_missions')) return [{ id: 'M1', name: 'BLE TRANSIT — Audit 2025' }];
    if (path.startsWith('office_mission_assignments')) return [{ staff_profile_id: 'S1', mission_role: 'Manager' }];
    if (path.startsWith('office_staff_profiles')) return [{ email: 'Awa@taty.info', full_name: 'Awa Traoré' }];
    return [];
  };
  const moved = [], mails = [], sent = [];
  const d = { fetchRows, members, reviewFolderId: 'REV', autoSend: true,
    tidyDrive: { canWrite: () => true, move: async (...a) => moved.push(a) },
    proposeMessage: async (org, m) => { mails.push(m); return { id: 'msg1', content_sha256: 'h' }; },
    decideMessage: async (org, b, who) => { sent.push([b, who]); return { status: 'sent' }; } };
  const st = {};
  const f = { id: 'f1', name: 'Contrat.pdf', parents: ['loose'], path: '/x/Contrat.pdf', by: 'paul@taty.info' };
  const r = await askMissing('org', f, { client: 'BLE TRANSIT', known: 'Le contrat appartient à BLE TRANSIT', missing: 'La section du programme de travail', question: 'À quelle section le rattacher ?' }, st, d);
  assert.equal(r.to, 'awa@taty.info'); assert.match(r.why, /manager/);
  assert.deepEqual(moved[0], ['f1', 'loose', 'REV', null]);
  assert.match(mails[0].body, /Ce que je sais déjà : Le contrat appartient à BLE TRANSIT/);
  assert.match(mails[0].body, /Ce qui me manque : La section du programme de travail/);
  assert.equal(r.sent, true); assert.equal(sent[0][1].role, 'owner');
  const again = await askMissing('org', f, { missing: 'x' }, st, d);
  assert.equal(again.skipped, 'ALREADY_ASKED'); assert.equal(mails.length, 1);
});

test('nobody outside the firm is asked: an external saver falls back to the referent (Yvan)', async () => {
  const w = await whoToAsk('org', { by: 'client@ble.ci' }, {}, { members, fetchRows: async () => [] });
  assert.deepEqual(w, { email: 'yvan@taty.info', why: 'référent documentaire' });
});

test('the reply is read: what it confirms is kept with its reference; the thank-you comes only after a verified filing', async () => {
  const st = { asked: { f1: { status: 'open', message_id: 'msg1', missing: 'client ?', to: 'yvan@taty.info', file: { name: 'Rappro.xlsx' } } } };
  const thread = { thread_id: 'T1', thread: [{ from_agent: true, gmail_id: 'G0', text: 'question' }, { from: 'Yvan <yvan@taty.info>', gmail_id: 'G1', date: '2026-10-08', text: 'Oui, c’est BLE TRANSIT, AFRILOG était une erreur.' }] };
  const out = await checkAnswers('org', st, { messageThread: async () => thread, ai: async () => ({ text: '{"answers_missing":true,"confirms":"Appartient à BLE TRANSIT ; la mention AFRILOG est une erreur."}' }) });
  assert.deepEqual(out, ['f1']);
  const a = st.asked.f1;
  assert.equal(a.status, 'answered'); assert.match(a.answer, /BLE TRANSIT/); assert.equal(a.answer_ref.gmail_id, 'G1'); assert.equal(a.provider_message_id, 'G0');
  const mails = [];
  await thankAfterVerified('org', a, 'Rangé, vérifié dans le Drive.', { proposeMessage: async (o, m) => { mails.push(m); return { id: 'm2' }; } });
  assert.match(mails[0].body, /Grâce à votre confirmation/); assert.equal(mails[0].reply_to, 'G0');
  assert.equal(a.status, 'resolved');
});

test('pass: an answered question brings its file back with the answer; filed automatically only if READ and sure; the helper thanked after verification', async () => {
  const { startChangesPass, tidyPlanStep } = await import('../lib/tidy-plan.js');
  const store = {
    'OFFICE_MANAGER_SCAN_STATE.json': { items: [{ id: 'D1', name: 'BLE_TRANSIT_AUDIT_2025', mimeType: F, path: '/01/BLE_TRANSIT_AUDIT_2025', parents: ['Y'] }], finished_at: '2026-10-01' },
    'OFFICE_MANAGER_TIDY_STATE.json': { status: 'done', mode: 'changes', last_pass_at: '2026-10-07T08:00:00Z',
      asked: { r1: { status: 'open', message_id: 'msg1', missing: 'client ?', to: 'yvan@taty.info', moved: { from: 'loose', to: 'REV' }, file: { id: 'r1', name: 'Rappro AFRILOG.xlsx', from_parent: 'loose' } } } }
  };
  const drive = storeDrive(store);
  let input = '';
  const decided = [], thanks = [];
  const d = { drive, folder: 'MEM', fire: async () => true, changedSince: async () => [], fetchRows: async (p, o = {}) => o.method === 'POST' ? [{ id: 'A1' }] : [],
    checkAnswers: async (org, s) => { s.asked.r1.status = 'answered'; s.asked.r1.answer = 'BLE TRANSIT (AFRILOG : erreur)'; s.asked.r1.answer_by = 'Yvan'; return ['r1']; },
    readText: async () => 'Rapprochement bancaire SGCI BLE TRANSIT décembre 2025, solde relevé 12 450 000, solde comptable 12 300 000',
    runAI: async o => { input = o.input; return { text: JSON.stringify({ decisions: [{ file_id: 'r1', action: 'move', to_folder_id: 'D1', confidence: 'haute', content_read: true }] }) }; },
    agentSettings: async () => ({ auto_filing: true }),
    recordDecision: async (org, b) => { decided.push(b); return { executed: true, verified: true, effect: 'Rangé. Vérifié dans le Drive.' }; },
    thankAfterVerified: async (org, a, effect) => { thanks.push([a.to, effect]); a.status = 'resolved'; } };
  const r = await startChangesPass('org', {}, d);
  assert.equal(r.files, 1);
  const st = await tidyPlanStep('org', {}, d);
  assert.match(input, /RÉPONSE HUMAINE OBTENUE \(Yvan.*BLE TRANSIT \(AFRILOG : erreur\)/);
  assert.equal(decided.length, 1); assert.equal(st.auto, 1);
  assert.deepEqual(thanks, [['yvan@taty.info', 'Rangé. Vérifié dans le Drive.']]);
});

test('not read = not sure: an unreadable file stays in « À valider » even if the AI says « haute »', async () => {
  const { startChangesPass, tidyPlanStep } = await import('../lib/tidy-plan.js');
  const store = { 'OFFICE_MANAGER_SCAN_STATE.json': { items: [{ id: 'D1', name: 'X', mimeType: F, path: '/X' }], finished_at: '2026-10-01' }, 'OFFICE_MANAGER_TIDY_STATE.json': { status: 'done', last_pass_at: '2026-10-07' } };
  const decided = [];
  const d = { drive: storeDrive(store), folder: 'MEM', fire: async () => true, fetchRows: async (p, o = {}) => o.method === 'POST' ? [{ id: 'A1' }] : [],
    changedSince: async () => [{ id: 's1', name: 'scan.pdf', mimeType: 'application/pdf', parents: ['loose'], modifiedTime: '2026-10-08' }],
    readText: async () => { throw new Error('image only'); },
    runAI: async () => ({ text: JSON.stringify({ decisions: [{ file_id: 's1', action: 'move', to_folder_id: 'D1', confidence: 'haute' }] }) }),
    agentSettings: async () => ({ auto_filing: true }), recordDecision: async (o, b) => { decided.push(b); return { executed: true }; } };
  await startChangesPass('org', {}, d);
  const st = await tidyPlanStep('org', {}, d);
  assert.equal(st.moves, 1); assert.equal(decided.length, 0);
});

test('same name at the destination: both versions kept, anomaly reported; the move is verified in Drive', async () => {
  const { executeDecision } = await import('../lib/action-executor.js');
  const moved = [];
  const td = { nameTaken: async (p, n) => p === 'dest' && n === 'GL.xlsx', move: async (...a) => moved.push(a), getFile: async () => ({ id: 'f', name: 'GL (version ' + new Date().toISOString().slice(0, 10) + ').xlsx', parents: ['dest'] }), binEmptyFolder: async () => ({ binned: false }) };
  const patches = [];
  const fetchRows = async (path, o = {}) => { if (o.method === 'PATCH') patches.push(JSON.parse(o.body)); return path.includes('status=in.(proposed') ? [{ id: 'a1' }] : []; };
  const r = await executeDecision('org', { id: 'a1', action_type: 'FILE_MOVE', payload: { file_id: 'f', file_name: 'GL.xlsx', from_parent: 'loose', to_parent: 'dest', to_name: '/dest' } }, 'approve', 'Paul', { fetchRows, tidyDrive: td });
  assert.match(moved[0][3], /^GL \(version \d{4}-\d\d-\d\d\)\.xlsx$/);
  assert.match(r.effect, /Anomalie/); assert.match(r.effect, /Vérifié dans le Drive/);
  assert.equal(r.verified, true); assert.ok(patches.some(p => p.verified_at));
});

test('the PBC master and the mission checklist are given to the Orpailleur', async () => {
  const { pbcContext } = await import('../lib/tidy-plan.js');
  const items = [
    { id: 'pm', name: 'TATY_PBC_MASTER_SYSCOHADA_ISA', mimeType: 'sheet', path: '/06_METHODES/TATY_PBC_MASTER_SYSCOHADA_ISA' },
    { id: 'ck', name: 'BLE_TRANSIT_AUDIT_2025_PBC_CHECKLIST', mimeType: 'sheet', path: '/01/BLE_TRANSIT_AUDIT_2025/BLE_TRANSIT_AUDIT_2025_PBC_CHECKLIST' },
    { id: 'ck2', name: 'NOVA_PBC_CHECKLIST', mimeType: 'sheet', path: '/01/NOVA/NOVA_PBC_CHECKLIST' }
  ];
  const t = await pbcContext(items, [{ path: '/01/BLE_TRANSIT_AUDIT_2025/04_PBC/x.pdf' }], async id => 'contenu ' + id);
  assert.match(t, /RÉFÉRENTIEL PBC DU CABINET.*contenu pm/s);
  assert.match(t, /contenu ck/); assert.doesNotMatch(t, /contenu ck2/);
});
