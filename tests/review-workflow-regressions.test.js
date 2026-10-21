import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as P from '../lib/procedure-work.js';
import * as R from '../lib/procedure-review.js';
import { programmeView } from '../lib/work-programme.js';
import { buildCycleWorkpaper, prepareCycleWorkpapers } from '../lib/cycle-workpapers.js';
import { workContentHash } from '../lib/procedure-integrity.js';
import { prepareValues, TEMPLATES_FILE } from '../lib/doc-templates.js';
import { recordSending } from '../lib/secretariat.js';
import { submittedBySecretariat } from '../lib/tender-watch.js';

const M = '11111111-1111-1111-1111-111111111111';
const ali = { role: 'auditor', email: 'ali@c.ci' }, mia = { role: 'manager', email: 'mia@c.ci' }, outside = { role: 'manager', email: 'out@c.ci' };
async function world(count = 15) {
  const cycle = { cycle_code: 'ACH', cycle_title: 'Achats', preparer: ali.email, status: 'IN_SCOPE', procedures: [{ code: 'ACH-01', active: true, sampling_mode: 'exhaustive' }] };
  const programme = { id: 'p1', version: 1, status: 'validated', cycles: [cycle], reviews: { manager: true }, materiality: { workpapers_folder: 'WP_FOLDER_123456789012345' }, workpapers: [{ cycle_code: 'ACH', file_id: 'WP' }] };
  const work = { id: 'w1', programme_id: 'p1', procedure_code: 'ACH-01', status: 'in_progress', population: { file_id: 'POP', columns: { ref: 0, date: 1, party: 2, amount: 3 }, header_row: 0 }, sample: {}, items: [], conclusion: 'Conclusion retenue', reviews: [], review_points: [] };
  const files = new Map([['WP', { name: 'WP_ACH_Achats_Audit.xlsx', parent: 'WP_FOLDER_123456789012345', buf: await buildCycleWorkpaper({ mission: { id: M, name: 'Audit' }, programme, cycle, procedures: cycle.procedures }), mt: 'm0' }]]); let n = 0;
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_work_programmes')) { if (o.method === 'PATCH') Object.assign(programme, JSON.parse(o.body)); return [programme]; }
    if (path.startsWith('office_procedure_work')) { if(path.includes('status=in.(submitted,reviewed)'))return ['submitted','reviewed'].includes(work.status)?[work]:[]; if (o.method === 'PATCH') Object.assign(work, JSON.parse(o.body)); return [work]; }
    if (path.startsWith('office_missions')) return [{ id: M, name: 'Audit' }];
    if (path.startsWith('office_mission_assignments')) return [{ staff_profile_id: 'a', status: 'active' }, { staff_profile_id: 'm', status: 'active' }];
    if (path.startsWith('office_staff_profiles')) return [{ id: 'a', email: ali.email }, { id: 'm', email: mia.email }];
    return [];
  };
  const drive = {
    getMeta: async id => id === 'POP' ? { id, mimeType: 'application/vnd.google-apps.spreadsheet' } : { id, modifiedTime: files.get(id)?.mt, parents: [files.get(id)?.parent] },
    getValues: async () => [['Ref', 'Date', 'Tiers', 'Montant'], ...Array.from({ length: count }, (_, i) => ['F'+i, '2026-01-01', 'Client', 1])],
    downloadBuffer: async id => files.get(id).buf,
    updateBinary: async (id, { buffer }) => { files.get(id).buf = buffer; files.get(id).mt = 'm'+(++n); },
    findFilesByExactName: async (name, parent) => [...files.entries()].filter(([,f]) => f.name === name && f.parent === parent).map(([id,f]) => ({id,modifiedTime:f.mt})),
    createBinary: async ({name,parentId,buffer}) => { const id='new'+(++n);files.set(id,{name,parent:parentId,buf:buffer,mt:'new'});return {id}; }
  };
  return { work, programme, files, d: { fetchRows, drive, methodology: async () => ({ sops: [] }), audit: async () => {}, firmName: 'Cabinet' } };
}

test('unassigned staff cannot read a programme, edit a procedure, or see its review', async () => {
  const { d } = await world();
  await assert.rejects(programmeView('org', M, outside, d), /NOT_ON_THIS_MISSION/);
  await assert.rejects(P.saveConclusion('org', M, 'ACH-01', { conclusion: 'wrong' }, outside, d), /NOT_YOUR_PROCEDURE/);
  await assert.rejects(R.reviewView('org', M, 'ACH-01', outside, d), /NOT_ON_THIS_MISSION/);
  assert.equal((await programmeView('org', M, mia, d)).programme.id, 'p1');
});

test('reviewed work is immutable; corrections to returned work revoke old signatures and require sync', async () => {
  const { work, d } = await world();
  work.status = 'reviewed'; work.reviews = [{ kind:'signoff',level:'manager',bound:true,hash:'h' }];
  await assert.rejects(P.saveConclusion('org', M, 'ACH-01', { conclusion:'changed' }, ali, d), /IN_REVIEW_OR_REVIEWED/);
  await assert.rejects(P.drawSample('org', M, 'ACH-01', {}, mia, d), /IN_REVIEW_OR_REVIEWED/);
  work.status = 'returned';
  await P.saveConclusion('org', M, 'ACH-01', { conclusion:'corrected' }, ali, d);
  assert.equal(work.reviews[0].revoked, true); assert.equal(work.wp_sync.status, 'STALE');
  assert.equal(R.reviewState(work, { reviews:{manager:true} }).all_signed, false);
});

test('exhaustive selection retains every line and the Excel table grows before its footer', async () => {
  const { work, files, d } = await world(501);
  await P.drawSample('org', M, 'ACH-01', {}, ali, d);
  assert.equal(work.items.length, 501); assert.equal(work.sample.population_rows, 501);
  for (const item of work.items) Object.assign(item, { result:'PASS',evidence_ref:'archive/'+item.ref });
  await P.writeWorkpaper('org', M, 'ACH-01', ali, d);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(files.get('WP').buf);
  const ws=wb.getWorksheet('ACH-01'); let footer;
  ws.eachRow((row,n)=>{if(row.getCell(1).value==='Conclusion')footer=n;});
  assert.ok(footer > 501); assert.equal(ws.getRow(footer+1).getCell(1).value,work.conclusion);
  assert.equal(ws.getRow(footer).getCell(7).value,null); assert.deepEqual(work.wp_sync.conflicts,[]);
  assert.equal(work.wp_sync.verified,true); assert.equal(work.wp_sync.content_hash,workContentHash(work));
  await P.writeWorkpaper('org', M, 'ACH-01', ali, d);
  assert.deepEqual(work.wp_sync.conflicts,[], 'repeat writes preserve the footer and remain idempotent');
});

test('signoff rejects missing files, unsynced work and conflicting writes; current work signs normally', async () => {
  const { work, programme, d } = await world(1);
  work.status='submitted'; const wp=programme.workpapers;programme.workpapers=[];
  await assert.rejects(R.signOff('org',M,'ACH-01',mia,d),/NO_WORKPAPER_FOR_CYCLE/);
  programme.workpapers=wp;
  await assert.rejects(R.signOff('org',M,'ACH-01',mia,d),/WORKPAPER_SYNC_REQUIRED/);
  work.status='in_progress'; await P.drawSample('org',M,'ACH-01',{},ali,d);
  for(const item of work.items)Object.assign(item,{result:'PASS',evidence_ref:'archive'});
  await P.writeWorkpaper('org',M,'ACH-01',ali,d);work.status='submitted';
  work.wp_sync.conflicts=['F10'];await assert.rejects(R.signOff('org',M,'ACH-01',mia,d),/WORKPAPER_SYNC_REQUIRED/);work.wp_sync.conflicts=[];
  assert.equal((await R.signOff('org',M,'ACH-01',mia,d)).all_signed,true);
});

async function useCabinetModel(w) {
  const wb=new ExcelJS.Workbook();wb.addWorksheet('ACH-01').getCell('A1').value='MODELE CABINET';wb.addWorksheet('ACH-02').getCell('A1').value='ZONE DU MODELE';
  w.files.set('MODEL',{name:'Cabinet_Achats.xlsx',parent:'MODELS',buf:Buffer.from(await wb.xlsx.writeBuffer()),mt:'model-v1'});
  w.d.templatesFolder=async()=>({status:'KNOWN',folder_id:'MODELS'});w.d.listTemplateFiles=async()=>[{id:'MODEL',name:'Cabinet_Achats.xlsx'}];
  w.d.drive.copyFile=async(id,name,parent)=>{const key='copied'+w.files.size;w.files.set(key,{name,parent,buf:Buffer.from(w.files.get(id).buf),mt:'copy'});return {id:key};};
}
test('new programme versions receive new workbooks without overwriting the previous version', async () => {
  const w=await world();await useCabinetModel(w);const {programme,files,d}=w;programme.id='p2';programme.version=2;programme.workpapers=[];
  programme.cycles[0].procedures.push({code:'ACH-02',active:true});
  const r=await prepareCycleWorkpapers('org',M,mia,d);
  assert.equal(r.workpapers[0].status,'CREATED_FROM_MODEL');assert.match(r.workpapers[0].name,/_v2\.xlsx$/);
  assert.ok(files.has('WP'));
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(files.get(r.workpapers[0].file_id).buf);assert.ok(wb.getWorksheet('ACH-02'));
  assert.equal((await prepareCycleWorkpapers('org',M,mia,d)).workpapers[0].status,'ALREADY_EXISTS');
});

function memoryWorld(state) {
  const files=new Map([['mem',{name:TEMPLATES_FILE,buf:Buffer.from(JSON.stringify(state)),mt:'m0'}]]);let n=0;
  const drive={findFilesByExactName:async name=>[...files.entries()].filter(([,f])=>f.name===name).map(([id,f])=>({id,modifiedTime:f.mt})),downloadBuffer:async id=>files.get(id).buf,
    updateBinary:async(id,{buffer})=>{files.get(id).buf=buffer;files.get(id).mt='m'+(++n)},getMeta:async()=>({parents:['OPPF']}),
    createBinary:async({name,buffer})=>{const id='f'+(++n);files.set(id,{name,buf:buffer,mt:'new'});return{id}}};
  return {files,d:{drive,folder:'MEM',audit:async()=>{},emit:async()=>{},mailbox:async()=>null}};
}

test('template preparation stays manual and sends no context to AI when permission is absent', async () => {
  const {d}=memoryWorld({templates:[{id:'t1',kind:'mi',fields:[{key:'METHODE',label:'METHODE'}]}],documents:[]});let calls=0;
  const result=await prepareValues('org',{template_id:'t1',opportunity_id:'o1'},ali,{...d,permissions:async()=>({granted:false}),firmName:'Cabinet',getOpportunity:async()=>({id:'o1',summary:'confidential'}),ai:async()=>{calls++;return{text:'{}'}}}).catch(e=>e);
  // Use an authorised preparer; grant refusal affects only AI, not the manual workflow.
  const manual=await prepareValues('org',{template_id:'t1',opportunity_id:'o1'},mia,{...d,permissions:async()=>({granted:false}),firmName:'Cabinet',getOpportunity:async()=>({id:'o1',summary:'confidential'}),ai:async()=>{calls++;return{text:'{}'}}});
  assert.equal(result.message,'ROLE_NOT_ALLOWED');assert.equal(calls,0);assert.equal(manual.ai,'not_allowed');assert.equal(manual.fields[0].value,'');
});

test('an unproved declaration does not create a submission and can later be completed with proof', async () => {
  const {d}=memoryWorld({templates:[],documents:[{id:'doc1',kind:'mi',status:'approved',word:{id:'word',name:'MI.docx'},target:{kind:'opportunity',id:'o1'}}]});
  let submissions=0;const events=[];const deps={...d,emit:async(org,e)=>events.push(e),recordOpportunitySending:async()=>({tender_id:'t1'}),submittedBySecretariat:async()=>{submissions++}};
  const a=await recordSending('org',{document_id:'doc1',channel:'plateforme'}, {role:'secretary',email:'s@c.ci'},deps);
  assert.equal(a.sending.status,'declared');assert.equal(submissions,0);assert.equal(events[0].type,'DOCUMENT_SENT_DECLARED');
  assert.equal((await submittedBySecretariat('t1',{at:'2026-10-12',proof:null},{})).skipped,'SUBMISSION_PROOF_REQUIRED');
  const b=await recordSending('org',{document_id:'doc1',channel:'plateforme',base64:Buffer.from('receipt').toString('base64')},{role:'secretary',email:'s@c.ci'},deps);
  assert.equal(b.sending.status,'sent');assert.equal(submissions,1);assert.equal(events[1].type,'DOCUMENT_SENT');
});


test('editing the Excel after completed review invalidates it and returns the procedure for correction', async () => {
  const {work,files,d}=await world(1);await P.drawSample('org',M,'ACH-01',{},ali,d);
  for(const item of work.items)Object.assign(item,{result:'PASS',evidence_ref:'archive'});
  await P.writeWorkpaper('org',M,'ACH-01',ali,d);work.status='submitted';await R.signOff('org',M,'ACH-01',mia,d);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(files.get('WP').buf);wb.getWorksheet('ACH-01').getRow(1).getCell(2).value='changed';
  files.get('WP').buf=Buffer.from(await wb.xlsx.writeBuffer());
  const view=await R.reviewView('org',M,'ACH-01',mia,d);
  assert.equal(view.changed_after_signoff,true);assert.equal(view.all_signed,false);assert.equal(work.status,'returned');assert.equal(work.reviews[0].revoked,true);
  await P.saveConclusion('org',M,'ACH-01',{conclusion:'Correction'},ali,d);
});

test('legacy workbook associations pointing to an older programme are replaced by a separate version', async () => {
  const w=await world();await useCabinetModel(w);const {programme,files,d}=w;programme.version=2;programme.id='p2';programme.workpapers[0].name='WP_ACH_Achats_Audit.xlsx';
  const old=Buffer.from(files.get('WP').buf);
  const result=await prepareCycleWorkpapers('org',M,mia,d);
  assert.equal(result.workpapers[0].status,'CREATED_FROM_MODEL');assert.equal(result.workpapers[0].previous_file_id,'WP');assert.match(result.workpapers[0].name,/_v2\.xlsx$/);assert.ok(files.get('WP').buf.equals(old));
});
