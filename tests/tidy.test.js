import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickPreference, ruleMatch, decideMode, parseAiDecisions, preferenceKeys, buildAiRequest } from '../lib/tidy-planner.js';
import { step, decide, undo, createRequest } from '../lib/tidy.js';
import { continueInBackground, ROUTES } from '../api/app.js';

const REQ = '66666666-6666-6666-6666-666666666666';
const IT = '77777777-7777-7777-7777-777777777777';
const folders = [
  { file_id: 'F-clients', name: 'Clients', folder_path: '', parent_id: 'root' },
  { file_id: 'F-nova', name: 'Nova Services', folder_path: 'Clients', parent_id: 'F-clients' },
  { file_id: 'F-nova-2025', name: '2025', folder_path: 'Clients/Nova Services', parent_id: 'F-nova' },
  { file_id: 'F-inbox', name: 'A trier', folder_path: '', parent_id: 'root' }
];

test('planner: an existing client folder with the year is found by rules', () => {
  const f = { file_id: 'x', name: 'balance.xlsx', client_name: 'Nova Services', document_period: '2025', parent_id: 'F-inbox' };
  const d = ruleMatch(f, folders);
  assert.equal(d.dest_folder_id, 'F-nova-2025');
  assert.equal(d.confidence, 0.9);
  assert.equal(ruleMatch({ name: 'x', client_name: '' }, folders), null);
});

test('planner: modes — auto only with reviewed mapping and high confidence', () => {
  const f = { parent_id: 'F-inbox', client_name: 'Nova' };
  assert.equal(decideMode(f, { dest_folder_id: 'F-nova', confidence: 0.9 }, { gateAllowed: true }), 'auto');
  assert.equal(decideMode(f, { dest_folder_id: 'F-nova', confidence: 0.9 }, { gateAllowed: false }), 'proposal');
  assert.equal(decideMode(f, { dest_folder_id: 'F-nova', confidence: 0.6 }, { gateAllowed: true }), 'proposal');
  assert.equal(decideMode(f, { new_folder_name: 'Nouveau', confidence: 0.95 }, { gateAllowed: true }), 'proposal', 'a new folder always needs validation');
  assert.equal(decideMode({ parent_id: 'F-nova' }, { dest_folder_id: 'F-nova', confidence: 0.9 }, { gateAllowed: true }), 'in_place');
  assert.equal(decideMode({ name: 'scan001.pdf' }, null, { gateAllowed: true }), 'needs_reading', 'never filed from the name alone');
});

test('planner: learned preferences need a real track record and an existing folder', () => {
  const f = { name: 'a.pdf', client_name: 'Nova' };
  const keys = preferenceKeys(f);
  assert.ok(keys.includes('client:nova'));
  assert.equal(pickPreference(f, [{ key: 'client:nova', dest_folder_id: 'F-nova', weight: 1 }]), null);
  const p = pickPreference(f, [{ key: 'client:nova', dest_folder_id: 'F-nova', weight: 3 }], new Set(['F-nova']));
  assert.equal(p.source, 'preference');
  assert.equal(pickPreference(f, [{ key: 'client:nova', dest_folder_id: 'GONE', weight: 9 }], new Set(['F-nova'])), null);
});

test('planner: AI answers are trusted only for known folders; prompt forbids filename-only decisions', () => {
  const files = [{ file_id: 'a' }, { file_id: 'b' }, { file_id: 'c' }];
  const text = 'Voici : [{"file_id":"a","folder_id":"F-nova","confidence":0.9,"rationale":"Contrat Nova"},' +
    '{"file_id":"b","folder_id":"INVENTED","confidence":0.99},' +
    '{"file_id":"c","new_folder_parent_id":"F-clients","new_folder_name":"Kobo/Res","confidence":0.95}]';
  const d = parseAiDecisions(text, folders, files);
  assert.equal(d.a.dest_folder_id, 'F-nova');
  assert.equal(d.b, undefined, 'unknown folder id from the AI is ignored');
  assert.equal(d.c.new_folder_name, 'Kobo-Res');
  assert.ok(d.c.confidence <= 0.8);
  assert.match(buildAiRequest([{ file_id: 'a', name: 'n' }], folders, '').instructions, /nom du fichier seul ne suffit jamais/);
  assert.deepEqual(parseAiDecisions('pas de json', folders, files), {});
});

function fakeDb(state) {
  const calls = [];
  const fetchRows = async (path, o = {}) => {
    const method = o.method || 'GET';
    calls.push({ path, method, body: o.body });
    if (path.startsWith('office_tidy_requests?') && method === 'GET') return [state.request];
    if (path.startsWith('office_tidy_requests?') && method === 'PATCH') { Object.assign(state.request, JSON.parse(o.body)); return []; }
    if (path.startsWith('orpailleur_inventory?') && path.includes('is_folder=eq.false')) return state.files.splice(0);
    if (path.startsWith('orpailleur_inventory?') && path.includes('is_folder=eq.true')) return folders.filter(f => !path.includes('file_id=eq.') || path.includes('file_id=eq.' + f.file_id));
    if (path.startsWith('office_tidy_preferences?') && method === 'GET') return state.prefs || [];
    if (path.startsWith('office_tidy_preferences?') && method === 'POST') { (state.learned ||= []).push(JSON.parse(o.body)[0]); return []; }
    if (path.startsWith('orpailleur_inspection_queue?')) return state.excerpts || [];
    if (path.startsWith('office_tidy_items?on_conflict') && method === 'POST') { state.items.push(...JSON.parse(o.body).map((r, i) => ({ id: 'i' + i, ...r }))); return []; }
    if (path.startsWith('office_tidy_items?') && method === 'PATCH') {
      const id = (path.match(/&id=eq\.([^&]+)/) || [])[1];
      const it = state.items.find(x => x.id === id);
      if (path.includes('status=eq.approved') && (!it || it.status !== 'approved' || it.error)) return [];
      if (it) Object.assign(it, JSON.parse(o.body));
      return it ? [it] : [];
    }
    if (path.startsWith('office_tidy_items?') && method === 'GET') {
      let rows = state.items;
      if (path.includes('status=eq.approved')) rows = rows.filter(r => r.status === 'approved' && !r.error);
      if (path.includes('status=eq.planned')) rows = rows.filter(r => r.status === 'planned');
      if (path.includes('&id=eq.')) rows = rows.filter(r => path.includes('&id=eq.' + r.id));
      if (path.includes('new_folder_name=eq.')) rows = [];
      return rows;
    }
    return [];
  };
  return { fetchRows, calls };
}

test('step: plans a batch, moves automatically only when allowed, never deletes', async () => {
  const state = {
    request: { id: REQ, org_id: 'org-1', status: 'planning', counts: {}, instructions: 'par client' },
    files: [
      { file_id: 'f1', name: 'balance.xlsx', client_name: 'Nova Services', document_period: '2025', parent_id: 'F-inbox', folder_path: 'A trier' },
      { file_id: 'f2', name: 'scan001.pdf', parent_id: 'F-inbox', folder_path: 'A trier' }
    ],
    items: []
  };
  const { fetchRows, calls } = fakeDb(state);
  const moves = [];
  const drive = { canWrite: () => true, move: async (id, from, to) => moves.push([id, from, to]), createFolder: async () => ({ id: 'NEW' }) };
  const deps = { fetchRows, drive, gate: async () => ({ allowed: true }), ai: async () => ({ text: '[]' }) };
  const s1 = await step('org-1', REQ, deps);
  assert.equal(s1.status, 'planning');
  assert.equal(state.items.find(i => i.file_id === 'f1').mode, 'auto');
  assert.equal(state.items.find(i => i.file_id === 'f2').mode, 'needs_reading');
  const s2 = await step('org-1', REQ, deps);
  assert.equal(s2.status, 'executing');
  await step('org-1', REQ, deps);
  assert.deepEqual(moves, [['f1', 'F-inbox', 'F-nova-2025']]);
  assert.equal(state.items.find(i => i.file_id === 'f1').status, 'moved');
  assert.equal(state.items.find(i => i.file_id === 'f1').previous_parent_id, 'F-inbox', 'previous folder kept for undo');
  assert.ok(!calls.some(c => c.method === 'DELETE'));
});

test('step: without the owner-reviewed mapping, nothing moves and the reason is shown', async () => {
  const state = { request: { id: REQ, status: 'executing', counts: {} }, files: [], items: [{ id: 'a1', file_id: 'f1', status: 'approved', dest_folder_id: 'F-nova', current_parent_id: 'F-inbox' }] };
  const { fetchRows } = fakeDb(state);
  const moves = [];
  const drive = { canWrite: () => true, move: async (...a) => moves.push(a) };
  const r = await step('org-1', REQ, { fetchRows, drive, gate: async () => ({ allowed: false }) });
  assert.equal(r.last_error, 'MAPPING_REVIEW_REQUIRED');
  assert.equal(moves.length, 0);
  const r2 = await step('org-1', REQ, { fetchRows, drive: { canWrite: () => false }, gate: async () => ({ allowed: true }) });
  assert.equal(r2.last_error, 'DRIVE_WRITE_REQUIRES_DIRECT_ACCESS');
});

test('decisions teach the Orpailleur; undo moves back and unlearns', async () => {
  const state = { request: { id: REQ, status: 'ready', counts: {} }, files: [], items: [
    { id: IT, file_id: 'f9', status: 'planned', mode: 'proposal', dest_folder_id: 'F-nova', dest_path: 'Clients/Nova Services', learn_keys: ['client:nova'] }
  ] };
  const { fetchRows } = fakeDb(state);
  await decide('org-1', { request_id: REQ, item_ids: [IT], decision: 'approve', decided_by: 'Paul' }, { fetchRows });
  assert.equal(state.items[0].status, 'approved');
  assert.equal(state.learned[0].weight, 1);
  assert.equal(state.request.status, 'executing');
  Object.assign(state.items[0], { status: 'moved', previous_parent_id: 'F-inbox' });
  const moves = [];
  await undo('org-1', { item_id: IT }, { fetchRows, drive: { move: async (...a) => moves.push(a) } });
  assert.deepEqual(moves[0], ['f9', 'F-nova', 'F-inbox', null], 'no rename to restore');
  assert.equal(state.items[0].status, 'undone');
  await assert.rejects(undo('org-1', { item_id: IT }, { fetchRows, drive: {} }), /NOT_UNDOABLE/);
  await assert.rejects(decide('org-1', { request_id: REQ, decision: 'delete', item_ids: [IT] }, { fetchRows }), /INVALID_DECISION/);
});

test('requests need instructions; background continuation targets the same app', async () => {
  await assert.rejects(createRequest('org-1', {}, { fetchRows: async () => [] }), /INSTRUCTIONS_REQUIRED/);
  let called = null;
  await continueInBackground({ headers: { host: 'app.example', 'x-forwarded-proto': 'https' } }, REQ, async (url, o) => { called = { url, body: JSON.parse(o.body) }; return {}; });
  assert.equal(called.url, 'https://app.example/api/app?route=tidy');
  assert.deepEqual(called.body, { action: 'step', request_id: REQ });
  assert.ok(ROUTES.tidy.GET && ROUTES.tidy.POST);
});

test('rangement page is part of the app and injects no HTML', () => {
  const src = readFileSync(new URL('../rangement.html', import.meta.url), 'utf8');
  assert.match(src, /\/assets\/brand-theme\.js/);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src));
});

// ---- Names contradicted by their content (real BLE TRANSIT names, 2026-10-07) ----
import { nameContradiction, monthsInName, monthsInContent, buildAiRequest as buildReq } from '../lib/tidy-planner.js';

test('contradiction: an August statement named "décembre N et janvier N+1" is flagged; correct names are not', () => {
  const aug = { name: 'PBC-03-02_Relevés bancaires de décembre N et janvier N+1 (tous comptes)_AOUT_2025_SGCI.pdf',
    excerpt: 'SOCIETE GENERALE CI - RELEVE DE COMPTE - Période du 01/08/2025 au 31/08/2025 - BLE TRANSIT' };
  const c = nameContradiction(aug);
  assert.deepEqual(c.extra.sort(), [1, 12]);
  assert.deepEqual(c.content, [8]);
  assert.match(c.message, /mentionne janvier, décembre, le document porte sur août/);
  assert.match(nameContradiction({ name: 'PBC-03-03_États de rapprochement bancaire au 31-12 (tous comptes), visés_AOUT_2025_SGCI.xlsx', excerpt: 'Etat de rapprochement au 31/08/2025' }).message, /décembre/);
  assert.equal(nameContradiction({ name: 'PBC-00-01_Balance générale définitive_2025_V01.xlsx', excerpt: 'Balance générale au 31/12/2025' }), null);
  assert.equal(nameContradiction({ name: 'Relevé SGCI août 2025.pdf', excerpt: 'Période du 01/08/2025 au 31/08/2025' }), null);
  assert.equal(nameContradiction({ name: aug.name, excerpt: null }), null, 'never from the name alone');
  assert.deepEqual([...monthsInName('PBC-03-02_x.pdf')], [], 'PBC codes are not dates');
  assert.deepEqual([...monthsInContent('Période du 01/11/2025 au 31/01/2026')].sort((a, b) => a - b), [1, 11, 12], 'periods across the year end');
});

test('contradiction: the renaming is only PROPOSED, and the AI is told what is wrong', () => {
  const file = { file_id: 'f', name: 'PBC-03-02_Relevés de décembre_AOUT_2025.pdf', parent_id: 'p', excerpt: 'Période du 01/08/2025 au 31/08/2025' };
  file.contradiction = nameContradiction(file);
  assert.equal(decideMode(file, { dest_folder_id: 'p', new_name: 'PBC-03-02_Relevé bancaire_AOUT_2025.pdf', confidence: 0.99 }, { gateAllowed: true }), 'proposal');
  const req = buildReq([file], [], '');
  assert.match(req.input, /ATTENTION : Nom contredit par le contenu/);
  assert.match(req.instructions, /CONTREDIT par le contenu/);
});
