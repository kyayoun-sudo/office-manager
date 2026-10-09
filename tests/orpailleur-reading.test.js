import test from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { extractPdfText } from '../lib/pdf-reading.js';
import { readForTidy, textOf } from '../lib/tidy-plan.js';

const pdfBuffer = pages => new Promise(resolve => {
  const doc = new PDFDocument({ autoFirstPage: false }); const chunks = [];
  doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
  for (const p of pages) { doc.addPage(); if (p) doc.text(p); }
  doc.end();
});

test('a real PDF with text is read natively (not from its name)', async () => {
  const buf = await pdfBuffer(['Relevé bancaire SGCI — BLE TRANSIT — décembre 2025. Solde au 31/12/2025 : 12 450 000 FCFA. Compte n° 0123456789.']);
  const r = await extractPdfText(buf, { limit: 5000 });
  assert.equal(r.scanned, false); assert.equal(r.extractor, 'unpdf-text');
  assert.match(r.text, /SGCI/); assert.match(r.text, /12\s450 000/); assert.equal(r.total_pages, 1);
});

test('a PDF without a text layer is reported as a scan, never guessed', async () => {
  const r = await extractPdfText(await pdfBuffer(['', '']), { limit: 5000 });
  assert.equal(r.scanned, true); assert.equal(r.text, '');
});

test('a long PDF: the first pages and the last ones, within the limit', async () => {
  const pages = Array.from({ length: 40 }, (_, i) => 'Contenu de la page ' + (i + 1) + ' '.repeat(10) + 'x'.repeat(60));
  const r = await extractPdfText(Buffer.from('x'), { limit: 100000, extract: async () => ({ totalPages: 40, pages }) });
  assert.deepEqual(r.pages_read, [1, 2, 3, 4, 5, 6, 39, 40]);
  assert.equal(r.truncated, true);
  assert.match(r.text, /PAGE 40\/40/);
});

test('reading never yields « [object Object] »: an unsupported file is « illisible »', async () => {
  assert.equal(textOf({ supported: false, reason: 'x' }), '');
  const r = await readForTidy({ id: 'f', name: 'a.bin', mimeType: 'application/octet-stream' }, async () => ({ supported: false }), {});
  assert.equal(r.text, '(illisible)'); assert.equal(r.method, 'aucun texte');
});

test('a scan is LOOKED AT by a vision model; when the budget is spent it waits for the next pass', async () => {
  const read = async () => ({ supported: true, scanned: true, text: '', extractor: 'pdf-scan' });
  const d = { fileForAI: async id => ({ id, visual: true, base64: 'AA', mimeType: 'application/pdf', name: 'scan.pdf' }),
    ai: async (p, o) => { assert.equal(o.files.length, 1); return { text: 'Facture n° F-2025-118 émise par SOTRA à BLE TRANSIT, 15/12/2025, montant 3 200 000 FCFA, cachet visible.' }; } };
  const budget = { left: 1 };
  const a = await readForTidy({ id: 's1', name: 'scan001.pdf', mimeType: 'application/pdf' }, read, d, budget);
  assert.equal(a.method, 'vision'); assert.match(a.text, /F-2025-118/);
  const b = await readForTidy({ id: 's2', name: 'scan002.pdf', mimeType: 'application/pdf' }, read, d, budget);
  assert.equal(b.text, '(illisible)'); assert.match(b.method, /prochain passage/);
});

test('pass: a scan not yet looked at is not « seen »; it comes back at the next pass', async () => {
  const { startChangesPass, tidyPlanStep } = await import('../lib/tidy-plan.js');
  const F = 'application/vnd.google-apps.folder';
  const store = { 'OFFICE_MANAGER_SCAN_STATE.json': { items: [{ id: 'D1', name: 'X', mimeType: F, path: '/X' }], finished_at: '2026-10-01' }, 'OFFICE_MANAGER_TIDY_STATE.json': { status: 'done', last_pass_at: '2026-10-08' } };
  const drive = {
    findFilesByExactName: async name => store[name] ? [{ id: name, modifiedTime: 't' }] : [],
    downloadBuffer: async id => Buffer.from(JSON.stringify(store[id])), getMeta: async () => ({ modifiedTime: 't' }),
    updateBinary: async (id, { buffer }) => { store[id] = JSON.parse(buffer.toString()); },
    createBinary: async ({ name, buffer }) => { store[name] = JSON.parse(buffer.toString()); return { id: name }; }
  };
  let calls = 0;
  const d = { drive, folder: 'MEM', fire: async () => true, fetchRows: async () => [], writeJournal: async () => null, saveCheckpoint: async () => null, visionMax: 0,
    changedSince: async () => calls++ ? [] : [{ id: 'sc', name: 'scan.pdf', mimeType: 'application/pdf', parents: ['loose'], modifiedTime: '2026-10-09' }],
    readText: async () => ({ supported: true, scanned: true, text: '' }),
    runAI: async () => ({ text: JSON.stringify({ decisions: [{ file_id: 'sc', action: 'ask', missing: 'tout' }] }) }) };
  await startChangesPass('org', {}, d);
  let st = await tidyPlanStep('org', {}, d);
  assert.ok(st.pending_read.sc); assert.ok(!st.seen.sc);
  assert.ok(st.passes.at(-1).reasons.some(r => /pas encore regardé/.test(r)));
  assert.equal(st.passes.at(-1).status, 'PASSAGE INCOMPLET');
  const r = await startChangesPass('org', {}, d);
  assert.equal(r.files, 1);
});

const F2 = 'application/vnd.google-apps.folder';
const tree = [
  { id: 'aud', name: '01_AUDIT', mimeType: F2, path: '/01_CLIENTS_ET_MISSIONS/01_AUDIT' },
  { id: 'y25', name: '2025', mimeType: F2, path: '/01_CLIENTS_ET_MISSIONS/01_AUDIT/2025', parents: ['aud'] },
  { id: 'ble', name: 'BLE_TRANSIT_AUDIT_2025', mimeType: F2, path: '/01_CLIENTS_ET_MISSIONS/01_AUDIT/2025/BLE_TRANSIT_AUDIT_2025', parents: ['y25'] },
  { id: 'cons', name: '05_CONSEIL', mimeType: F2, path: '/01_CLIENTS_ET_MISSIONS/05_CONSEIL' },
  { id: 'tdr1', name: 'TDR_AO-2025-014.pdf', mimeType: 'application/pdf', md5Checksum: 'abc', path: '/03_APPELS_OFFRES/AO_2025_014/TDR_AO-2025-014.pdf', parents: ['ao14'] }
];

test('duplicate guard: same content (copy of the same TDR) → POSSIBLE DUPLICATE, nothing created', async () => {
  const { possibleDuplicate } = await import('../lib/tidy-plan.js');
  const d = possibleDuplicate({ id: 'copy', md5Checksum: 'abc' }, { client: 'Ministère', period: '2025' }, ['AO_2025_014_bis'], tree, {}, '/03_APPELS_OFFRES');
  assert.equal(d.kind, 'same_content'); assert.equal(d.existing_folder_id, 'ao14');
});

test('duplicate guard: the same reference written differently is recognised', async () => {
  const { possibleDuplicate, normRef } = await import('../lib/tidy-plan.js');
  const st = { references: { [normRef('AO n° 2025/014')]: { file_id: 'tdr1', file: 'TDR.pdf', target: '/03/AO_2025_014' } } };
  const d = possibleDuplicate({ id: 'v2' }, { reference: 'AO N°2025-014' }, ['AO 2025 014 v2'], [], st, '/03');
  assert.equal(d.kind, 'same_reference');
});

test('duplicate guard: a folder already exists for this client and period (same type), written differently', async () => {
  const { possibleDuplicate } = await import('../lib/tidy-plan.js');
  const d = possibleDuplicate({ id: 'n' }, { client: 'BLE Transit', period: 'exercice 2025' }, ['BLE TRANSIT 2025'], tree, {}, '/01_CLIENTS_ET_MISSIONS/01_AUDIT/2025');
  assert.equal(d.kind, 'existing_structure'); assert.equal(d.existing_folder_id, 'ble');
  // Another type of mission for the same client is not a duplicate.
  assert.equal(possibleDuplicate({ id: 'n' }, { client: 'BLE Transit', period: '2025' }, ['2025', 'BLE_TRANSIT_CONSEIL_2025'], tree, {}, '/01_CLIENTS_ET_MISSIONS/05_CONSEIL'), null);
  // A new client: creating is safe.
  assert.equal(possibleDuplicate({ id: 'n' }, { client: 'Nova Distribution', period: '2026' }, ['2026', 'NOVA_DISTRIBUTION_AUDIT_2026'], tree, {}, '/01_CLIENTS_ET_MISSIONS/01_AUDIT'), null);
});

test('in a pass: a duplicate is never created nor filed automatically; the existing folder is PROPOSED', async () => {
  const { startChangesPass, tidyPlanStep } = await import('../lib/tidy-plan.js');
  const store = { 'OFFICE_MANAGER_SCAN_STATE.json': { items: tree, finished_at: '2026-10-01' }, 'OFFICE_MANAGER_TIDY_STATE.json': { status: 'done', last_pass_at: '2026-10-08' } };
  const drive = {
    findFilesByExactName: async name => store[name] ? [{ id: name, modifiedTime: 't' }] : [],
    downloadBuffer: async id => Buffer.from(JSON.stringify(store[id])), getMeta: async () => ({ modifiedTime: 't' }),
    updateBinary: async (id, { buffer }) => { store[id] = JSON.parse(buffer.toString()); },
    createBinary: async ({ name, buffer }) => { store[name] = JSON.parse(buffer.toString()); return { id: name }; }
  };
  const queued = [], decided = [];
  const d = { drive, folder: 'MEM', fire: async () => true, writeJournal: async () => null, saveCheckpoint: async () => null,
    fetchRows: async (p, o = {}) => { if (o.method === 'POST' && p.startsWith('office_action_queue')) { queued.push(JSON.parse(o.body)[0]); return [{ id: 'A' + queued.length }]; } return []; },
    changedSince: async () => [{ id: 'lm', name: 'LM BLE.pdf', mimeType: 'application/pdf', parents: ['root'], modifiedTime: '2026-10-09' }],
    readText: async () => ({ supported: true, extractor: 'unpdf-text', text: 'Lettre de mission — audit des comptes 2025 de BLE TRANSIT SA, signée le 12/09/2025 par le Directeur général.' }),
    runAI: async () => ({ text: JSON.stringify({ decisions: [{ file_id: 'lm', action: 'create_and_move', create_parent_id: 'y25', create_names: ['BLE TRANSIT AUDIT 2025'], client: 'BLE TRANSIT', period: '2025', confidence: 'haute', content_read: true }] }) }),
    agentSettings: async () => ({ auto_filing: true }), recordDecision: async (o, b) => { decided.push(b); return { executed: true }; } };
  await startChangesPass('org', {}, d);
  const st = await tidyPlanStep('org', {}, d);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].payload.to_parent, 'ble'); assert.equal(queued[0].payload.create, undefined);
  assert.match(queued[0].summary, /POSSIBLE DUPLICATE — REVIEW REQUIRED/);
  assert.equal(decided.length, 0);
  assert.equal(st.states.lm.state, 'doublon possible — revue requise'); assert.ok(st.duplicates.lm);
});

test('no second brain: without the firm Drive the pass fails honestly and the old engine is not started', async () => {
  const { startPass } = await import('../lib/agent-passes.js');
  let old = 0;
  const fetchRows = async path => path.startsWith('office_agent_passes?on_conflict') ? [{ id: 'p1', agent_key: 'orpailleur', slot: '2026-10-09 08:00' }] : [];
  const r = await startPass('org', 'orpailleur', '2026-10-09 08:00', {}, { fetchRows, memoryHooks: null, startChangesPass: null,
    startDriveScan: async () => { old++; return true; }, createRequest: async () => { old++; return { id: 'x' }; }, fireInternal: async () => true });
  assert.match(r.failed, /FIRM_DRIVE_NOT_LOADED/); assert.equal(old, 0);
});

test('training material (ZZ_TEST_AGENT_PILOT…) is never tidied with production; Shadow lessons reach the tidy prompt', async () => {
  const { TRAINING, tidyCandidates } = await import('../lib/tidy-plan.js');
  assert.ok(TRAINING.test('/01_CLIENTS_ET_MISSIONS/01_AUDIT/2026/ZZ_TEST_AGENT_PILOT_AUDIT_2026/x.pdf'));
  assert.ok(!TRAINING.test('/01_CLIENTS_ET_MISSIONS/01_AUDIT/2025/BLE_TRANSIT_AUDIT_2025/x.pdf'));
  assert.equal(tidyCandidates([{ id: 'a', name: 'x.pdf', mimeType: 'application/pdf', path: '/01/ZZ_TEST_AGENT_PILOT_AUDIT_2026/x.pdf' }]).length, 0);
  const { startChangesPass, tidyPlanStep } = await import('../lib/tidy-plan.js');
  const store = { 'OFFICE_MANAGER_SCAN_STATE.json': { items: [], finished_at: '2026-10-01' }, 'OFFICE_MANAGER_TIDY_STATE.json': { status: 'done', last_pass_at: '2026-10-08' } };
  const drive = {
    findFilesByExactName: async name => store[name] ? [{ id: name, modifiedTime: 't' }] : [],
    downloadBuffer: async id => Buffer.from(JSON.stringify(store[id])), getMeta: async () => ({ modifiedTime: 't' }),
    updateBinary: async (id, { buffer }) => { store[id] = JSON.parse(buffer.toString()); },
    createBinary: async ({ name, buffer }) => { store[name] = JSON.parse(buffer.toString()); return { id: name }; }
  };
  let input = '';
  const d = { drive, folder: 'MEM', fire: async () => true, fetchRows: async () => [], writeJournal: async () => null, saveCheckpoint: async () => null,
    activeLessons: async () => ['Un relevé bancaire SGCI de BLE TRANSIT va dans 04_PBC… (mission BLE TRANSIT)'],
    changedSince: async () => [{ id: 'f', name: 'f.pdf', mimeType: 'application/pdf', parents: ['r'], modifiedTime: '2026-10-09' }],
    readText: async () => 'Relevé bancaire SGCI BLE TRANSIT décembre 2025 solde 12 450 000 FCFA',
    runAI: async o => { input = o.input; return { text: '{"decisions":[]}' }; } };
  await startChangesPass('org', {}, d);
  await tidyPlanStep('org', {}, d);
  assert.match(input, /LEÇONS APPRISES DE CORRECTIONS VALIDÉES[\s\S]*SGCI/);
});
