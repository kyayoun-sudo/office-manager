import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickPreference, ruleMatch, contentRuleMatch, decideMode, parseAiDecisions, preferenceKeys, buildAiRequest } from '../lib/tidy-planner.js';
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
  const deps = { fetchRows, drive, read: async id => ({ supported: id === 'f1', text: id === 'f1' ? 'Synthetic Nova balance' : '' }), gate: async () => ({ allowed: true }), ai: async () => ({ text: '[]' }) };
  const s1 = await step('org-1', REQ, deps);
  assert.equal(s1.status, 'planning');
  assert.equal(s1.counts.content_read, 1);
  assert.equal(state.items.find(i => i.file_id === 'f1').mode, 'auto');
  assert.equal(state.items.find(i => i.file_id === 'f2').mode, 'needs_reading');
  const s2 = await step('org-1', REQ, deps);
  assert.equal(s2.status, 'executing');
  await step('org-1', REQ, deps);
  assert.deepEqual(moves, [['f1', 'F-inbox', 'F-nova-2025']]);
  assert.equal(state.items.find(i => i.file_id === 'f1').status, 'moved');
  assert.equal(state.items.find(i => i.file_id === 'f1').previous_parent_id, 'F-inbox', 'previous folder kept for undo');
  assert.ok(!calls.some(c => c.method === 'DELETE'));
  const final = await step('org-1', REQ, deps);
  assert.equal(final.status, 'ready', 'unread files must not be reported as completed');
  assert.equal(final.last_error, 'CONTENT_REVIEW_REQUIRED');
});

test('step: without the owner-reviewed mapping, nothing moves and the reason is shown', async () => {
  const state = { request: { id: REQ, status: 'executing', counts: {} }, files: [], items: [{ id: 'a1', file_id: 'f1', status: 'approved', dest_folder_id: 'F-nova', current_parent_id: 'F-inbox' }] };
  const { fetchRows } = fakeDb(state);
  const moves = [];
  const drive = { canWrite: () => true, move: async (...a) => moves.push(a.slice(0, 3)) };
  const r = await step('org-1', REQ, { fetchRows, drive, gate: async () => ({ allowed: false }) });
  assert.equal(r.last_error, 'MAPPING_REVIEW_REQUIRED');
  assert.equal(moves.length, 0);
  const r2 = await step('org-1', REQ, { fetchRows, drive: { canWrite: () => false }, gate: async () => ({ allowed: true }) });
  assert.equal(r2.last_error, 'DRIVE_WRITE_REQUIRES_DIRECT_ACCESS');
});

test('a broad client rule preserves the existing mission subfolder structure', () => {
  const file = { parent_id: 'F-working', folder_path: '/Clients/Nova Services/2025/Working papers/' };
  assert.equal(decideMode(file, { dest_folder_id: 'F-nova-2025', dest_path: 'Clients/Nova Services/2025', source: 'rule', confidence: 0.9 }, { gateAllowed: true }), 'in_place');
});

test('fresh reads are required even with inventory labels; default planning never calls paid AI or stores excerpts', async () => {
  const state = { request: { id: REQ, status: 'planning', counts: {} }, files: [
    { file_id: 'a', name: 'synthetic.docx', client_name: 'Nova Services', document_period: '2025', parent_id: 'F-inbox' },
    { file_id: 'b', name: 'synthetic.txt', parent_id: 'F-inbox' }
  ], items: [] };
  const { fetchRows, calls } = fakeDb(state);
  let aiCalls = 0;
  const result = await step('org-1', REQ, { fetchRows, gate: async () => ({ allowed: true }),
    aiEnabled: false, ai: async () => { aiCalls++; throw new Error('must not call'); },
    read: async id => { if (id === 'a') throw new Error('access denied'); return { supported: true, text: 'PRIVATE_SYNTHETIC_CONTENT' }; }
  });
  assert.equal(aiCalls, 0);
  assert.equal(result.counts.content_read, 1);
  assert.equal(state.items[0].mode, 'needs_reading');
  assert.equal(state.items[0].dest_folder_id, null);
  assert.equal(state.items[1].mode, 'unsure');
  assert.ok(!calls.some(c => String(c.body).includes('PRIVATE_SYNTHETIC_CONTENT')));
});

test('a stop during content reading prevents continuation and does not restart the request', async () => {
  const state = { request: { id: REQ, status: 'planning', counts: {} }, files: [{ file_id: 'a', name: 'synthetic.txt' }], items: [] };
  const { fetchRows } = fakeDb(state);
  const r = await step('org-1', REQ, { fetchRows, gate: async () => ({ allowed: false }),
    read: async () => { state.request.status = 'stopped'; return { supported: true, text: 'Synthetic' }; }
  });
  assert.equal(r.status, 'stopped');
  assert.equal(r.more, false);
  assert.equal(state.request.status, 'stopped');
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
  await undo('org-1', { item_id: IT }, { fetchRows, drive: { move: async (...a) => moves.push(a.slice(0, 3)) } });
  assert.deepEqual(moves[0], ['f9', 'F-nova', 'F-inbox']);
  assert.equal(state.items[0].status, 'undone');
  await assert.rejects(undo('org-1', { item_id: IT }, { fetchRows, drive: {} }), /NOT_UNDOABLE/);
  await assert.rejects(decide('org-1', { request_id: REQ, decision: 'delete', item_ids: [IT] }, { fetchRows }), /INVALID_DECISION/);
});

test('requests need instructions; background continuation targets the same app', async () => {
  await assert.rejects(createRequest('org-1', {}, { fetchRows: async () => [] }), /INSTRUCTIONS_REQUIRED/);
  let called = null;
  await continueInBackground({ headers: { host: 'app.example', 'x-forwarded-proto': 'https' } }, REQ, async (url, o) => { called = { url, body: JSON.parse(o.body) }; return { ok: true }; });
  assert.equal(called.url, 'https://app.example/api/app?route=tidy');
  assert.deepEqual(called.body, { action: 'step', request_id: REQ });
  assert.ok(ROUTES.tidy.GET && ROUTES.tidy.POST);
});

test('root discovery includes a document absent from inventory, reads it and proposes a content-backed template destination', async () => {
  let created = null;
  const request = await createRequest('org-1', { instructions: 'ranger' }, { driveId: 'ROOT',
    rootChildren: async () => [{ id: 'new-root-file', name: 'unclassified.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
    fetchRows: async (path, o) => { created = JSON.parse(o.body)[0]; return [{ id: REQ, ...created }]; }
  });
  assert.equal(request.counts.root_files[0].file_id, 'new-root-file');
  const state = { request, files: [], items: [] };
  const { fetchRows, calls } = fakeDb(state);
  const template = { file_id: 'F-template', name: '03_WORKING_PAPER_TEMPLATES', folder_path: '/Methods', parent_id: 'F-methods' };
  const db = async (path, o) => path.includes('is_folder=eq.true') ? [template] : fetchRows(path, o);
  const result = await step('org-1', REQ, { fetchRows: db, gate: async () => ({ allowed: true }),
    read: async () => ({ supported: true, text: 'Budget audit. Client fictif exemple, heures et honoraires.' }) });
  assert.equal(result.counts.root_cursor, 1);
  assert.equal(result.counts.cursor, null, 'root IDs must not skip inventory rows');
  assert.equal(state.items[0].mode, 'proposal');
  assert.equal(state.items[0].dest_folder_id, 'F-template');
  await step('org-1', REQ, { fetchRows: db });
  assert.ok(calls.some(c => c.path.includes('file_id=not.in.')));
  assert.equal(contentRuleMatch({ name: 'Budget Audit EXEMPLE.xlsx' }, [template]), null);
  assert.equal(contentRuleMatch({ excerpt: 'Budget audit client réel, heures et honoraires' }, [template]), null);
  assert.equal(contentRuleMatch({ excerpt: 'Budget audit exemple fictif heures' }, [template, { ...template, file_id: 'F-other' }]), null);
});

test('background dispatch retains its real promise and reports HTTP rejection', async () => {
  let held = null, finish;
  const promise = new Promise(resolve => { finish = resolve; });
  const accepted = await continueInBackground({ headers: { host: 'app.example' } }, REQ, () => promise, p => { held = p; });
  assert.equal(accepted, true);
  assert.ok(held instanceof Promise);
  finish({ ok: false });
  assert.equal(await held, false);
  assert.equal(await continueInBackground({ headers: { host: 'app.example' } }, REQ, async () => ({ ok: false })), false);
});

test('rangement page is part of the app and injects no HTML', () => {
  const src = readFileSync(new URL('../rangement.html', import.meta.url), 'utf8');
  assert.match(src, /\/assets\/brand-theme\.js/);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src));
});
