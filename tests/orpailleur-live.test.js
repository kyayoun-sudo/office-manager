import test from 'node:test';
import assert from 'node:assert/strict';

const F = 'application/vnd.google-apps.folder';

test('Orpailleur reads the firm structure from its tree: TYPE / ANNÉE / CLIENT', async () => {
  const { firmStructure } = await import('../lib/tidy-plan.js');
  const items = [
    { id: 'a', name: 'AUDIT', mimeType: F, parents: ['D'], path: '/AUDIT' },
    { id: 'y1', name: '2024', mimeType: F, parents: ['a'], path: '/AUDIT/2024' },
    { id: 'y2', name: '2025', mimeType: F, parents: ['a'], path: '/AUDIT/2025' },
    { id: 'c1', name: 'Atlas Industries', mimeType: F, parents: ['y2'], path: '/AUDIT/2025/Atlas Industries' },
    { id: 'c2', name: 'BLE TRANSIT', mimeType: F, parents: ['y2'], path: '/AUDIT/2025/BLE TRANSIT' },
    { id: 'c3', name: 'BLE TRANSIT', mimeType: F, parents: ['y1'], path: '/AUDIT/2024/BLE TRANSIT' }
  ];
  const s = firmStructure(items);
  assert.match(s.pattern, /^TYPE DE MISSION \/ ANNÉE \/ CLIENT/);
  assert.ok(s.examples.some(e => e.startsWith('/AUDIT/2025/')));
});

test('Orpailleur memory: a file already decided is not looked at again unless modified', async () => {
  const { tidyCandidates } = await import('../lib/tidy-plan.js');
  const items = [
    { id: 'f1', name: 'GL.xlsx', mimeType: 'x', path: '/A/GL.xlsx', modifiedTime: '2026-10-01' },
    { id: 'f2', name: 'TB.xlsx', mimeType: 'x', path: '/A/TB.xlsx', modifiedTime: '2026-10-08' },
    { id: 'f3', name: 'new.pdf', mimeType: 'x', path: '/A/new.pdf', modifiedTime: '2026-10-08' },
    { id: 'm', name: 'OFFICE_MANAGER_TIDY_STATE.json', mimeType: 'x', path: '/00 TATY AI MANAGER/Atelier mémoire/OFFICE_MANAGER_TIDY_STATE.json' }
  ];
  const ids = tidyCandidates(items, { f1: '2026-10-01', f2: '2026-10-02' }).map(i => i.id).sort();
  assert.deepEqual(ids, ['f2', 'f3']);
});

test('Orpailleur continues an unfinished pass instead of starting again', async () => {
  const { startChangesPass, startTidyPlan } = await import('../lib/tidy-plan.js');
  const store = { 'OFFICE_MANAGER_TIDY_STATE.json': { status: 'failed', mode: 'changes', since: '2026-10-07T20:00:00Z', files: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], done: 1, total: 3, updated_at: '2026-10-08T08:00:00Z' } };
  const drive = {
    findFilesByExactName: async name => store[name] ? [{ id: name, modifiedTime: 't' }] : [],
    downloadBuffer: async id => Buffer.from(JSON.stringify(store[id])),
    getMeta: async () => ({ modifiedTime: 't' }),
    updateBinary: async (id, { buffer }) => { store[id] = JSON.parse(buffer.toString()); },
    createBinary: async ({ name, buffer }) => { store[name] = JSON.parse(buffer.toString()); return { id: name }; },
    changedSince: async () => { throw new Error('should not rebuild the list'); }
  };
  const fired = [];
  const r = await startChangesPass('org', {}, { drive, folder: 'om', fire: async (q, p) => fired.push(p) });
  assert.equal(r.resumed, true);
  assert.equal(store['OFFICE_MANAGER_TIDY_STATE.json'].status, 'planning');
  assert.equal(store['OFFICE_MANAGER_TIDY_STATE.json'].done, 1);
  assert.deepEqual(fired, ['/api/app?route=tidy-plan-step']);
  const r2 = await startTidyPlan('org', {}, { drive, folder: 'om', fire: async () => {} });
  assert.equal(r2.resumed, true);
});

test('an emptied folder goes to the bin after a move; the top folders and the memory are protected', async () => {
  const { executeDecision } = await import('../lib/action-executor.js');
  const binned = [];
  const td = { move: async () => ({}), findOrCreateFolder: async (p, n) => ({ id: p + '/' + n }), binEmptyFolder: async (id, o) => { if ((o.protect || []).includes(id)) return { binned: false }; binned.push(id); return { binned: true, name: 'Atlas Industries' }; } };
  const fetchRows = async path => path.includes('status=in.(proposed') ? [{ id: 'a1' }] : [];
  const r = await executeDecision('org', { id: 'a1', action_type: 'FILE_MOVE', payload: { file_id: 'f', from_parent: 'loose', to_parent: 'dest', to_name: 'AUDIT/2025/Atlas Industries' } }, 'approve', 'Paul', { fetchRows, tidyDrive: td });
  assert.equal(r.executed, true);
  assert.deepEqual(binned, ['loose']);
  assert.match(r.effect, /corbeille/);
});

test('a new mission folder follows the firm model: year created if missing, then CLIENT_TYPE_ANNEE with the model sub-folders', async () => {
  const { firmStructure } = await import('../lib/tidy-plan.js');
  const { executeDecision } = await import('../lib/action-executor.js');
  const items = [
    { id: 'a', name: '01_AUDIT', mimeType: F, parents: ['c'], path: '/01_CLIENTS_ET_MISSIONS/01_AUDIT' },
    { id: 'y5', name: '2025', mimeType: F, parents: ['a'], path: '/01_CLIENTS_ET_MISSIONS/01_AUDIT/2025' },
    { id: 'y6', name: '2026', mimeType: F, parents: ['a'], path: '/01_CLIENTS_ET_MISSIONS/01_AUDIT/2026' },
    { id: 'ble', name: 'BLE_TRANSIT_AUDIT_2025', mimeType: F, parents: ['y5'], path: '/01_CLIENTS_ET_MISSIONS/01_AUDIT/2025/BLE_TRANSIT_AUDIT_2025' },
    { id: 'mod', name: '00_MODELE_AUDIT_VALIDE_A_DUPLIQUER', mimeType: F, parents: ['y6'], path: '/01_CLIENTS_ET_MISSIONS/01_AUDIT/2026/00_MODELE_AUDIT_VALIDE_A_DUPLIQUER' },
    { id: 'm1', name: '02_DOSSIER_PERMANENT', mimeType: F, parents: ['mod'], path: '/x/02_DOSSIER_PERMANENT' },
    { id: 'm2', name: '04_PBC_MASTER_ET_DOCUMENTS_CLIENT', mimeType: F, parents: ['mod'], path: '/x/04_PBC' }
  ];
  const s = firmStructure(items);
  assert.ok(!s.examples.some(e => /MODELE/.test(e)));
  assert.deepEqual(s.models[0].subfolders, ['02_DOSSIER_PERMANENT', '04_PBC_MASTER_ET_DOCUMENTS_CLIENT']);
  const made = [];
  const td = { findOrCreateFolder: async (p, n) => { made.push(p + '/' + n); return { id: p + '/' + n }; }, move: async () => ({}), binEmptyFolder: async () => ({ binned: false }) };
  const fetchRows = async path => path.includes('status=in.(proposed') ? [{ id: 'a1' }] : [];
  await executeDecision('org', { id: 'a1', action_type: 'FILE_MOVE', payload: { file_id: 'f', from_parent: 'root', create: { parent_id: 'a', names: ['2027', 'NOVA_DISTRIBUTION_AUDIT_2027', '04_PBC_MASTER_ET_DOCUMENTS_CLIENT'], model_subfolders: s.models[0].subfolders } } }, 'approve', 'Paul', { fetchRows, tidyDrive: td });
  assert.ok(made.includes('a/2027/NOVA_DISTRIBUTION_AUDIT_2027/02_DOSSIER_PERMANENT'));
  assert.ok(!made.includes('a/2027/02_DOSSIER_PERMANENT'));
});
