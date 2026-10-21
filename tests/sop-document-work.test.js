import {reviewWorkpaper,pendingConfirmation} from '../lib/workpaper-dialogue.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {prepareDocumentWork,runDocumentWork,workbookMap,writableCell} from '../lib/sop-document-work.js';
import {stepsView} from '../lib/step-runner.js';
import {currentProcedure} from '../lib/methodology.js';
import {makeDocx} from './helpers/make-docx.js';

async function fixture() {
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('PRJ-01');
  ws.getCell('A1').value='PRJ-01';ws.getCell('A10').value='Point à vérifier';ws.getCell('B10').value='Article de la convention';
  ws.getCell('C10').value='Conforme ?';ws.getCell('D10').value='Montant';
  for(const address of ['B11','C11','D11','B12'])ws.getCell(address).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFF00'}};
  ws.getCell('B11').fill.fgColor.argb='FFFFF7CC';
  ws.getCell('D11').value={formula:'1+2',result:3};ws.getCell('B12').value='Saisie humaine';
  let bytes=Buffer.from(await wb.xlsx.writeBuffer()),updates=0,aiCalls=0,sourceText='Article 4 : Le bailleur du projet est la Banque Exemple.';
  const view={mission_id:'M',editable:true,line:{code:'PRJ-01'},card:{objective:'Comprendre la convention',steps:[{text:'Identifier le bailleur.'}],ask:['Convention']},
    workpaper:{file_id:'WP'},work:{id:'WORK',status:'to_do',walkthrough:[]}};
  const step={n:1,text:'Identifier le bailleur.',source:'sop'};
  const d={view:async()=>view,sources:async()=>[{file_id:'DOC',name:'Convention.pdf',document:'Convention'}],
    loop:{listRequests:async()=>[{pieces:[{file_id:'DOC',name:'Convention.pdf'}]}]},missionDocuments:async()=>[],
    permissions:async()=>({granted:true}),fetchRows:async()=>[],audit:async()=>{},
    drive:{getMeta:async id=>({name:id==='WP'?'Working.xlsx':'Convention.pdf',modifiedTime:'v1',size:1000}),
      downloadBuffer:async()=>bytes,readText:async()=>({text:sourceText,truncated:false}),
      updateBinary:async(id,o)=>{assert.equal(o.expectedModifiedTime,'v1');bytes=o.buffer;updates++;}},
    save:async(o,row,changes)=>{Object.assign(view.work,changes);return view.work;},
    ai:async(_,options)=>{aiCalls++;assert.match(options.input,/Identifier le bailleur/);return {text:JSON.stringify({analysis_complete:true,summary:'Le bailleur est identifié dans l’article 4.',questions:['La convention est-elle complète ?'],findings:[
      {fact:'Banque Exemple',file_id:'DOC',quote:'Le bailleur du projet est la Banque Exemple.',reference:'Article 4',target:'PRJ-01!B11'},
      {fact:'PASS',file_id:'DOC',quote:'passage inventé absent du fichier',target:'PRJ-01!C11'}]})};}};
  return {view,step,d,getBytes:()=>bytes,updates:()=>updates,aiCalls:()=>aiCalls,setText:t=>{sourceText=t;}};
}

async function prepareReady(o,m,c,step,body,account,d){
  let r=await prepareDocumentWork(o,m,c,step,body,account,d);
  for(let n=0;r.pending&&n<100;n++)r=await prepareDocumentWork(o,m,c,step,{read_job:r.read_job},account,d);
  assert.equal(r.pending,undefined);return r;
}

test('literal donor proposal waits for a human click, then writes the name rather than its explanatory sentence',async()=>{
  const f=await fixture(),original=f.d.ai;
  f.d.ai=async(...args)=>{const r=await original(...args),data=JSON.parse(r.text);data.findings[0].value='Banque Exemple';data.findings[0].fact='Le bailleur identifié dans la convention est Banque Exemple.';return {text:JSON.stringify(data)};};
  const p=await prepareReady('O','M','PRJ-01',f.step,{}, {email:'human@test'},f.d);
  await assert.rejects(runDocumentWork('O','M','PRJ-01',{plan_id:p.plan_id},{email:'human@test'},f.d),/PROPOSAL_CONFIRMATION_REQUIRED/);
  assert.equal(f.updates(),0);
  const r=await runDocumentWork('O','M','PRJ-01',{plan_id:p.plan_id,confirm_proposals:true},{email:'human@test'},f.d);
  assert.equal(r.verified,true);const wb=new ExcelJS.Workbook();await wb.xlsx.load(f.getBytes());assert.equal(wb.getWorksheet('PRJ-01').getCell('B11').value,'Banque Exemple');
});

test('reads the current SOP and documents, checks quotes, writes permitted cells and preserves formulas and human values',async()=>{
  const f=await fixture(),p=await prepareReady('O','M','PRJ-01',f.step,{}, {},f.d);
  assert.equal(f.updates(),0);assert.equal(p.findings.length,1);assert.equal(p.findings[0].target,'PRJ-01!B11');
  assert.ok(p.questions.some(q=>/écartée/.test(q)));
  const r=await runDocumentWork('O','M','PRJ-01',{plan_id:p.plan_id,findings:[{target:'C11',fact:'PASS'}]}, {},f.d);
  assert.equal(r.verified,true);assert.equal(r.cells,1);assert.equal(r.complete,false);
  const back=new ExcelJS.Workbook();await back.xlsx.load(f.getBytes());
  const ws=back.getWorksheet('PRJ-01');assert.equal(ws.getCell('B11').value,'Banque Exemple');assert.equal(ws.getCell('C11').value,null);
  assert.equal(ws.getCell('D11').formula,'1+2');assert.equal(ws.getCell('B12').value,'Saisie humaine');
  assert.equal(back.getWorksheet(r.sheet).getCell('D9').value,'Le bailleur du projet est la Banque Exemple.');
  await runDocumentWork('O','M','PRJ-01',{plan_id:p.plan_id},{},f.d);assert.equal(f.updates(),1,'no duplicate on retry');
});

test('a changed SOP invalidates an unexecuted plan and marks older work for review without deleting it',async()=>{
  const f=await fixture(),p=await prepareReady('O','M','PRJ-01',f.step,{}, {},f.d);
  f.view.card.steps=[{text:'Identifier aussi le cofinancement.'}];
  await assert.rejects(runDocumentWork('O','M','PRJ-01',{plan_id:p.plan_id},{},f.d),/SOP_CHANGED_PREPARE_AGAIN/);
  assert.equal(f.updates(),0);
  f.view.work.walkthrough[0].status='applied';f.view.work.walkthrough[0].sheet='Ancienne_preparation';
  const v=await stepsView('O','M','PRJ-01',{},f.d);
  assert.equal(v.steps[0].text,'Identifier aussi le cofinancement.');assert.equal(v.runs[0].stale,true);
  assert.equal(f.view.work.walkthrough[0].sheet,'Ancienne_preparation');
});

test('changed evidence, lost access, changed workbook and unknown plan ids stop all writing',async()=>{
  const f=await fixture(),p=await prepareReady('O','M','PRJ-01',f.step,{}, {},f.d);
  f.setText('Nouveau contenu de la convention, même métadonnée.');
  await assert.rejects(runDocumentWork('O','M','PRJ-01',{plan_id:p.plan_id},{},f.d),/DOCUMENT_SOURCE_CHANGED/);
  await assert.rejects(runDocumentWork('O','M','PRJ-01',{plan_id:'forged'},{},f.d),/DOCUMENT_PLAN_NOT_FOUND/);
  assert.equal(f.updates(),0);
  f.view.editable=false;
  await assert.rejects(prepareDocumentWork('O','M','PRJ-01',f.step,{}, {},f.d),/IN_REVIEW_OR_NOT_EDITABLE/);
});

test('no permission prevents document access and AI; unread documents are reported honestly',async()=>{
  const f=await fixture();f.d.permissions=async()=>({granted:false});
  await assert.rejects(prepareDocumentWork('O','M','PRJ-01',f.step,{}, {},f.d),/AGENTS_NOT_AUTHORIZED/);assert.equal(f.aiCalls(),0);
  f.d.permissions=async()=>({granted:true});f.d.drive.readText=async()=>({text:'',error_code:'TOO_LARGE'});
  const p=await prepareReady('O','M','PRJ-01',f.step,{}, {},f.d);
  assert.equal(p.ready,false);assert.equal(p.unread.length,1);assert.equal(f.aiCalls(),0);
});

test('input maps never offer formulas, decisions or occupied cells',async()=>{
  const f=await fixture(),wb=new ExcelJS.Workbook();await wb.xlsx.load(f.getBytes());
  const m=workbookMap(wb,'PRJ-01');assert.deepEqual(m.targets,['PRJ-01!B11']);
  assert.equal(writableCell(wb.getWorksheet('PRJ-01'),wb.getWorksheet('PRJ-01').getCell('C11')),false);
});

test('a changed Word source is reread from the programme-selected SOP, not another family with the same code',async()=>{
  const state={sops:[{file_id:'OTHER',procedures:[{code:'PRJ-01',objective:'Wrong family'}]},
    {file_id:'RIGHT',modified_time:'v1',procedures:[{code:'PRJ-01',objective:'Old'}]}]};
  const buffer=await makeDocx(['PRJ-01 - Test', {table:[['Objectif','New'],['Population / sélection','N/A | N/A | CORE | Niveau : Senior']]},
    'Ce qu’il faut demander','Convention','Pour chaque élément','Lire la clause nouvelle.']);
  const card=await currentProcedure(state,'PRJ-01','RIGHT',{drive:{getMeta:async()=>({modifiedTime:'v2'}),downloadBuffer:async id=>{assert.equal(id,'RIGHT');return buffer;}}});
  assert.equal(card.objective,'New');assert.equal(card.steps[0].text,'Lire la clause nouvelle.');
});


test('incremental reading checkpoints before analysis and removes temporary text at completion',async()=>{
  const f=await fixture();
  const first=await prepareDocumentWork('O','M','PRJ-01',f.step,{incremental:true},{},f.d);
  assert.equal(first.pending,true);assert.equal(first.read,0);assert.equal(f.aiCalls(),0);assert.equal(f.updates(),0);
  assert.equal(f.view.work.walkthrough[0].version,4);
  const final=await prepareReady('O','M','PRJ-01',f.step,{read_job:first.read_job},{},f.d);
  assert.equal(final.ready,true);assert.equal(f.aiCalls(),1);
  assert.equal(f.view.work.walkthrough.some(r=>r.kind==='sop-reading-job'),false);
  assert.equal('text' in f.view.work.walkthrough[0].sources[0],false);
});

test('a changed SOP blocks resuming an analysed-page checkpoint',async()=>{
  const f=await fixture();
  const p=await prepareDocumentWork('O','M','PRJ-01',f.step,{incremental:true},{},f.d);
  f.view.card.objective='SOP modifié';
  await assert.rejects(prepareDocumentWork('O','M','PRJ-01',f.step,{read_job:p.read_job},{},f.d),/SOP_CHANGED_PREPARE_AGAIN/);
});

test('a focused document read accepts only a source in this mission',async()=>{
  const f=await fixture();
  await assert.rejects(prepareDocumentWork('O','M','PRJ-01',f.step,{source_file_id:'OUTSIDE'},{},f.d),/DOCUMENT_SOURCE_CHANGED/);
  const r=await prepareDocumentWork('O','M','PRJ-01',f.step,{source_file_id:'DOC'},{},f.d);
  assert.equal(r.total,1);assert.equal(r.read,0);
});


test('verified writes expose actual cells; human confirms or corrects them without deciding the audit',async()=>{
  const f=await fixture(),p=await prepareReady('O','M','PRJ-01',f.step,{}, {},f.d);
  const written=await runDocumentWork('O','M','PRJ-01',{plan_id:p.plan_id},{},f.d);
  assert.equal(written.confirmation.status,'awaiting_confirmation');
  assert.equal(written.receipt.cells[0].cell,'B11');assert.equal(written.receipt.cells[0].value,'Banque Exemple');
  await assert.rejects(prepareDocumentWork('O','M','PRJ-01',f.step,{}, {},f.d),/HUMAN_CONFIRMATION_REQUIRED/);
  await assert.rejects(reviewWorkpaper('O','M','PRJ-01',{plan_id:p.plan_id,decision:'confirm'},{},f.d),/HUMAN_IDENTITY_REQUIRED/);
  const a={email:'auditeur@example.test'};
  await reviewWorkpaper('O','M','PRJ-01',{plan_id:p.plan_id,decision:'request-correction',note:'Préciser le bailleur'},a,f.d);
  assert.equal(pendingConfirmation(f.view).confirmation.status,'correction_requested');
  await assert.rejects(reviewWorkpaper('O','M','PRJ-01',{plan_id:p.plan_id,decision:'apply-correction',edits:[{sheet:'PRJ-01',cell:'D11',value:'123'}]},a,f.d),/CORRECTION_CELL_NOT_OWNED/);
  const corrected=await reviewWorkpaper('O','M','PRJ-01',{plan_id:p.plan_id,decision:'apply-correction',edits:[{sheet:'PRJ-01',cell:'B11',value:'Banque Exemple — bailleur principal'}]},a,f.d);
  assert.equal(corrected.excel_written,true);assert.equal(corrected.confirmation.status,'awaiting_confirmation');
  const back=new ExcelJS.Workbook();await back.xlsx.load(f.getBytes());assert.equal(back.getWorksheet('PRJ-01').getCell('D11').formula,'1+2');
  const confirmed=await reviewWorkpaper('O','M','PRJ-01',{plan_id:p.plan_id,decision:'confirm'},a,f.d);
  assert.equal(confirmed.confirmation.by,a.email);assert.equal(confirmed.complete,false);assert.equal(pendingConfirmation(f.view),undefined);
  assert.equal(f.view.work.walkthrough[0].confirmation_history.length,3);
});

test('human confirmation is refused after a workbook cell or the SOP changes',async()=>{
  const f=await fixture(),p=await prepareReady('O','M','PRJ-01',f.step,{}, {},f.d);
  await runDocumentWork('O','M','PRJ-01',{plan_id:p.plan_id},{},f.d);
  const back=new ExcelJS.Workbook();await back.xlsx.load(f.getBytes());back.getWorksheet('PRJ-01').getCell('B11').value='Autre saisie humaine';
  await f.d.drive.updateBinary('WP',{buffer:Buffer.from(await back.xlsx.writeBuffer()),expectedModifiedTime:'v1'});
  await assert.rejects(reviewWorkpaper('O','M','PRJ-01',{plan_id:p.plan_id,decision:'confirm'},{email:'auditeur@example.test'},f.d),/WORK_CHANGED_PREPARE_AGAIN/);
  f.view.card.steps=[{text:'Nouvelle exigence'}];
  await assert.rejects(reviewWorkpaper('O','M','PRJ-01',{plan_id:p.plan_id,decision:'confirm'},{email:'auditeur@example.test'},f.d),/SOP_CHANGED_PREPARE_AGAIN/);
});


test('supplemental common instructions do not block SOP inputs and writes stay in the current step row',async()=>{
  const f=await fixture();const w=new ExcelJS.Workbook();await w.xlsx.load(f.getBytes());const ws=w.getWorksheet('PRJ-01');
  ws.getCell('A11').value=1;ws.getCell('B11').value=null;ws.getCell('A13').value=2;ws.getCell('B13').value='Consigne commune supplémentaire';
  // stepsInSheet reads the text from column B, so use a separate input column for the fact.
  ws.getCell('B11').value='Identifier le bailleur.';ws.getCell('E10').value='Article';ws.getCell('E11').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFF00'}};
  ws.getCell('E13').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFF00'}};
  await f.d.drive.updateBinary('WP',{buffer:Buffer.from(await w.xlsx.writeBuffer()),expectedModifiedTime:'v1'});
  f.d.ai=async(order,args)=>{const input=JSON.parse(args.input);assert.ok(input.workbook.targets.includes('PRJ-01!E11'));assert.equal(input.workbook.targets.includes('PRJ-01!E13'),false);return {text:JSON.stringify({analysis_complete:true,summary:'Bailleur identifié.',questions:[],findings:[{fact:'Banque Exemple',file_id:'DOC',quote:'Le bailleur du projet est la Banque Exemple.',target:'PRJ-01!E11'}]})};};
  const p=await prepareReady('O','M','PRJ-01',f.step,{}, {},f.d);assert.equal(p.findings[0].target,'PRJ-01!E11');
});
