import test from 'node:test';
import assert from 'node:assert/strict';
import { newCopyState, copyStep, skipped } from '../lib/drive-copy.js';

const FOLDER = 'application/vnd.google-apps.folder';

function fakeDrive() {
  let n = 0;
  const nodes = [
    { id: 'A', name: '01_CLIENTS_ET_MISSIONS', mimeType: FOLDER, parent: 'SRC' },
    { id: 'A1', name: 'BLE_TRANSIT_AUDIT_2025', mimeType: FOLDER, parent: 'A' },
    { id: 'f1', name: 'PBC-03-02_Releve.pdf', mimeType: 'application/pdf', parent: 'A1' },
    { id: 'f2', name: 'Programme.docx', mimeType: 'application/msword', parent: 'A1' },
    { id: 'M', name: '00_TATY_AI_MANAGER', mimeType: FOLDER, parent: 'SRC' },
    { id: 'm1', name: 'OFFICE_MANAGER_MAP.xlsx', mimeType: 'x', parent: 'M' },
    { id: 'm2', name: 'OFFICE_MANAGER_REGISTER.xlsx', mimeType: 'x', parent: 'M' },
    { id: 'T', name: 'ENTRAINEMENT_AUDIT_OFFICE_MANAGER — 2026-10-07', mimeType: FOLDER, parent: 'SRC' },
    { id: 'S', name: 'raccourci', mimeType: 'application/vnd.google-apps.shortcut', parent: 'SRC' },
    { id: 'bad', name: 'formulaire', mimeType: 'application/vnd.google-apps.form', parent: 'SRC' },
    { id: 'r', name: 'TATY_Budget_Audit_EXEMPLE_2026.xlsx', mimeType: 'x', parent: 'SRC' }
  ];
  const writes = [];
  const api = {
    children: async id => nodes.filter(x => x.parent === id).map(({ id, name, mimeType }) => ({ id, name, mimeType })),
    createFolder: async (parent, name) => { const id = 'T' + (++n); writes.push({ op: 'folder', parent, name, id }); return { id, name }; },
    copyFile: async (fileId, parent, name) => {
      if (fileId === 'bad') throw new Error('GOOGLE_API_403: cannot copy forms');
      const id = 'T' + (++n); writes.push({ op: 'copy', fileId, parent, name, id }); return { id, name };
    }
  };
  return { api, writes };
}

test('identical copy: folders re-created, files copied in place; memory, training, shortcuts skipped; a failure does not stop the copy', async () => {
  const { api, writes } = fakeDrive();
  const state = newCopyState('SRC', 'TEST');
  const r = await copyStep(state, { api, canWrite: () => true });
  assert.equal(r.done, true);
  assert.deepEqual(writes.filter(w => w.op === 'folder').map(w => w.name).sort(), ['00_TATY_AI_MANAGER', '01_CLIENTS_ET_MISSIONS', 'BLE_TRANSIT_AUDIT_2025']);
  const ble = writes.find(w => w.name === 'BLE_TRANSIT_AUDIT_2025');
  assert.deepEqual(writes.filter(w => w.parent === ble.id).map(w => w.name).sort(), ['PBC-03-02_Releve.pdf', 'Programme.docx'], 'files land in the copied folder');
  assert.ok(writes.some(w => w.name === 'TATY_Budget_Audit_EXEMPLE_2026.xlsx' && w.parent === 'TEST'));
  assert.ok(!writes.some(w => /OFFICE_MANAGER_(MAP|REGISTER)|ENTRAINEMENT|raccourci/.test(w.name)));
  assert.deepEqual(state.skipped.map(s => s.why).sort(), ['entrainement_ou_temporaire', 'memoire_orpailleur', 'memoire_orpailleur', 'raccourci']);
  assert.equal(state.failed.length, 1);
  assert.ok(writes.every(w => w.parent !== 'SRC'), 'nothing is ever written in the source');
});

test('resumable: a run stopped by the time budget continues without copying anything twice', async () => {
  const { api, writes } = fakeDrive();
  const state = newCopyState('SRC', 'TEST');
  let t = 0; const now = () => (t += 10);
  let r = await copyStep(state, { api, canWrite: () => true, budgetMs: 25, now });
  assert.equal(r.more, true);
  const saved = JSON.parse(JSON.stringify(state)); // as stored between two serverless runs
  for (let i = 0; i < 20 && !saved.done; i++) { t = 0; r = await copyStep(saved, { api, canWrite: () => true, budgetMs: 25, now }); }
  assert.equal(saved.done, true);
  const names = writes.map(w => w.name);
  assert.equal(names.length, new Set(names).size, 'no duplicate');
  assert.equal(saved.copied, 3);
});

test('refuses: target = source, or no direct Google access', async () => {
  assert.throws(() => newCopyState('X', 'X'), /COPY_TARGET_IS_SOURCE/);
  await assert.rejects(copyStep(newCopyState('SRC', 'TEST'), { api: fakeDrive().api, canWrite: () => false }), /GOOGLE_DIRECT_ACCESS_REQUIRED/);
  assert.equal(skipped({ name: '~$fichier.xlsm' }), 'entrainement_ou_temporaire');
});
