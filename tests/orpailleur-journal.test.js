import test from 'node:test';
import assert from 'node:assert/strict';
import { noteFile, noteMisplaced, signals, passReport, closePass, journalSheets, JOURNAL } from '../lib/orpailleur-journal.js';

const F = 'application/vnd.google-apps.folder';
function storeDrive(store) {
  return {
    findFilesByExactName: async name => store[name] ? [{ id: name, modifiedTime: 't' }] : [],
    downloadBuffer: async id => Buffer.from(JSON.stringify(store[id])),
    getMeta: async () => ({ modifiedTime: 't' }),
    updateBinary: async (id, { buffer }) => { store[id] = JSON.parse(buffer.toString()); },
    createBinary: async ({ name, buffer }) => { store[name] = JSON.parse(buffer.toString()); return { id: name }; }
  };
}

test('découvert is not traité: each file keeps its step; an unfinished pass says PASSAGE INCOMPLET and why', () => {
  const st = { status: 'failed', error: 'time-out', total: 162, done: 40, asked: { a: { status: 'open', sent: false, send_error: 'gmail_send_403' } } };
  noteFile(st, { id: 'f1', name: 'GL.xlsx', path: '/A/GL.xlsx' }, 'découvert');
  noteFile(st, { id: 'f1' }, 'inspecté');
  assert.equal(st.states.f1.state, 'inspecté'); assert.equal(st.states.f1.name, 'GL.xlsx');
  const r = passReport(st);
  assert.equal(r.status, 'PASSAGE INCOMPLET');
  assert.ok(r.reasons.some(x => /122 fichier\(s\) encore à inspecter sur 162/.test(x)));
  assert.ok(r.reasons.some(x => /gmail_send_403/.test(x)));
  assert.ok(r.reasons.some(x => /réponse\(s\) humaine\(s\) attendue/.test(x)));
});

test('the same pass is written once in memory; misplaced documents become a signal for the Firm Manager', () => {
  const st = { status: 'done', started_at: 'T1', pass_started_at: 'T1', total: 3, done: 3 };
  closePass(st); closePass(st);
  assert.equal(st.passes.length, 1); assert.equal(st.passes[0].status, 'PASSAGE COMPLET');
  for (let i = 0; i < 3; i++) noteMisplaced(st, { doc_type: 'relevé bancaire' }, { path: '/01_CLIENTS_ET_MISSIONS/Scan' + '/r' + i + '.pdf' });
  assert.equal(signals(st)[0].count, 3);
  const sheets = journalSheets(st);
  assert.deepEqual(sheets.map(s => s.name), ['Passages', 'Fichiers', 'Questions', 'Doublons possibles', 'Signaux Firm Manager']);
  assert.equal(sheets[0].rows[1][4], 'PASSAGE COMPLET');
});

test('next pass: he reads his memory, works only on what changed after its hour, and rewrites his last pass + ONE Excel journal', async () => {
  const { startChangesPass, tidyPlanStep } = await import('../lib/tidy-plan.js');
  const store = {
    'OFFICE_MANAGER_SCAN_STATE.json': { items: [{ id: 'D1', name: 'BLE', mimeType: F, path: '/01/BLE' }], finished_at: '2026-10-01' },
    'OFFICE_MANAGER_TIDY_STATE.json': { status: 'done', mode: 'changes', last_pass_at: '2026-10-08T12:00:00Z', seen: { old: '2026-10-05' }, passes: [{ id: 'P0', status: 'PASSAGE COMPLET' }] }
  };
  let since = null; const journals = [];
  const d = { drive: storeDrive(store), folder: 'MEM', fire: async () => true, fetchRows: async () => [],
    changedSince: async s => { since = s; return [
      { id: 'old', name: 'old.pdf', mimeType: 'application/pdf', parents: ['D1'], modifiedTime: '2026-10-05' },
      { id: 'new', name: 'new.pdf', mimeType: 'application/pdf', parents: ['D1'], modifiedTime: '2026-10-08T15:00:00Z' },
      { id: 'tr', name: 'x.pdf', mimeType: 'application/pdf', parents: ['E'], modifiedTime: '2026-10-08T15:00:00Z', path: 'x' }]; },
    readText: async () => 'Relevé bancaire SGCI BLE TRANSIT décembre 2025 solde 12 450 000 FCFA',
    runAI: async () => ({ text: JSON.stringify({ decisions: [{ file_id: 'new', action: 'ok', pbc_role: 'EXACT', pbc_ref: 'PBC-03-02' }] }) }),
    writeJournal: async st => { journals.push(JSON.parse(JSON.stringify(st))); } };
  // The training file sits in an ENTRAINEMENT folder of the map.
  store['OFFICE_MANAGER_SCAN_STATE.json'].items.push({ id: 'E', name: 'ENTRAINEMENT_AUDIT_OFFICE_MANAGER', mimeType: F, path: '/ENTRAINEMENT_AUDIT_OFFICE_MANAGER' });
  const r = await startChangesPass('org', {}, d);
  assert.equal(since, '2026-10-08T12:00:00Z');
  assert.equal(r.files, 1);
  const st = await tidyPlanStep('org', {}, d);
  assert.equal(st.states.new.state, 'en place'); assert.match(st.states.new.note, /PBC-03-02/);
  assert.equal(st.passes.length, 2); assert.equal(st.passes[1].status, 'PASSAGE COMPLET');
  assert.equal(journals.length, 1);
  assert.ok(st.last_pass_at > '2026-10-08T12:00:00Z');
  assert.equal(JOURNAL, 'ORPAILLEUR_JOURNAL');
});

test('small memory in Supabase: the hour of the last pass is kept there; if the Drive memory was lost, he starts from it, not from zero', async () => {
  const { startChangesPass, tidyPlanStep } = await import('../lib/tidy-plan.js');
  const store = { 'OFFICE_MANAGER_SCAN_STATE.json': { items: [{ id: 'D1', name: 'BLE', mimeType: F, path: '/01/BLE' }], finished_at: '2026-09-01' } };
  const writes = [];
  let since = null;
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_agent_checkpoints') && o.method === 'POST') { writes.push(JSON.parse(o.body)[0]); return null; }
    if (path.startsWith('office_agent_checkpoints')) return [{ last_pass_at: '2026-10-08T20:00:00Z', status: 'PASSAGE COMPLET' }];
    return [];
  };
  const d = { drive: storeDrive(store), folder: 'MEM', fire: async () => true, fetchRows, writeJournal: async () => null,
    changedSince: async s => { since = s; return [{ id: 'n', name: 'n.pdf', mimeType: 'application/pdf', parents: ['D1'], modifiedTime: '2026-10-09T06:00:00Z' }]; },
    readText: async () => 'Relevé bancaire SGCI BLE TRANSIT décembre 2025 solde 12 450 000 FCFA',
    runAI: async () => ({ text: JSON.stringify({ decisions: [{ file_id: 'n', action: 'ok' }] }) }) };
  await startChangesPass('org', {}, d);
  assert.equal(since, '2026-10-08T20:00:00Z');
  const st = await tidyPlanStep('org', {}, d);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].agent_key, 'orpailleur'); assert.equal(writes[0].status, 'PASSAGE COMPLET');
  assert.equal(writes[0].last_pass_at, st.last_pass_at);
  assert.ok(JSON.stringify(writes[0]).length < 1500);
});
