import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildCycleWorkpaper, workpaperName, findWorkpapersFolder, prepareCycleWorkpapers, COMMON_COLUMNS } from '../lib/cycle-workpapers.js';

const M = '11111111-1111-1111-1111-111111111111';
const mission = { id: M, name: 'Projet Eau 2025', client_name: 'ONG Exemple', drive_folder_id: 'MISSIONFOLDER' };
const cycle = { sop_file_id: 'sopA', sop_file_name: 'C02_ACH.docx', cycle_code: 'ACH', cycle_title: 'Achats / Dépenses', status: 'IN_SCOPE', preparer: 'ali@c.ci',
  procedures: [{ code: 'ACH-03', title: 'Test de détail', type: 'CORE', active: true, sample_size: 25, sampling_mode: 'programme_sample' },
    { code: 'ACH-08', title: 'Doublons', type: 'RISK_DEPENDENT', active: true, justification: 'risque relevé', sampling_mode: 'risk_targeted' },
    { code: 'ACH-13', title: 'Option', type: 'OPTIONAL', active: false }] };
const programme = { id: 'p1', version: 2, status: 'validated', validated_by: 'mia@c.ci', validated_at: '2026-10-12T09:00:00Z', reviews: { senior: true, manager: true, partner: false },
  materiality: { overall: 12000000, performance: 9000000, trivial: 600000, currency: 'FCFA' }, cycles: [cycle, { ...cycle, cycle_code: 'PAY', cycle_title: 'Paie', status: 'N/A_JUSTIFIED', justification: 'pas de salariés' }] };
const LIB = { sops: [{ file_id: 'sopA', procedures: [{ code: 'ACH-03', objective: 'Dépenses réelles', wp_columns: ['Sample ID', 'Date', 'Fournisseur', 'Montant', 'PASS/EXCEPTION'], steps: [{ text: 'Retrouver la facture' }], conclusion_template: 'Travaux exécutés…' },
  { code: 'ACH-08', objective: 'Pas de doublon', steps: [] }] }] };

test('the cycle working paper: cover page with the required reviews, one sheet per active procedure, hidden AUDIT_META', async () => {
  const procs = cycle.procedures.filter(p => p.active).map(p => ({ ...LIB.sops[0].procedures.find(x => x.code === p.code), ...p }));
  const buf = await buildCycleWorkpaper({ firm: 'Cabinet Exemple', mission, programme, cycle, procedures: procs, by: 'mia@c.ci', now: new Date('2026-10-12T10:00:00Z') });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map(w => w.name), ['Page de garde', 'ACH-03', 'ACH-08', 'AUDIT_META']);
  const cover = wb.getWorksheet('Page de garde').getSheetValues().flat().map(String).join('|');
  assert.match(cover, /Revue Senior/); assert.match(cover, /Revue Manager/); assert.doesNotMatch(cover, /Revue Associé/, 'only the reviews this mission requires');
  assert.match(cover, /12\s000\s000 FCFA/);
  const s3 = wb.getWorksheet('ACH-03');
  const rows = s3.getSheetValues().map(r => (r || []).slice(1).map(v => v == null ? '' : String(v)));
  assert.ok(rows.some(r => r.join('|') === 'Sample ID|Date|Fournisseur|Montant|PASS/EXCEPTION'), 'the SOP columns');
  assert.ok(rows.some(r => r[0] === '25'), '25 numbered sample lines');
  assert.ok(rows.some(r => /Travaux exécutés/.test(r[0] || '')));
  const s8 = wb.getWorksheet('ACH-08').getSheetValues().map(r => (r || []).slice(1).join('|'));
  assert.ok(s8.includes(COMMON_COLUMNS.join('|')), 'no columns in the SOP: the 10 common ones');
  const meta = wb.getWorksheet('AUDIT_META');
  assert.equal(meta.state, 'veryHidden');
  assert.ok(meta.getSheetValues().some(r => r && r[1] === 'Programme_Version' && r[2] === 2));
  assert.equal(workpaperName(mission, cycle), 'WP_ACH_Achats_Depenses_Projet_Eau_2025.xlsx');
});

test('the working-papers folder: pasted in the programme, else found under the mission (its own name), else asked', async () => {
  const F = 'application/vnd.google-apps.folder';
  const drive = { listChildren: async id => id === 'MISSIONFOLDER' ? [{ id: 'a', name: '01_CORRESPONDANCE', mimeType: F }, { id: 'b', name: '05_WORKING_PAPERS_CYCLES_SELECTIONNES', mimeType: F }] : [] };
  assert.deepEqual(await findWorkpapersFolder(mission, programme, drive), { id: 'b', name: '05_WORKING_PAPERS_CYCLES_SELECTIONNES', how: 'found' });
  assert.equal((await findWorkpapersFolder(mission, { materiality: { workpapers_folder: 'PASTEDFOLDERXXXXXXXXXXXXX' } }, drive)).how, 'pasted');
  const nested = { listChildren: async id => id === 'MISSIONFOLDER' ? [{ id: 'a', name: 'Audit', mimeType: F }] : id === 'a' ? [{ id: 'c', name: 'Feuilles de travail', mimeType: F }] : [] };
  assert.equal((await findWorkpapersFolder(mission, programme, nested)).id, 'c');
  await assert.rejects(findWorkpapersFolder(mission, programme, { listChildren: async () => [] }), /WORKPAPERS_FOLDER_NOT_FOUND/);
});

test('without a registered cabinet model, no generated workbook is created and the missing model is explicit', async () => {
  let created=0,patched=null;
  const drive={listChildren:async()=>[{id:'wpf',name:'WORKING PAPERS',mimeType:'application/vnd.google-apps.folder'}],findFilesByExactName:async()=>[],createBinary:async()=>{created++;throw new Error('FORBIDDEN');}};
  const fetchRows=async(path,o={})=>{if(o.method==='PATCH'){patched=JSON.parse(o.body);return [];}return path.startsWith('office_missions')?[mission]:[programme];};
  const out=await prepareCycleWorkpapers('org',M,{email:'a@x'},{drive,fetchRows,methodology:async()=>LIB,audit:async()=>null,templatesFolder:async()=>({status:'NONE'})});
  assert.equal(created,0);assert.deepEqual(out.workpapers.map(x=>x.status),['CABINET_MODEL_REQUIRED']);assert.equal(patched.workpapers[0].file_id,undefined);
});
