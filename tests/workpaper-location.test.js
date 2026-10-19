import test from 'node:test';
import assert from 'node:assert/strict';
import { findWorkpapersFolder, ensureCycleWorkpaper, WP_FOLDER_DEFAULT } from '../lib/cycle-workpapers.js';

const FOLDER = 'application/vnd.google-apps.folder';

test('no « Working Papers » folder under the mission: one is created there, instead of stopping', async () => {
  const made = [];
  const drive = { listChildren: async () => [{ id: 'x', name: '01_CORRESPONDANCE', mimeType: FOLDER }] };
  const f = await findWorkpapersFolder({ drive_folder_id: 'M' }, { materiality: {} }, drive, { findOrCreateFolder: async (p, n) => { made.push([p, n]); return { id: 'WP', name: n }; } });
  assert.equal(f.how, 'created'); assert.equal(f.id, 'WP'); assert.deepEqual(made, [['M', WP_FOLDER_DEFAULT]]);
  // An existing folder is found and kept; a pasted link still wins.
  const found = await findWorkpapersFolder({ drive_folder_id: 'M' }, { materiality: {} }, { listChildren: async () => [{ id: 'E', name: '05_WORKING_PAPERS_CYCLES', mimeType: FOLDER }] }, { findOrCreateFolder: async () => { throw new Error('must not create'); } });
  assert.equal(found.id, 'E');
  assert.equal((await findWorkpapersFolder({}, { materiality: { workpapers_folder: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWx' } }, drive)).how, 'pasted');
  // Only a mission with no known Drive folder still stops, with a clear reason.
  await assert.rejects(findWorkpapersFolder({}, { materiality: {} }, drive), /MISSION_FOLDER_NOT_KNOWN/);
});

test('a cycle with no working paper recorded gets one prepared, then the programme is read again', async () => {
  let prepared = 0;
  const programme = { id: 'p1', workpapers: [] };
  const fetchRows = async () => [{ id: 'p1', workpapers: [{ cycle_code: 'C02_ACH', file_id: 'F1', status: 'CREATED' }] }];
  const r = await ensureCycleWorkpaper('org', 'm1', programme, 'C02_ACH', { email: 'a@x' }, { fetchRows, prepare: async () => { prepared++; return { folder: { id: 'WP' } }; } });
  assert.equal(prepared, 1); assert.equal(r.workpaper.file_id, 'F1');
  // Already recorded: nothing is prepared again.
  const again = await ensureCycleWorkpaper('org', 'm1', { id: 'p1', workpapers: [{ cycle_code: 'C02_ACH', file_id: 'F1' }] }, 'C02_ACH', null, { fetchRows, prepare: async () => { prepared++; } });
  assert.equal(prepared, 1); assert.equal(again.workpaper.file_id, 'F1');
});
