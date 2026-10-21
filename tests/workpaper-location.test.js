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

test('a missing working paper is prepared only from a proven cabinet model; a legacy generic association does not count',async()=>{
  let prepared=0;const cycle={cycle_code:'C02_ACH',procedures:[{code:'ACH-01',active:true}]};
  const wp={cycle_code:'C02_ACH',file_id:'F1',status:'CREATED_FROM_MODEL',model:{id:'MODEL'},programme_version:1,active_codes:['ACH-01']};
  const fresh={id:'p1',version:1,cycles:[cycle],workpapers:[wp]};
  const fetchRows=async()=>[fresh];
  const r=await ensureCycleWorkpaper('org','m1',{...fresh,workpapers:[]},'C02_ACH',null,{fetchRows,prepare:async()=>{prepared++;return {folder:{id:'WP'}};}});
  assert.equal(prepared,1);assert.equal(r.workpaper.file_id,'F1');
  await ensureCycleWorkpaper('org','m1',fresh,'C02_ACH',null,{fetchRows,prepare:async()=>{prepared++;}});assert.equal(prepared,1);
  const legacy={...fresh,workpapers:[{cycle_code:'C02_ACH',file_id:'OLD',status:'CREATED'}]};
  const blocked=await ensureCycleWorkpaper('org','m1',legacy,'C02_ACH',null,{fetchRows:async()=>[legacy],prepare:async()=>({workpapers:[{cycle_code:'C02_ACH',status:'CABINET_MODEL_REQUIRED'}]})});assert.equal(blocked.workpaper,null);assert.equal(blocked.error,'CABINET_MODEL_REQUIRED');
});
