import ExcelJS from 'exceljs';
import {createHash,randomUUID} from 'node:crypto';
import {procedureView,patch,cellValue,parseAmount} from './procedure-work.js';
import {writableCell,sopRevision,DOCUMENT_MARK} from './sop-document-work.js';
import {yellowInput} from './workbook-inputs.js';
import {extendTable} from './workfile-extend.js';
import {mapWorkingFile} from './workfile-map.js';
import {pendingConfirmation} from './workpaper-dialogue.js';
import {stepSources} from './step-runner.js';
import {driveAdapter} from './drive-adapter.js';
import {rest} from './supabase.js';
import {headerRow,suggestColumn,proposeColumn,columnRole,tableRole,destinationRole,sourceSuggestions} from './client-table-understanding.js';
import {legacySheets} from './legacy-xls.js';
const fail=c=>Object.assign(new Error(c),{statusCode:409});
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const fold=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function parseClientCsv(text){
  const first=text.split(/\r?\n/)[0],sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(!quoted&&value==='')quoted=true;else if(quoted)quoted=false;else value+=c;}else if(!quoted&&c===sep){row.push(value);value='';}else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);rows.push(row);row=[];value='';}else value+=c;}
  if(quoted)throw fail('SOURCE_CSV_INVALID');if(value!==''||row.length){row.push(value);rows.push(row);}return rows;
}
export async function clientTable(id,drive,sourceSheet){
  const meta=await drive.getMeta(id);if(meta.trashed||Number(meta.size)>20*1024*1024)throw fail('SOURCE_TABLE_LIMIT_REACHED');
  const bytes=Buffer.from(await drive.downloadBuffer(id));let rows=[];
  if(/\.csv$/i.test(meta.name||''))rows=parseClientCsv(bytes.toString('utf8').replace(/^\uFEFF/,''));
  else if(/\.xls$/i.test(meta.name||'')){
    const available=legacySheets(bytes);if(!sourceSheet&&available.length>1)throw fail('SOURCE_SHEET_REQUIRED');
    const selected=sourceSheet?available.find(s=>s.name===sourceSheet):available[0];if(!selected)throw fail('SOURCE_SHEET_REQUIRED');rows=selected.rows;
  }
  else{const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);const available=wb.worksheets.filter(s=>s.state==='visible'&&s.actualRowCount>1);if(!sourceSheet&&available.length>1)throw fail('SOURCE_SHEET_REQUIRED');const ws=sourceSheet?available.find(s=>s.name===sourceSheet):available[0];if(!ws)throw fail('SOURCE_SHEET_REQUIRED');if(ws.rowCount>=20000)throw fail('SOURCE_TABLE_LIMIT_REACHED');
    ws.eachRow({includeEmpty:false},(row,n)=>{rows[n-1]=[];row.eachCell((cell,c)=>{if(cell.formula&&cell.result==null)throw fail('SOURCE_FORMULA_WITHOUT_VALUE');rows[n-1][c-1]=cellValue(cell.value);});});rows=Array.from(rows,r=>r||[]);}
  return {meta:{id,name:meta.name,source_sheet:sourceSheet||null,modifiedTime:meta.modifiedTime||null,fingerprint:hash(bytes)},rows,header_row:headerRow(rows)};
}
const freeCell=c=>!(c.formula||c.value?.sharedFormula||c.value?.formula||(c.isMerged&&c.master.address!==c.address)||(c.value!=null&&cellValue(c.value)!==''));
const monetary=label=>/montant|debit|credit|solde|amount/.test(fold(label))||/budget/.test(fold(label))&&!/categorie|code|reference|libelle|description/.test(fold(label));
export async function tableImportOptions(org,mission,code,body,account,d={}){
  const view=await(d.view||procedureView)(org,mission,code,account,d);
  const sources=await(d.sources||stepSources)(org,mission,{...d,strictSources:true});
  const files=sourceSuggestions(sources.filter(s=>s.file_id!==view.workpaper?.file_id&&!/^~\$/.test(s.name||'')&&/\.(xlsx|xls|csv)$/i.test(s.name||'')),body.sheet);
  // The mission's PDFs too (Paul, 2026-10-25: « le fichier en question est un PDF »): offered in the same list, turned into a verified table first.
  const pdfs=sources.filter(s=>s.file_id!==view.workpaper?.file_id&&/\.pdf$/i.test(s.name||'')).map(s=>({file_id:s.file_id,name:s.name,document:s.document||null,pdf:true}));
  if(!body.source_file_id)return {files,pdfs};
  if(!files.some(f=>f.file_id===body.source_file_id))throw fail('DOCUMENT_SOURCE_CHANGED');
  const drive=d.drive||driveAdapter,meta=await drive.getMeta(body.source_file_id);
  if(meta.trashed||Number(meta.size)>20*1024*1024)throw fail('SOURCE_TABLE_LIMIT_REACHED');
  const bytes=Buffer.from(await drive.downloadBuffer(body.source_file_id));if(bytes.length>20*1024*1024)throw fail('SOURCE_TABLE_LIMIT_REACHED');
  if(/\.csv$/i.test(meta.name||''))return {files,sheets:[]};
  if(/\.xls$/i.test(meta.name||''))return {files,sheets:legacySheets(bytes).map(s=>{const headers=s.rows[headerRow(s.rows)]||[];return {name:s.name,headers,role:tableRole(headers)};})};
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);
  const sheets=wb.worksheets.filter(s=>s.state==='visible'&&s.actualRowCount>1).map(s=>{
    const rows=[];for(let r=1;r<=Math.min(40,s.rowCount);r++){const row=[];s.getRow(r).eachCell((c,i)=>{row[i-1]=cellValue(c.value);});rows.push(row);}
    const headers=rows[headerRow(rows)]||[];return {name:s.name,role:tableRole(headers),headers};
  });
  return {files,sheets};
}
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
  const table=await (d.readTable||clientTable)(body.source_file_id,drive,body.source_sheet);
  if(table.rows.length>=20000)throw fail('SOURCE_TABLE_LIMIT_REACHED');
  const headers=(table.rows[table.header_row]||[]).map(String),numbered=table.rows.slice(table.header_row+1).map((row,i)=>({row,number:table.header_row+i+2})).filter(x=>x.row.some(v=>v!=null&&v!=='')),rows=numbered.map(x=>x.row);
  const expected=destinationRole(body.sheet),actual=tableRole(headers);
  // A table built by the plan of the sheet (titles = the sheet's own titles, server side only) is checked column by column there.
  if(!d.combined&&expected!=='unknown'&&actual!=='unknown'&&expected!==actual)throw fail('SOURCE_TYPE_MISMATCH');
  if(!rows.length)throw fail('POPULATION_EMPTY');
  // (2026-10-25) The table's first input row (yellow, whatever its value) gives the column titles; the writing starts after the rows
  // already used, so a second source (the grand livre of the next year) is ADDED below the first one, never over it.
  const width=Math.min(sheet.columnCount,100),isInput=c=>{const v=c.value;return yellowInput(c)&&!c.formula&&!(v&&typeof v==='object'&&v.sharedFormula);};
  let top=0;
  for(let r=1;r<=Math.min(sheet.rowCount,200);r++)if([...Array(width).keys()].some(i=>isInput(sheet.getCell(r,i+1)))){top=r;break;}
  if(!top)throw fail('NO_WRITABLE_TABLE');
  const inputCols=[...Array(width).keys()].map(i=>i+1).filter(c=>isInput(sheet.getCell(top,c)));
  const tableMap=(mapWorkingFile(wb).sheets.find(t=>t.name===sheet.name)?.tables||[]).filter(t=>t.first_row<=top&&t.last_row>=top)[0]||null;
  // Rows already used = rows of THE TABLE with a value in an input cell; a « TOTAL » line or a note under the table is not an entry
  // (2026-10-25: a total row under D2 made the import start below it, outside the table, and the enlargement could not place it).
  const lastScan=tableMap?tableMap.last_row:sheet.rowCount;
  let used=0;for(let r=top;r<=lastScan;r++)if(inputCols.some(c=>{const cell=sheet.getCell(r,c),v=cellValue(cell.value);return isInput(cell)&&v!=null&&v!=='';}))used=r;
  // The table's last ENTRY row (yellow input), not a total line the map may include: capacity and enlargement start from it.
  let inputLast=0;for(let r=top;r<=lastScan;r++)if(inputCols.some(c=>isInput(sheet.getCell(r,c))))inputLast=r;
  const first=used?used+1:top;
  // Columns of the table: input cells of its first row (titles above it); below, the same columns (a data value above a cell is not a
  // title: the old heading test read « … sélection … » in a libellé as a forbidden column).
  const columns=[];
  for(let c=1;c<=width;c++)if(writableCell(sheet,sheet.getCell(top,c))||(first>top&&writableCell(sheet,sheet.getCell(first,c)))){
    let label='';for(let r=top-1;r>=1;r--){const v=cellValue(sheet.getCell(r,c).value);if(typeof v==='string'&&v.trim()){label=v;break;}}
    // The working file's own map decides what a person's decision, a key or a calculation is: never imported (2026-10-25).
    const role=(tableMap?.columns||[]).find(m=>m.col===sheet.getColumn(c).letter)?.role;
    if(['judgment','key','calc','result'].includes(role))continue;
    // What the column MEANS in the model and in the piece (« Budget initial » ← « Budget de l'exercice »), with the reason, shown to the person.
    const p=proposeColumn(label,headers,rows);
    columns.push({column:c,label:label||sheet.getColumn(c).letter,suggested_source:p.source,suggested_sure:p.sure,suggested_why:p.why});
  }
  return {view,step,drive,meta,wb,bytes,sheet,table,headers,rows,row_numbers:numbered.map(x=>x.number),first,top,columns,table_last:tableMap?(inputLast||tableMap.last_row):null,table_first:tableMap?tableMap.first_row:null,
    revision:hash([sopRevision(view,step),body.source_file_id,body.source_sheet||null,body.sheet,table.meta.modifiedTime||null,table.meta.fingerprint||null,table.rows,hash(bytes)])};
}
export function yearOf(v){
  if(v instanceof Date)return Number.isNaN(v.getTime())?null:v.getUTCFullYear();
  if(typeof v==='number'&&v>20000&&v<80000)return new Date(Date.UTC(1899,11,30)+v*86400000).getUTCFullYear();
  const m=String(v??'').match(/\b(19|20)\d{2}\b/g);if(!m)return null;
  return Number(/^\d{4}-/.test(String(v).trim())?m[0]:m[m.length-1]);
}
// Why a source row is not an entry: a total / sub-total / carried-forward line (text « Total… » and no date), or an amount that
// cannot be read. Such rows are set aside, counted and shown — never imported as if they were entries.
const TOTAL_LINE=/^(sous[- ]?)?total|^report|^a reporter|^solde (au|de|du|a)|^cumul|^totaux/;
function rowIssue(x,row,mapping){
  const dateCol=x.headers.findIndex(h=>columnRole(h)==='date');
  const noDate=dateCol<0||row[dateCol]==null||row[dateCol]==='';
  if(noDate&&row.some(v=>typeof v==='string'&&TOTAL_LINE.test(String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim())))return 'ligne de total';
  const money=(mapping?mapping.flatMap(m=>[m.source,m.minus]).filter(i=>i!=null&&monetary(x.headers[i]||'')):x.headers.map((h,i)=>monetary(h)?i:-1).filter(i=>i>=0));
  for(const i of money){const v=row[i];if(v==null||v==='')continue;const n=parseAmount(v);if(n==null||!Number.isFinite(n))return 'montant illisible ('+String(v).slice(0,30)+')';}
  return null;
}
export async function previewTableImport(org,mission,code,body,account,d={}){
  const x=await load(org,mission,code,body,account,d);
  // Totals over the ENTRY rows (total / sub-total lines and unreadable amounts are counted apart, never silently mixed in).
  const kept=x.rows.filter((r,i)=>!rowIssue(x,r,null));
  const totalAt=i=>Math.round(kept.reduce((sum,r)=>{const n=parseAmount(r[i]);return n==null||!Number.isFinite(n)?sum:sum+n;},0)*100)/100;
  const totals=x.headers.flatMap((label,i)=>monetary(label)?[{label,total:totalAt(i)}]:[]);
  const issues=x.rows.map((r,i)=>({row:x.row_numbers[i],why:rowIssue(x,r,null)})).filter(y=>y.why);
  const debit=x.headers.findIndex(h=>columnRole(h)==='debit'),credit=x.headers.findIndex(h=>columnRole(h)==='credit');
  const gl_summary=debit>=0&&credit>=0?{debit:totalAt(debit),credit:totalAt(credit),difference:Math.round((totalAt(debit)-totalAt(credit))*100)/100,scope:'selected_source_sheet',audit_conclusion:false}:null;
  // The years the entries cover, read in the date column (a grand livre of 2023 and one of 2024 are two sources, not one).
  const dateCol=x.headers.findIndex(h=>columnRole(h)==='date'),years={};
  if(dateCol>=0)for(const r of kept){const y=yearOf(r[dateCol]);if(y)years[y]=(years[y]||0)+1;}
  return {revision:x.revision,source_name:x.table.meta.name,source_headers:x.headers,years,rows:x.rows.length-issues.length,set_aside:{count:issues.length,examples:issues.slice(0,5)},sample_rows:kept.slice(0,3),totals,gl_summary,first_rows:x.rows.slice(0,5),target_sheet:x.sheet.name,start_row:x.first,last_row:x.table_last,columns:x.columns,step:x.step};
}
export async function runTableImport(org,mission,code,body,account,d={}){
  if(!account?.email)throw fail('HUMAN_IDENTITY_REQUIRED');
  const x=await load(org,mission,code,body,account,d);
  if(x.revision!==body.revision)throw fail('WORK_CHANGED_PREPARE_AGAIN');
  const mapping=body.mapping;if(!Array.isArray(mapping)||!mapping.length||mapping.length>100)throw fail('COLUMN_MAPPING_REQUIRED');
  const used=new Set(),cells=[];
  // Total lines and unreadable amounts are set aside (counted in the receipt), the entries are written one after the other.
  const skip=x.rows.map(r=>!!rowIssue(x,r,mapping)),setAside=skip.filter(Boolean).length;
  // (2026-10-25) More entries than the model's table: the table is made larger first, only when the person asked for it.
  const needed=skip.filter(v=>!v).length,end=x.first+needed-1;
  const table=x.table_last?{first_row:x.table_first,last_row:x.table_last}:null;
  let extended=null;
  if(table&&end>table.last_row){
    if(body.extend!==true)throw Object.assign(fail('TABLE_TOO_SMALL'),{needed,capacity:table.last_row-x.first+1});
    extended=extendTable(x.wb,x.sheet.name,{first_row:table.first_row,last_row:table.last_row},end);
  }
  for(const m of mapping){
    if(!x.columns.some(c=>c.column===m.column)||used.has(m.column)||!Number.isInteger(m.source)||m.source<0||m.source>=x.headers.length)throw fail('COLUMN_MAPPING_REQUIRED');
    // (2026-10-25) One amount column from a debit and a credit column: value = debit − credit, only for amounts.
    if(m.minus!=null&&(!Number.isInteger(m.minus)||m.minus<0||m.minus>=x.headers.length||m.minus===m.source))throw fail('COLUMN_MAPPING_REQUIRED');
    used.add(m.column);
    for(let i=0,k=-1;i<x.rows.length;i++){
      if(skip[i])continue;k++;
      let value=x.rows[i][m.source];
      if(m.minus!=null){const a=x.rows[i][m.source],b=x.rows[i][m.minus];if((a==null||a==='')&&(b==null||b===''))continue;const na=a==null||a===''?0:parseAmount(a),nb=b==null||b===''?0:parseAmount(b);if(na==null||nb==null||!Number.isFinite(na)||!Number.isFinite(nb))throw fail('SOURCE_AMOUNT_INVALID');value=Math.round((na-nb)*100)/100;}
      if(value==null||value==='')continue;
      const raw=value,column=x.columns.find(c=>c.column===m.column);
      if(typeof value==='string'&&monetary(column.label)){value=parseAmount(value);if(value==null)throw fail('SOURCE_AMOUNT_INVALID');}
      // A date written as text in the piece (« 03/01/2024 ») becomes a real date in a date column, so the model's date formulas work.
      if(typeof value==='string'&&columnRole(column.label)==='date'){const m=value.trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)||null,iso=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if(m&&Number(m[2])<=12&&Number(m[1])<=31)value=new Date(Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1])));else if(iso)value=new Date(Date.UTC(Number(iso[1]),Number(iso[2])-1,Number(iso[3])));}
      const cell=x.sheet.getCell(x.first+k,m.column);
      // The column was chosen on the table's first free row; below, a cell only has to be free (empty, no formula), never overwritten.
      if(!freeCell(cell)||!yellowInput(cell))throw fail('TABLE_CAPACITY_OR_OCCUPIED_CELL');
      if(typeof value==='string'&&value.length>32767)throw fail('SOURCE_VALUE_TOO_LONG');
      if(typeof value==='object'&&!(value instanceof Date))throw fail('SOURCE_VALUE_NOT_SUPPORTED');
      cell.value=value;if(value instanceof Date&&!/[dmy]/i.test(String(cell.numFmt||'')))cell.style={...cell.style,numFmt:'dd/mm/yyyy'};const pv=x.table.provenance?.[i]?.[m.source];cells.push({sheet:x.sheet.name,cell:cell.address,value:value instanceof Date?value.toISOString():value,file_id:pv?.file_id||body.source_file_id,source:pv?.name||x.table.meta.name,reference:pv?(pv.heading+' — ligne '+pv.line):(x.table.meta.source_sheet?x.table.meta.source_sheet+' — ':'')+'Ligne source '+x.row_numbers[i],raw_value:raw,source_value:true});
    }
  }
  if(!cells.length)throw fail('POPULATION_EMPTY');
  const id=randomUUID(),name=('IMPORT_'+id.slice(0,8)),log=x.wb.addWorksheet(name),revision=sopRevision(x.view,x.step);
  log.getCell('A1').value=DOCUMENT_MARK;log.getCell('B4').value=revision;
  log.getCell('A2').value='Import de données client — valeurs conservées';log.getCell('B2').value=x.table.meta.name;
  log.getCell('A3').value=(extended?'Tableau agrandi de '+extended.added+' lignes (lignes '+extended.from_row+' à '+extended.to_row+'), formules recopiées, '+extended.formulas_extended+' formule(s) prolongée(s) ; ':'')+(x.rows.length-setAside)+' lignes'+(setAside?' ('+setAside+' ligne(s) de total ou illisible(s) écartée(s))':'')+' ; '+cells.length+' cellules ; correspondance confirmée par '+account?.email;
  x.wb.calcProperties.fullCalcOnLoad=true;
  await x.drive.updateBinary(x.view.workpaper.file_id,{buffer:Buffer.from(await x.wb.xlsx.writeBuffer()),mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',expectedModifiedTime:x.meta.modifiedTime});
  const check=new ExcelJS.Workbook();await check.xlsx.load(Buffer.from(await x.drive.downloadBuffer(x.view.workpaper.file_id)));
  if(!cells.every(c=>{const v=check.getWorksheet(c.sheet)?.getCell(c.cell).value;return (v instanceof Date?v.toISOString():v)===c.value;}))throw fail('WORKPAPER_WRITE_NOT_VERIFIED');
  const record={kind:'sop-document-work',id,step:x.step.n,step_text:x.step.text,revision,file_id:x.view.workpaper.file_id,status:'applied',sheet:name,findings:[],questions:[],unread:[],sources:[],at:new Date().toISOString(),confirmation:{status:'awaiting_confirmation'},
    receipt:{file_id:x.view.workpaper.file_id,sheet:name,at:new Date().toISOString(),model_cells:cells.length,source_facts:0,import_rows:x.rows.length-setAside,set_aside:setAside,mapping,source_file_id:body.source_file_id,cells}};
  await (d.save||patch)(org,x.view.work,{walkthrough:[...(x.view.work.walkthrough||[]),record]},account,d.fetchRows||rest);
  await (d.noteMissionEvent||(await import('./mission-files.js')).noteMissionEvent)(org,mission,body.source_file_id,{agent:'enhanced-auditor',what:'importé dans le working file',detail:(x.rows.length-setAside)+' ligne(s) → '+x.sheet.name+' (ligne '+x.first+')',by:account?.email||null,uses:[{what:'import',where:x.sheet.name}]},d).catch(()=>null);
  return {verified:true,plan_id:id,rows:x.rows.length-setAside,set_aside:setAside,start_row:x.first,extended,cells:cells.length,sheet:x.sheet.name,confirmation:record.confirmation};
}
