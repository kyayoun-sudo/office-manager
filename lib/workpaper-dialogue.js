import ExcelJS from 'exceljs';
import {procedureView,patch} from './procedure-work.js';
import {driveAdapter} from './drive-adapter.js';
import {rest} from './supabase.js';
import {sopRevision} from './sop-document-work.js';
import {cellsPreview,cellsTotal,receiptCells} from './receipt-store.js';

const fail=code=>Object.assign(new Error(code),{statusCode:409});
// Same code as before (screens and tests read it), followed by the exact check that failed so the person sees why.
const changed=why=>Object.assign(new Error('WORK_CHANGED_PREPARE_AGAIN: '+why),{statusCode:409});
const show=v=>v==null?'(vide)':'« '+String(typeof v==='object'?JSON.stringify(v):v).slice(0,60)+' » ('+typeof v+')';
export function pendingConfirmation(view,step){
  const current=new Set(dialogueRecords(view).filter(r=>r.current).map(r=>r.plan_id));
  return (view.work.walkthrough||[]).find(r=>r.kind==='sop-document-work'&&r.status==='applied'&&current.has(r.id)&&r.confirmation?.status!=='confirmed'&&(step==null||r.step!==step));
}
export function dialogueRecords(view){
  return (view.work.walkthrough||[]).filter(r=>r.kind==='sop-document-work'&&r.receipt).map(r=>({
    plan_id:r.id,step:r.step,sheet:r.sheet,coverage:r.coverage,receipt:{...r.receipt,cells:cellsPreview(r.receipt),cells_total:cellsTotal(r.receipt),cells_preview:undefined},confirmation:r.confirmation,
    editable:view.editable!==false&&!['submitted','reviewed'].includes(view.work.status),
    current:r.file_id===view.workpaper?.file_id&&(view.card.steps||[]).filter(s=>!s.common).some((s,i)=>i+1===r.step&&sopRevision(view,{text:s.text||String(s)})===r.revision)
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
  if(view.workpaper?.file_id!==record.file_id)throw changed('le working file de la procédure n’est plus celui du compte rendu');
  const meta=await drive.getMeta(record.file_id);
  if(meta.trashed||Number(meta.size)>20*1024*1024)throw fail('WORKBOOK_TOO_LARGE');
  const bytes=Buffer.from(await drive.downloadBuffer(record.file_id));
  if(/\.xlsm$/i.test(meta.name||'')||bytes.includes(Buffer.from('xl/vbaProject.bin')))throw fail('MACRO_WORKBOOK_WRITE_UNSUPPORTED');
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);
  // Confirmation refers to the actual saved values, never a stale screen or AI claim.
  // The full list, from the row or from its Drive file (lib/receipt-store.js), checked by hash before it is trusted.
  const cells=await receiptCells(record.receipt,record.id,{...d,drive});
  for(const c of cells){
    const ws=wb.getWorksheet(c.sheet),cell=ws?.getCell(c.cell),found=cell&&(cell.value instanceof Date?cell.value.toISOString():cell.value);
    if(!ws)throw changed('la feuille « '+c.sheet+' » n’existe plus');
    if(cell.formula)throw changed(c.sheet+'!'+c.cell+' contient maintenant une formule');
    if(found!==c.value)throw changed(c.sheet+'!'+c.cell+' : enregistré '+show(c.value)+', trouvé dans le fichier '+show(found));
  }
  const log=wb.getWorksheet(record.sheet);
  if(!log)throw changed('la feuille de reçu « '+record.sheet+' » n’existe plus');
  if(log.getCell('B4').value!==record.revision)throw changed('la version du SOP écrite dans « '+record.sheet+' » (B4) a changé');
  const bad=(record.findings||[]).findIndex((f,i)=>log.getCell('D'+(i+9)).value!==f.quote);
  if(bad>=0)throw changed('le passage cité '+(bad+1)+' de « '+record.sheet+' » a changé');
  let receipt=structuredClone(record.receipt),edits=[];
  if(body.decision==='apply-correction'){
    // Corrected values change the list: it goes back inline, and a large one is stored again under a new hash (the old file stays).
    const {cells_ref,cell_sheets,cells_preview,...rest}=receipt;receipt={...rest,cells:structuredClone(cells)};
    if(!Array.isArray(body.edits)||!body.edits.length||body.edits.length>50)throw fail('CORRECTION_VALUES_REQUIRED');
    const keys=new Set();
    for(const edit of body.edits){
      const owned=receipt.cells.find(c=>c.sheet===edit.sheet&&c.cell===edit.cell),key=edit.sheet+'!'+edit.cell;
      if(!owned||owned.source_value||keys.has(key)||typeof edit.value!=='string'||edit.value.length>4000)throw fail('CORRECTION_CELL_NOT_OWNED');
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
