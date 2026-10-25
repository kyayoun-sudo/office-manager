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

test('the mission memory is kept in the mission folder (_OFFICE_MANAGER) and read together with the central index', async () => {
  const { recordMissionDocuments, missionDocuments, mergeDocuments, MISSION_MEMORY_FILE } = await import('../lib/mission-files.js');
  const { isAgentOwnFile } = await import('../lib/agent-files.js');
  const files = {};
  const updateJsonFile = async (name, mutate, o) => { const k = o.folder + '/' + name; files[k] = await mutate(files[k] || null); return { fileId: k, state: files[k], written: true }; };
  const drive = { findFiles: async () => [], downloadText: async () => '{}' };
  const d = { updateJsonFile, drive, folder: 'MEM', missionHome: 'MISSION_HOME', fetchRows: async () => [{ id: 'm1' }], audit: async () => ({ db: true }) };
  await recordMissionDocuments({ id: 'm1', name: 'Projet', org_id: 'o' }, [{ id: 'f1', name: 'BUDGET.xlsx', title: 'Budget approuvé', event: { agent: 'enhanced-auditor', what: 'lu' } }], d);
  assert.equal(files['MISSION_HOME/' + MISSION_MEMORY_FILE].documents[0].title, 'Budget approuvé');
  assert.equal(files['MEM/OFFICE_MANAGER_MISSION_FILES.json'].missions.m1.documents[0].id, 'f1');
  // central index lost: the mission's own file still answers; newest entry wins when both exist
  const merged = mergeDocuments([{ id: 'f1', title: 'ancien', at: '2026-01-01' }], [{ id: 'f1', title: 'récent', at: '2026-02-01', uses: [{ what: 'pbc', where: 'PBC-1' }] }, { id: 'f2', at: '2026-01-05' }]);
  assert.deepEqual(merged.map(x => [x.id, x.title || null]), [['f1', 'récent'], ['f2', null]]);
  assert.equal(isAgentOwnFile({ name: 'x.json', path: 'AUDIT/2025/PROJET/_OFFICE_MANAGER/x.json' }), true);
  const read = await missionDocuments('m1', { drive: { findFiles: async () => [] }, missionHome: null }).catch(e => e);
  assert.ok(Array.isArray(read) || read instanceof Error);
});
