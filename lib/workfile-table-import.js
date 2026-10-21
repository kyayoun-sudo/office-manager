import ExcelJS from 'exceljs';
import {createHash,randomUUID} from 'node:crypto';
import {procedureView,patch,cellValue,parseAmount} from './procedure-work.js';
import {writableCell,sopRevision,DOCUMENT_MARK} from './sop-document-work.js';
import {pendingConfirmation} from './workpaper-dialogue.js';
import {stepSources} from './step-runner.js';
import {driveAdapter} from './drive-adapter.js';
import {rest} from './supabase.js';
const fail=c=>Object.assign(new Error(c),{statusCode:409});
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const fold=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function parseClientCsv(text){
  const first=text.split(/\r?\n/)[0],sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(!quoted&&value==='')quoted=true;else if(quoted)quoted=false;else value+=c;}else if(!quoted&&c===sep){row.push(value);value='';}else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);rows.push(row);row=[];value='';}else value+=c;}
  if(quoted)throw fail('SOURCE_CSV_INVALID');if(value!==''||row.length){row.push(value);rows.push(row);}return rows;
}
async function clientTable(id,drive){
  const meta=await drive.getMeta(id);if(meta.trashed||Number(meta.size)>20*1024*1024)throw fail('SOURCE_TABLE_LIMIT_REACHED');
  const bytes=Buffer.from(await drive.downloadBuffer(id));let rows=[];
  if(/\.csv$/i.test(meta.name||''))rows=parseClientCsv(bytes.toString('utf8').replace(/^\uFEFF/,''));
  else{const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);const ws=wb.worksheets.find(s=>s.state==='visible'&&s.actualRowCount>1)||wb.worksheets[0];if(!ws||ws.rowCount>=20000)throw fail('SOURCE_TABLE_LIMIT_REACHED');
    ws.eachRow({includeEmpty:false},(row,n)=>{rows[n-1]=[];row.eachCell((cell,c)=>{if(cell.formula&&cell.result==null)throw fail('SOURCE_FORMULA_WITHOUT_VALUE');rows[n-1][c-1]=cellValue(cell.value);});});rows=Array.from(rows,r=>r||[]);}
  return {meta:{id,name:meta.name},rows,header_row:Math.max(0,rows.slice(0,15).findIndex(r=>r.filter(v=>typeof v==='string'&&v.trim()&&parseAmount(v)==null).length>=3))};
}
const monetary=label=>/montant|debit|credit|solde|amount/.test(fold(label))||/budget/.test(fold(label))&&!/categorie|code|reference|libelle|description/.test(fold(label));
async function load(org,mission,code,body,account,d){
  const view=await (d.view||procedureView)(org,mission,code,account,{...d,refreshSop:true});
  if(view.editable===false||['submitted','reviewed'].includes(view.work.status))throw fail('IN_REVIEW_OR_NOT_EDITABLE');
  if(pendingConfirmation(view))throw fail('HUMAN_CONFIRMATION_REQUIRED');
  const stepText=(view.card.steps||[]).filter(s=>!s.common)[Number(body.step)-1];
  if(!stepText)throw fail('SOP_STEP_REQUIRED');
  const step={n:Number(body.step),text:stepText.text||String(stepText)};
  const sources=await (d.sources||stepSources)(org,mission,{...d,strictSources:true});
  if(body.source_file_id===view.workpaper?.file_id||!sources.some(s=>s.file_id===body.source_file_id))throw fail('DOCUMENT_SOURCE_CHANGED');
  const drive=d.drive||driveAdapter,meta=await drive.getMeta(view.workpaper.file_id);
  if(Number(meta.size)>20*1024*1024||/\.xlsm$/i.test(meta.name||''))throw fail('WORKBOOK_TOO_LARGE');
  const bytes=Buffer.from(await drive.downloadBuffer(view.workpaper.file_id));
  if(bytes.includes(Buffer.from('xl/vbaProject.bin')))throw fail('MACRO_WORKBOOK_WRITE_UNSUPPORTED');
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);
  const sheet=wb.getWorksheet(body.sheet);
  if(!sheet||/guide|programme|risque|audit_meta|list|revue|signoff|synthese/i.test(sheet.name))throw fail('DATA_SHEET_REQUIRED');
  const table=await (d.readTable||clientTable)(body.source_file_id,drive);
  if(table.rows.length>=20000)throw fail('SOURCE_TABLE_LIMIT_REACHED');
  const headers=(table.rows[table.header_row]||[]).map(String),numbered=table.rows.slice(table.header_row+1).map((row,i)=>({row,number:table.header_row+i+2})).filter(x=>x.row.some(v=>v!=null&&v!=='')),rows=numbered.map(x=>x.row);
  if(!rows.length)throw fail('POPULATION_EMPTY');
  let first=0;
  for(let r=1;r<=Math.min(sheet.rowCount,200);r++)if([...Array(Math.min(sheet.columnCount,100)).keys()].some(i=>writableCell(sheet,sheet.getCell(r,i+1)))){first=r;break;}
  if(!first)throw fail('NO_WRITABLE_TABLE');
  const columns=[];
  for(let c=1;c<=Math.min(sheet.columnCount,100);c++)if(writableCell(sheet,sheet.getCell(first,c))){
    let label='';for(let r=first-1;r>=1;r--){const v=cellValue(sheet.getCell(r,c).value);if(typeof v==='string'&&v.trim()){label=v;break;}}
    const exact=headers.map((h,i)=>({h,i})).filter(x=>fold(x.h)===fold(label));
    columns.push({column:c,label:label||sheet.getColumn(c).letter,suggested_source:exact.length===1?exact[0].i:null});
  }
  return {view,step,drive,meta,wb,bytes,sheet,table,headers,rows,row_numbers:numbered.map(x=>x.number),first,columns,
    revision:hash([sopRevision(view,step),body.source_file_id,body.sheet,table.rows,hash(bytes)])};
}
export async function previewTableImport(org,mission,code,body,account,d={}){
  const x=await load(org,mission,code,body,account,d);
  const totals=x.headers.flatMap((label,i)=>monetary(label)?[{label,total:x.rows.reduce((sum,r)=>sum+(parseAmount(r[i])||0),0)}]:[]);
  return {revision:x.revision,source_name:x.table.meta.name,source_headers:x.headers,rows:x.rows.length,totals,first_rows:x.rows.slice(0,5),target_sheet:x.sheet.name,start_row:x.first,columns:x.columns,step:x.step};
}
export async function runTableImport(org,mission,code,body,account,d={}){
  if(!account?.email)throw fail('HUMAN_IDENTITY_REQUIRED');
  const x=await load(org,mission,code,body,account,d);
  if(x.revision!==body.revision)throw fail('WORK_CHANGED_PREPARE_AGAIN');
  const mapping=body.mapping;if(!Array.isArray(mapping)||!mapping.length||mapping.length>100)throw fail('COLUMN_MAPPING_REQUIRED');
  const used=new Set(),cells=[];
  for(const m of mapping){
    if(!x.columns.some(c=>c.column===m.column)||used.has(m.column)||!Number.isInteger(m.source)||m.source<0||m.source>=x.headers.length)throw fail('COLUMN_MAPPING_REQUIRED');
    used.add(m.column);
    for(let i=0;i<x.rows.length;i++){
      let value=x.rows[i][m.source];if(value==null||value==='')continue;
      const raw=value,column=x.columns.find(c=>c.column===m.column);
      if(typeof value==='string'&&monetary(column.label)){value=parseAmount(value);if(value==null)throw fail('SOURCE_AMOUNT_INVALID');}
      const cell=x.sheet.getCell(x.first+i,m.column);
      if(!writableCell(x.sheet,cell))throw fail('TABLE_CAPACITY_OR_OCCUPIED_CELL');
      if(typeof value==='string'&&value.length>32767)throw fail('SOURCE_VALUE_TOO_LONG');
      if(typeof value==='object'&&!(value instanceof Date))throw fail('SOURCE_VALUE_NOT_SUPPORTED');
      cell.value=value;cells.push({sheet:x.sheet.name,cell:cell.address,value:value instanceof Date?value.toISOString():value,file_id:body.source_file_id,source:x.table.meta.name,reference:'Ligne source '+x.row_numbers[i],raw_value:raw,source_value:true});
    }
  }
  if(!cells.length)throw fail('POPULATION_EMPTY');
  const id=randomUUID(),name=('IMPORT_'+id.slice(0,8)),log=x.wb.addWorksheet(name),revision=sopRevision(x.view,x.step);
  log.getCell('A1').value=DOCUMENT_MARK;log.getCell('B4').value=revision;
  log.getCell('A2').value='Import de données client — valeurs conservées';log.getCell('B2').value=x.table.meta.name;
  log.getCell('A3').value=x.rows.length+' lignes ; '+cells.length+' cellules ; correspondance confirmée par '+account?.email;
  x.wb.calcProperties.fullCalcOnLoad=true;
  await x.drive.updateBinary(x.view.workpaper.file_id,{buffer:Buffer.from(await x.wb.xlsx.writeBuffer()),mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',expectedModifiedTime:x.meta.modifiedTime});
  const check=new ExcelJS.Workbook();await check.xlsx.load(Buffer.from(await x.drive.downloadBuffer(x.view.workpaper.file_id)));
  if(!cells.every(c=>{const v=check.getWorksheet(c.sheet)?.getCell(c.cell).value;return (v instanceof Date?v.toISOString():v)===c.value;}))throw fail('WORKPAPER_WRITE_NOT_VERIFIED');
  const record={kind:'sop-document-work',id,step:x.step.n,step_text:x.step.text,revision,file_id:x.view.workpaper.file_id,status:'applied',sheet:name,findings:[],questions:[],unread:[],sources:[],at:new Date().toISOString(),confirmation:{status:'awaiting_confirmation'},
    receipt:{file_id:x.view.workpaper.file_id,sheet:name,at:new Date().toISOString(),model_cells:cells.length,source_facts:0,import_rows:x.rows.length,mapping,source_file_id:body.source_file_id,cells}};
  await (d.save||patch)(org,x.view.work,{walkthrough:[...(x.view.work.walkthrough||[]),record]},account,d.fetchRows||rest);
  return {verified:true,plan_id:id,rows:x.rows.length,cells:cells.length,sheet:x.sheet.name,confirmation:record.confirmation};
}
