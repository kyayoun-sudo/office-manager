import ExcelJS from 'exceljs';
import {procedureView,patch} from './procedure-work.js';
import {driveAdapter} from './drive-adapter.js';
import {rest} from './supabase.js';
import {sopRevision} from './sop-document-work.js';

const fail=code=>Object.assign(new Error(code),{statusCode:409});
export function pendingConfirmation(view,step){
  return (view.work.walkthrough||[]).find(r=>r.kind==='sop-document-work'&&r.status==='applied'&&r.receipt&&r.confirmation?.status!=='confirmed'&&(step==null||r.step!==step));
}
export function dialogueRecords(view){
  return (view.work.walkthrough||[]).filter(r=>r.kind==='sop-document-work'&&r.receipt).map(r=>({
    plan_id:r.id,step:r.step,sheet:r.sheet,coverage:r.coverage,receipt:{...r.receipt,cells:r.receipt.cells.slice(0,20),cells_total:r.receipt.cells.length},confirmation:r.confirmation,
    editable:view.editable!==false&&!['submitted','reviewed'].includes(view.work.status),
    current:(view.card.steps||[]).filter(s=>!s.common).some((s,i)=>i+1===r.step&&sopRevision(view,{text:s.text||String(s)})===r.revision)
  }));
}
// Only this explicit human endpoint can confirm a receipt. The model has no such tool.
export async function reviewWorkpaper(orgId,missionId,code,body,account,d={}){
  const view=await (d.view||procedureView)(orgId,missionId,code,account,{...d,refreshSop:true});
  if(view.editable===false||['submitted','reviewed'].includes(view.work.status))throw fail('IN_REVIEW_OR_NOT_EDITABLE');
  const record=(view.work.walkthrough||[]).find(r=>r.id===body.plan_id&&r.kind==='sop-document-work'&&r.status==='applied'&&r.receipt);
  if(!record)throw fail('DOCUMENT_PLAN_NOT_FOUND');
  if(!dialogueRecords(view).find(r=>r.plan_id===record.id)?.current)throw fail('SOP_CHANGED_PREPARE_AGAIN');
  if(!account?.email)throw fail('HUMAN_IDENTITY_REQUIRED');
  if(!['confirm','request-correction','apply-correction'].includes(body.decision))throw fail('HUMAN_REVIEW_DECISION_REQUIRED');
  const note=String(body.note||'').trim().slice(0,4000);
  if(body.decision==='request-correction'&&!note)throw fail('CORRECTION_NOTE_REQUIRED');
  const drive=d.drive||driveAdapter;
  if(view.workpaper?.file_id!==record.file_id)throw fail('WORK_CHANGED_PREPARE_AGAIN');
  const meta=await drive.getMeta(record.file_id);
  if(meta.trashed||Number(meta.size)>20*1024*1024)throw fail('WORKBOOK_TOO_LARGE');
  const bytes=Buffer.from(await drive.downloadBuffer(record.file_id));
  if(/\.xlsm$/i.test(meta.name||'')||bytes.includes(Buffer.from('xl/vbaProject.bin')))throw fail('MACRO_WORKBOOK_WRITE_UNSUPPORTED');
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);
  // Confirmation refers to the actual saved values, never a stale screen or AI claim.
  for(const c of record.receipt.cells){const cell=wb.getWorksheet(c.sheet)?.getCell(c.cell);if(!cell||cell.formula||cell.value!==c.value)throw fail('WORK_CHANGED_PREPARE_AGAIN');}
  if(wb.getWorksheet(record.sheet)?.getCell('B4').value!==record.revision||!(record.findings||[]).every((f,i)=>wb.getWorksheet(record.sheet)?.getCell('D'+(i+9)).value===f.quote))throw fail('WORK_CHANGED_PREPARE_AGAIN');
  let receipt=structuredClone(record.receipt),edits=[];
  if(body.decision==='apply-correction'){
    if(!Array.isArray(body.edits)||!body.edits.length||body.edits.length>50)throw fail('CORRECTION_VALUES_REQUIRED');
    const keys=new Set();
    for(const edit of body.edits){
      const owned=receipt.cells.find(c=>c.sheet===edit.sheet&&c.cell===edit.cell),key=edit.sheet+'!'+edit.cell;
      if(!owned||keys.has(key)||typeof edit.value!=='string'||edit.value.length>4000)throw fail('CORRECTION_CELL_NOT_OWNED');
      keys.add(key);edits.push({sheet:owned.sheet,cell:owned.cell,before:owned.value,value:edit.value});
      wb.getWorksheet(owned.sheet).getCell(owned.cell).value=edit.value;owned.value=edit.value;
    }
    await drive.updateBinary(record.file_id,{buffer:Buffer.from(await wb.xlsx.writeBuffer()),mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',expectedModifiedTime:meta.modifiedTime});
    const check=new ExcelJS.Workbook();await check.xlsx.load(Buffer.from(await drive.downloadBuffer(record.file_id)));
    if(!edits.every(c=>check.getWorksheet(c.sheet)?.getCell(c.cell).value===c.value))throw fail('WORKPAPER_WRITE_NOT_VERIFIED');
  }
  const confirmation={status:body.decision==='confirm'?'confirmed':body.decision==='apply-correction'?'awaiting_confirmation':'correction_requested',by:account.email,at:new Date().toISOString(),note,edits};
  const changes={walkthrough:view.work.walkthrough.map(r=>r.id===record.id?{...r,receipt,confirmation,confirmation_history:[...(r.confirmation_history||[]),confirmation]}:r)};
  await (d.save||patch)(orgId,view.work,changes,account,d.fetchRows||rest);
  return {plan_id:record.id,confirmation,excel_written:edits.length>0,complete:false};
}
