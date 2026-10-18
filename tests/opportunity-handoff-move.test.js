import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffOpportunityDocuments } from '../lib/mission-events.js';
const folder = 'application/vnd.google-apps.folder';
// Same world as opportunity-handoff.test.js, plus a Drive that can MOVE (same file id).
function world(count = 1) {
  const files = new Map([['root', { id: 'root', mimeType: folder, parents: [] }], ['opp', { id: 'opp', mimeType: folder, parents: [] }]]);
  for (let i = 0; i < count; i++) files.set('s' + String(i).padStart(4, '0'), { id: 's' + String(i).padStart(4, '0'), name: 'TDR ' + i + '.pdf', mimeType: 'application/pdf', modifiedTime: 'v1', parents: ['opp'] });
  const opportunity = { id: 'o', title: 'Mission A', folder: { id: 'opp', name: 'Mission A' }, workbook: { id: 's0000' } };
  const mission = { id: 'm', name: 'Mission A' }; let copies = 0, moves = 0; const registered = [], indexed = [];
  const d = { mode: 'move', documentReferences: async () => [{ document_type: 'mission_root', document_role: 'firm_reference', file_id: 'root' }],
    patchOpportunity: async p => Object.assign(opportunity, structuredClone(p)),
    fetchRows: async (path, opts) => { if (opts) mission.drive_folder_id = JSON.parse(opts.body).drive_folder_id; return []; },
    tidy: { findOrCreateFolder: async (parent, name) => { let found = [...files.values()].find(f => f.mimeType === folder && f.name === name && f.parents.includes(parent)); if (!found) { found = { id: 'dest', name, mimeType: folder, parents: [parent], webViewLink: 'https://drive.google.com/drive/folders/dest' }; files.set(found.id, found); } return found; } },
    moveFile: async (id, from, to) => { moves++; const f = files.get(id); f.parents = f.parents.filter(p => p !== from).concat(to); },
    recordMissionDocuments: async (m, docs) => registered.push(...docs),
    recordFiles: async (entries) => { indexed.push(...entries); },
    drive: { getMeta: async id => files.get(id), listChildren: async id => [...files.values()].filter(f => f.parents.includes(id)),
      findFilesByExactName: async (name, parent) => [...files.values()].filter(f => f.name === name && f.parents.includes(parent)),
      copyFile: async (id, name, parent) => { const f = { ...files.get(id), id: 'copy' + (++copies), parents: [parent] }; files.set(f.id, f); return f; } } };
  return { opportunity, mission, d, files, registered, indexed, copies: () => copies, moves: () => moves };
}

test('move mode: the document leaves the opportunity folder for the mission folder, same id, no copy, registered and protected from re-filing', async () => {
  const w = world();
  const r = await handoffOpportunityDocuments('org', w.opportunity, w.mission, w.d);
  assert.equal(r.status, 'complete'); assert.equal(r.mode, 'move'); assert.equal(r.moved, 1);
  assert.deepEqual(w.files.get('s0000').parents, ['dest']);
  assert.equal(w.copies(), 0);
  assert.equal(w.registered[0].role, 'acceptation');
  assert.equal(w.indexed[0].placed_by, 'mission-controller'); assert.equal(w.indexed[0].protected, true);
});

test('move mode: a retry moves nothing twice', async () => {
  const w = world();
  await handoffOpportunityDocuments('org', w.opportunity, w.mission, w.d);
  await handoffOpportunityDocuments('org', w.opportunity, w.mission, w.d);
  assert.equal(w.moves(), 1); assert.equal(w.registered.length, 1);
});

test('move mode: a same-name file already in the mission folder stops the transfer for review, nothing moved or overwritten', async () => {
  const w = world();
  await w.d.tidy.findOrCreateFolder('root', 'Mission A');
  w.files.set('other', { id: 'other', name: 'TDR 0.pdf', mimeType: 'application/pdf', parents: ['dest'] });
  const r = await handoffOpportunityDocuments('org', w.opportunity, w.mission, w.d);
  assert.equal(r.status, 'review_required'); assert.equal(w.moves(), 0);
  assert.deepEqual(w.files.get('s0000').parents, ['opp']);
});

test('move mode: a crash after the move but before registration is repaired on the next pass (registered once, not moved again)', async () => {
  const w = world(); let boom = true;
  const rec = w.d.recordMissionDocuments;
  w.d.recordMissionDocuments = async (m, docs) => { if (boom) { boom = false; throw new Error('CRASH'); } return rec(m, docs); };
  await assert.rejects(handoffOpportunityDocuments('org', w.opportunity, w.mission, w.d));
  assert.deepEqual(w.files.get('s0000').parents, ['dest']);
  const r = await handoffOpportunityDocuments('org', w.opportunity, w.mission, w.d);
  assert.equal(r.status, 'complete'); assert.equal(w.moves(), 1); assert.equal(w.registered.length, 1);
});

test('default mode is still the historical copy: originals stay, nothing is protected', async () => {
  const w = world(); delete w.d.mode;
  const r = await handoffOpportunityDocuments('org', w.opportunity, w.mission, w.d);
  assert.equal(r.status, 'complete'); assert.deepEqual(w.files.get('s0000').parents, ['opp']); assert.equal(w.copies(), 1); assert.equal(w.moves(), 0);
});
