import ExcelJS from 'exceljs';
import {createHash} from 'node:crypto';
import {procedureView,context} from './procedure-work.js';
import {templatesFolder,listTemplateFiles,scoreTemplate} from './workfile-templates.js';
import {driveAdapter} from './drive-adapter.js';
import {rest} from './supabase.js';
const fail=code=>Object.assign(new Error(code),{statusCode:409});
const fingerprint=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function templateOptions(orgId,missionId,code,account,d={}){
  const view=await (d.view||procedureView)(orgId,missionId,code,account,d);
  const folder=await (d.templatesFolder||templatesFolder)(orgId,d);
  if(folder.status!=='KNOWN')return {status:folder.status,question:folder.question,candidates:[]};
  const files=await (d.listTemplateFiles||listTemplateFiles)(folder.folder_id,d.drive||driveAdapter);
  return {status:'KNOWN',current:view.workpaper,candidates:files.map(f=>({file_id:f.id,name:f.name}))};
}
export async function inspectTemplate(orgId,missionId,code,body,account,d={}){
  const options=await templateOptions(orgId,missionId,code,account,d);
  if(!options.candidates.some(c=>c.file_id===body.template_id))throw fail('TEMPLATE_NOT_IN_REGISTERED_FOLDER');
  const drive=d.drive||driveAdapter,meta=await drive.getMeta(body.template_id);
  if(meta.trashed||Number(meta.size)>20*1024*1024||/\.xlsm$/i.test(meta.name||''))throw fail('TEMPLATE_NOT_SUPPORTED');
  const bytes=Buffer.from(await drive.downloadBuffer(body.template_id));if(bytes.includes(Buffer.from('xl/vbaProject.bin')))throw fail('TEMPLATE_NOT_SUPPORTED');
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);
  const sheet=wb.getWorksheet(code);if(!sheet)throw fail('PROCEDURE_SHEET_NOT_FOUND');
  const text=wb.worksheets.flatMap(ws=>ws.getSheetValues().slice(0,100).flatMap(row=>(row||[]).filter(v=>typeof v==='string'))).join('\n');
  if(!scoreTemplate(text,{procedures:[{code}]}).found.length)throw fail('PROCEDURE_SHEET_NOT_FOUND');
  return {file_id:meta.id||body.template_id,name:meta.name,version:meta.modifiedTime||null,fingerprint:fingerprint(bytes),sheets:wb.worksheets.map(ws=>({name:ws.name,rows:ws.rowCount})),procedure_sheet:sheet.name};
}

export async function adoptTemplate(orgId,missionId,code,body,account,d={}){
  const view=await (d.view||procedureView)(orgId,missionId,code,account,d);
  if(!['owner','partner','manager','supervisor'].includes(account?.role)||view.editable===false)throw fail('MANAGER_TEMPLATE_REQUIRED');
  if(['submitted','reviewed'].includes(view.work.status))throw fail('IN_REVIEW_OR_NOT_EDITABLE');
  const chosen=await inspectTemplate(orgId,missionId,code,body,account,{...d,view:async()=>view});
  if(!chosen||chosen.version!==body.template_version)throw fail('TEMPLATE_CHANGED');
  const fetchRows=d.fetchRows||rest,ctx=await (d.context||context)(orgId,missionId,code,fetchRows),drive=d.drive||driveAdapter;
  const old=(ctx.programme.workpapers||[]).find(w=>w.cycle_code===ctx.cycle.cycle_code);
  if(!old?.file_id||old.file_id!==view.workpaper?.file_id)throw fail('WORK_CHANGED_PREPARE_AGAIN');
  const locked=await fetchRows('office_procedure_work?org_id=eq.'+encodeURIComponent(orgId)+'&programme_id=eq.'+encodeURIComponent(ctx.programme.id)+'&cycle_code=eq.'+encodeURIComponent(ctx.cycle.cycle_code)+'&status=in.(submitted,reviewed)&select=id&limit=1');
  if(locked?.length)throw fail('CYCLE_ALREADY_IN_REVIEW');
  const meta=await drive.getMeta(old.file_id),parent=meta.parents?.[0];if(!parent)throw fail('WORKPAPERS_FOLDER_NOT_FOUND');
  const name=(chosen.name||'Working_file.xlsx').replace(/\.xlsx$/i,'')+' — mission '+missionId.slice(0,8)+' — '+Date.now()+'.xlsx';
  const copy=await drive.copyFile(chosen.file_id,name,parent),check=copy?.id?await drive.getMeta(copy.id):null;
  if(!check?.id||!check.parents?.includes(parent))throw fail('MODEL_COPY_NOT_VERIFIED');
  if(fingerprint(Buffer.from(await drive.downloadBuffer(copy.id)))!==chosen.fingerprint)throw fail('MODEL_COPY_NOT_VERIFIED');
  const entry={...old,file_id:copy.id,name,url:check.webViewLink||null,status:'CREATED_FROM_MODEL',model:{id:chosen.file_id,name:chosen.name},previous_file_id:old.file_id,previous_name:old.name,at:new Date().toISOString()};
  const rows=await fetchRows('office_work_programmes?id=eq.'+encodeURIComponent(ctx.programme.id)+'&org_id=eq.'+encodeURIComponent(orgId)+(ctx.programme.updated_at?'&updated_at=eq.'+encodeURIComponent(ctx.programme.updated_at):''),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({workpapers:ctx.programme.workpapers.map(w=>w.cycle_code===ctx.cycle.cycle_code?entry:w),updated_at:entry.at})});
  if(!rows?.length)throw fail('MEMORY_CONFLICT');
  return {workpaper:entry,old_file_preserved:true,old_values_migrated:false};
}
