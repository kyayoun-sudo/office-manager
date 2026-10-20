import {missionQuestions,MISSION_CONTEXT_RULE} from './procedure-mission-context.js';
import { readerByteLimit } from './reader-limits.js';
import ExcelJS from 'exceljs';
import { createHash, randomUUID } from 'node:crypto';
import { procedureView, patch, cellValue } from './procedure-work.js';
import { workContentHash } from './procedure-integrity.js';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { agentPermissions } from './agent-permissions.js';
import { audit } from './audit-log.js';
import { yellowInput } from './workbook-inputs.js';

const fail = (code, statusCode = 409) => Object.assign(new Error(code), {statusCode});
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const clean = v => String(v ?? '').replace(/\s+/g,' ').trim();
const fold = v => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const KIND = 'sop-document-work';
export const DOCUMENT_MARK = 'Office Manager — préparation documentaire';
export const sopRevision = (view, step) => hash({card:view.card, step:step.text,code:view.line.code,mission_period:view.mission?.period_label||null});
const records = work => (work.walkthrough || []).filter(x=>x.kind === KIND);
function editable(view) {
  if (view.editable === false || ['submitted','reviewed'].includes(view.work.status)) throw fail('IN_REVIEW_OR_NOT_EDITABLE');
}
async function workbook(view,d) {
  if (!view.workpaper?.file_id) throw fail('NO_WORKPAPER_FOR_CYCLE');
  const drive=d.drive || driveAdapter, meta=await drive.getMeta(view.workpaper.file_id);
  if (Number(meta.size)>20*1024*1024) throw fail('WORKBOOK_TOO_LARGE');
  const bytes=Buffer.from(await drive.downloadBuffer(view.workpaper.file_id));
  if(/\.xlsm$/i.test(meta.name||'') || bytes.includes(Buffer.from('xl/vbaProject.bin')))throw fail('MACRO_WORKBOOK_WRITE_UNSUPPORTED');
  const wb=new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
  return {drive,meta,bytes,wb};
}

// The model can propose facts only in explicitly marked input cells. Decisions and signatures remain human.
export function writableCell(ws,cell) {
  if (!ws || !cell || cell.formula || cell.value?.sharedFormula || cell.isMerged && cell.master.address !== cell.address) return false;
  if (cell.value != null && cellValue(cell.value) !== '') return false;
  if (!yellowInput(cell)) return false;
  if (/signoff|revue|programme|risque|audit_meta|lists/i.test(ws.name)) return false;
  // The nearest non-empty heading in this column describes its input role.
  let heading='';
  for (let r=cell.row-1;r>=Math.max(1,cell.row-100);r--) {
    const c=ws.getCell(r,cell.col);
    if (typeof c.value==='string' && c.value.trim()) { heading=fold(c.value);break; }
  }
  const rowLabel=fold(ws.getCell(cell.row,1).value);
  return !/conforme|resultat|conclusion|signatur|revu par|prepare par|retenu|selection|approuve|accepte|decision|activation/.test(heading+' '+rowLabel);
}

export function workbookMap(wb,code) {
  const sheets=[],targets=[];let budget=0;
  const priorityOf=ws=>ws.name===code?0:/guide/i.test(ws.name)?1:/programme/i.test(ws.name)?2:/pbc/i.test(ws.name)?3:4;
  for (const ws of [...wb.worksheets].sort((a,b)=>priorityOf(a)-priorityOf(b))) {
    if (/audit_meta|lists|^\w+-\d+_D/.test(ws.name)) continue;
    const rows=[]; const priority=ws.name===code || /guide|programme|pbc/i.test(ws.name);
    const limit=Math.min(ws.rowCount,priority?100:18);
    for(let r=1;r<=limit;r++) {
      const cells=[];
      for(let c=1;c<=Math.min(ws.columnCount,40);c++) {
        const cell=ws.getCell(r,c),value=clean(cellValue(cell.value)).slice(0,600),input=writableCell(ws,cell);
        if (!value && !input && !cell.formula) continue;
        const item={cell:cell.address,value,formula:Boolean(cell.formula),input};
        if (budget+JSON.stringify(item).length>40000) break;
        budget+=JSON.stringify(item).length;cells.push(item);
        if(input)targets.push(ws.name+'!'+cell.address);
      }
      if(cells.length)rows.push({row:r,cells});
    }
    sheets.push({name:ws.name,total_rows:ws.rowCount,rows});
  }
  return {sheets,targets,truncated:budget>=39000 || sheets.some(s=>s.total_rows>s.rows.length)};
}

export function validateFindings(raw,docs,map) {
  const findings=[], rejected=[];
  for(const f of (Array.isArray(raw)?raw:[])) {
    const source=docs.find(d=>d.file_id===f.file_id),quote=clean(f.quote);
    if(!source || quote.length<12 || !clean(source.text).includes(quote) || !clean(f.fact)) {rejected.push('Une proposition sans passage source vérifiable a été écartée.');continue;}
    let target=null;
    if(f.target && map.targets.includes(String(f.target))) target=String(f.target);
    findings.push({fact:clean(f.fact).slice(0,1800),file_id:source.file_id,source:source.name,quote:quote.slice(0,2000),
      reference:clean(f.reference).slice(0,200),target});
  }
  return {findings,rejected};
}

export async function prepareDocumentWork(orgId,missionId,code,step,body,account,d={}) {
  const getView=()=> (d.view || procedureView)(orgId,missionId,code,account,{...d,refreshSop:true});
  let view=await getView();editable(view);
  if((await import('./workpaper-dialogue.js')).pendingConfirmation(view))throw fail('HUMAN_CONFIRMATION_REQUIRED');
  const grant=await (d.permissions || (()=>agentPermissions(orgId,d.fetchRows)))();
  if(!grant.granted)throw fail('AGENTS_NOT_AUTHORIZED',403);
  const {wb,bytes}=await workbook(view,d),map=workbookMap(wb,code);
  const fileSteps=(await import('./step-runner.js')).stepsInSheet(wb.getWorksheet(code));
  const sopSteps=(view.card.steps||[]).filter(s=>!s.common);
  const conflict=fileSteps.length>0 && sopSteps.length>0 && JSON.stringify(fileSteps.map(s=>fold(s.text)))!==JSON.stringify(sopSteps.map(s=>fold(s.text||s)));
  if(conflict)map.targets=[];
  const reading=await (await import('./sop-exhaustive-reading.js')).exhaustivePass(orgId,missionId,view,step,body,account,d,{
    sources:d.sources || (await import('./step-runner.js')).stepSources,drive:d.drive || driveAdapter,map,revision:sopRevision,validate:validateFindings,getView,
    save:(latest,changes)=>(d.save || patch)(orgId,latest.work,changes,account,d.fetchRows||rest)
  });
  if(reading.pending)return reading;
  const {docs,unread}=reading;
  if(reading.job)view=await getView();
  const raw={summary:reading.summary,questions:reading.questions};
  const checked={findings:reading.findings,rejected:[]};
  const draft={kind:KIND,id:randomUUID(),step:step.n,step_text:step.text,revision:sopRevision(view,step),workbook_hash:hash(bytes),
    file_id:view.workpaper.file_id,summary:String(raw.summary||'').slice(0,3000),
    questions:[...(conflict?['Les étapes du modèle Excel diffèrent du SOP courant : réconcilier le modèle avant de renseigner ses entrées. La préparation sourcée reste disponible.']:[]),...(Array.isArray(raw.questions)?raw.questions:[]).map(q=>String(q).slice(0,700)),...checked.rejected],
    mission_period:view.mission?.period_label||null,coverage:reading.coverage||null,exhaustive:reading.exhaustive===true,findings:checked.findings,sources:docs.map(({text,sections,...x})=>x),unread,at:new Date().toISOString(),status:'draft'};
  draft.questions=missionQuestions(draft.questions,view.mission);
  const latest=await getView();editable(latest);
  if(workContentHash(latest.work)!==workContentHash(view.work) || sopRevision(latest,step)!==draft.revision)throw fail('WORK_CHANGED_PREPARE_AGAIN');
  await (d.save || patch)(orgId,latest.work,{walkthrough:[...(latest.work.walkthrough||[]).filter(r=>(r.kind!==KIND || r.status==='applied') && (r.kind!=='sop-reading-job'||r.id!==reading.job)),draft]},account,d.fetchRows||rest);
  return {operation:'document-review',plan_id:draft.id,step,understood:draft.summary,findings:draft.findings.slice(0,50),findings_total:draft.findings.length,questions:draft.questions.slice(0,50),questions_total:draft.questions.length,unread,coverage:draft.coverage,exhaustive:draft.exhaustive,
    partial:docs.some(x=>x.partial),reading_total:docs.length,reading:docs.slice(0,50).map(({file_id,name,pages_read,total_pages,ocr,partial})=>({file_id,name,pages_read,total_pages,ocr,partial})),ready:draft.findings.length>0,revision:draft.revision,
    changed_sop:records(view.work).some(r=>r.step===step.n && r.revision!==draft.revision),ai:'ok'};
}

export async function runDocumentWork(orgId,missionId,code,body,account,d={}) {
  const view=await (d.view || procedureView)(orgId,missionId,code,account,{...d,refreshSop:true});editable(view);
  const draft=records(view.work).find(r=>r.id===body.plan_id);
  if(!draft)throw fail('DOCUMENT_PLAN_NOT_FOUND');
  const {steps}=await (await import('./step-runner.js')).stepsView(orgId,missionId,code,account,{...d,view:async()=>view});
  const step=steps.find(s=>s.n===draft.step);
  if(!step || sopRevision(view,step)!==draft.revision)throw fail('SOP_CHANGED_PREPARE_AGAIN');
  if(draft.status==='applied')return {verified:true,sheet:draft.sheet,unchanged:true,count:draft.findings.length,receipt:draft.receipt,confirmation:draft.confirmation};
  if((await import('./workpaper-dialogue.js')).pendingConfirmation(view))throw fail('HUMAN_CONFIRMATION_REQUIRED');
  const available=await (d.sources || (await import('./step-runner.js')).stepSources)(orgId,missionId,d);
  const {drive,meta,wb,bytes}=await workbook(view,d);
  if(draft.file_id!==view.workpaper.file_id || hash(bytes)!==draft.workbook_hash)throw fail('WORK_CHANGED_PREPARE_AGAIN');
  for(const src of draft.sources) {
    if(!available.some(f=>f.file_id===src.file_id))throw fail('DOCUMENT_SOURCE_CHANGED');
    const m=await drive.getMeta(src.file_id);
    if(m.trashed || Number(m.size)>readerByteLimit(m) || (m.modifiedTime||null)!==src.modified || src.provider_version && (m.version||null)!==src.provider_version)throw fail('DOCUMENT_SOURCE_CHANGED');
    const r=await drive.readText(src.file_id,{maxChars:src.read_limit||60000,structured:true,sopReading:true,verifyFingerprintOnly:Boolean(src.binary_fingerprint)});
    if(r?.error_code || r?.error_status || (src.binary_fingerprint ? r?.source_fingerprint!==src.binary_fingerprint : hash((typeof r==='string'?r:r?.text||'').slice(0,src.read_limit||60000))!==src.fingerprint))throw fail('DOCUMENT_SOURCE_CHANGED');
  }
  const changed=[];
  for(const f of draft.findings) if(f.target) {
    const split=f.target.lastIndexOf('!'),ws=wb.getWorksheet(f.target.slice(0,split)),cell=ws?.getCell(f.target.slice(split+1));
    if(!writableCell(ws,cell))throw fail('WORK_CHANGED_PREPARE_AGAIN');
    cell.value=f.fact;changed.push({sheet:ws.name,cell:cell.address,value:f.fact,source:f.source,reference:f.reference,quote:f.quote,file_id:f.file_id});
  }
  // Same working file, immutable preparation per revision; never replace a person's sheet.
  let sheet=null;
  for(let n=1;n<=999;n++) {const name=`${code.slice(0,15)}_D${draft.step}_${n}`.slice(0,31);if(!wb.getWorksheet(name)){sheet=name;break;}}
  if(!sheet)throw fail('NO_FREE_SHEET_NAME');
  const ws=wb.addWorksheet(sheet);
  ws.addRow([DOCUMENT_MARK]);ws.addRow(['Procédure',code]);ws.addRow(['Étape',step.text]);ws.addRow(['Version SOP',draft.revision]);
  ws.addRow(['Préparation à relire',draft.summary]);ws.addRow(['Questions ouvertes',draft.questions.join('\n').length<=30000?draft.questions.join('\n'):draft.questions.length+' questions listées après les faits sourcés']);
  ws.addRow(['Limites',draft.unread.map(x=>x.name+': '+x.reason).join('\n').length<=30000?draft.unread.map(x=>x.name+': '+x.reason).join('\n'):draft.unread.length+' limites listées après les faits']);
  ws.getCell('C2').value='Période auditée';ws.getCell('D2').value=view.mission?.period_label||'Non enregistrée';
  if(draft.coverage){ws.getCell('C7').value='Couverture';ws.getCell('D7').value=JSON.stringify(draft.coverage);}
  ws.addRow(['Fait préparé','Document','Référence','Passage exact','Destination','Identifiant source','Empreinte source','Version source']);
  draft.findings.forEach(f=>{const src=draft.sources.find(s=>s.file_id===f.file_id);ws.addRow([f.fact,f.source,f.reference,f.quote,f.target||'Préparation uniquement',f.file_id,src?.binary_fingerprint||src?.fingerprint,src?.modified]);});
  if(draft.unread.map(x=>x.name+': '+x.reason).join('\n').length>30000){ws.addRow(['Limites de lecture']);draft.unread.forEach(x=>ws.addRow([x.name,x.reason]));}
  if(draft.questions.join('\n').length>30000){ws.addRow(['Questions ouvertes']);draft.questions.forEach(q=>ws.addRow([q]));}
  ws.columns.forEach(c=>{c.width=45;});ws.eachRow(r=>r.eachCell(c=>{c.alignment={wrapText:true,vertical:'top'};}));
  wb.calcProperties.fullCalcOnLoad=true;
  await drive.updateBinary(view.workpaper.file_id,{buffer:Buffer.from(await wb.xlsx.writeBuffer()),mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',expectedModifiedTime:meta.modifiedTime});
  const check=new ExcelJS.Workbook();await check.xlsx.load(Buffer.from(await drive.downloadBuffer(view.workpaper.file_id)));
  const verified=check.getWorksheet(sheet)?.getCell('B4').value===draft.revision && draft.findings.every((f,i)=>check.getWorksheet(sheet)?.getCell(i+9,1).value===f.fact) && changed.every(c=>check.getWorksheet(c.sheet)?.getCell(c.cell).value===c.value);
  if(!verified)throw fail('WORKPAPER_WRITE_NOT_VERIFIED',502);
  const receipt={file_id:view.workpaper.file_id,sheet,at:new Date().toISOString(),model_cells:changed.length,source_facts:draft.findings.length,cells:[...changed,...draft.findings.map((f,i)=>({sheet,cell:'A'+(i+9),value:f.fact,source:f.source,reference:f.reference,quote:f.quote,file_id:f.file_id}))]};
  const confirmation={status:'awaiting_confirmation'};
  await (d.save || patch)(orgId,view.work,{walkthrough:(view.work.walkthrough||[]).map(r=>r.id===draft.id?{...r,status:'applied',sheet,receipt,confirmation}:r)},account,d.fetchRows||rest);
  await (d.audit || audit)(orgId,{agent:'enhanced-auditor',mission_id:missionId,action_type:'WORKPAPER_DOCUMENT_PREPARED',status:'succeeded',approved_by:account?.email,
    decision:`${code} étape ${step.n} : ${draft.findings.length} faits sourcés préparés ; ${changed.length} entrées renseignées`,output_ref:'drive:'+view.workpaper.file_id+'#'+sheet},{fetchRows:d.fetchRows||rest});
  return {sheet,verified,receipt,confirmation,count:draft.findings.length,cells:changed.length,questions:draft.questions,partial:draft.sources.some(s=>s.partial),complete:false};
}
