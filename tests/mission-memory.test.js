import test from 'node:test';
import assert from 'node:assert/strict';
import { noteMissionEvent, missionMemory } from '../lib/mission-files.js';

test('every agent writes to ONE mission memory: what the file is, where it is filed, what was done with it', async () => {
  let state = { missions: { m: { name: 'PAGFIC', documents: [{ id: 'f1', name: 'scan001.pdf', role: 'piece_recue' }] } } };
  const d = { fetchRows: async () => [{ id: 'm', name: 'PAGFIC' }], updateJsonFile: async (n, fn) => { state = fn(state); return { state, fileId: 'MEM' }; },
    loadJsonFile: null, drive: { findFilesByExactName: async () => [{ id: 'MEM' }], downloadBuffer: async () => Buffer.from(JSON.stringify(state)), getMeta: async () => ({ modifiedTime: 't' }) } };
  await noteMissionEvent('o', 'm', 'f1', { agent: 'mission-controller', what: 'lu, compris et renommé', detail: 'scan001.pdf → TABLEAU_BUDGETAIRE_PTBA_2023.pdf', name: 'TABLEAU_BUDGETAIRE_PTBA_2023.pdf', title: 'Tableau budgétaire PTBA 2023', type: 'Tableau budgétaire', period: '2023' }, d);
  await noteMissionEvent('o', 'm', 'f1', { agent: 'orpailleur', what: 'rangé', name: undefined, location: 'PAGFIC/03_BUDGET', folder_id: 'B' }, d);
  await noteMissionEvent('o', 'm', 'f1', { agent: 'enhanced-auditor', what: 'importé dans le working file', uses: [{ what: 'import', where: 'D2_BUDGET' }] }, d);
  const doc = state.missions.m.documents.find(x => x.id === 'f1');
  assert.equal(doc.name, 'TABLEAU_BUDGETAIRE_PTBA_2023.pdf');
  assert.equal(doc.title, 'Tableau budgétaire PTBA 2023');
  assert.equal(doc.location, 'PAGFIC/03_BUDGET');
  assert.equal(doc.role, 'piece_recue');                      // kept
  assert.deepEqual(doc.history.map(h => h.agent + ':' + h.what), ['mission-controller:lu, compris et renommé', 'orpailleur:rangé', 'enhanced-auditor:importé dans le working file']);
  assert.deepEqual(doc.uses, [{ what: 'import', where: 'D2_BUDGET' }]);
  const view = await missionMemory('m', { ...d, drive: { findFilesByExactName: async () => [{ id: 'MEM' }], downloadBuffer: async () => Buffer.from(JSON.stringify(state)), getMeta: async () => ({ modifiedTime: 't' }) }, folder: 'F' });
  assert.equal(view[0].location, 'PAGFIC/03_BUDGET');
});
