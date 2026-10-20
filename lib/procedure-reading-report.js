import {procedureView} from './procedure-work.js';
import {readingProgress,READING_KIND} from './sop-exhaustive-reading.js';

export function publicWork(work){
  return {...work,walkthrough:(work.walkthrough||[]).map(r=>{
    if(r.kind===READING_KIND)return {kind:r.kind,id:r.id,version:r.version,step:r.step,at:r.at,progress:readingProgress(r,{n:r.step})};
    if(r.kind!=='sop-document-work')return r;
    return {...r,findings:(r.findings||[]).slice(0,50),findings_total:(r.findings||[]).length,questions:(r.questions||[]).slice(0,50),questions_total:(r.questions||[]).length,
      sources:(r.sources||[]).slice(0,50).map(({coverage,remaining,analysis_spans,page_characters,...s})=>({...s,pages_read_count:s.pages_read?.length||0})),sources_total:(r.sources||[]).length};
  })};
}
export const publicView=view=>({...view,work:publicWork(view.work)});

export async function readingReport(orgId,missionId,code,body,account,d={}){
  const view=await (d.view||procedureView)(orgId,missionId,code,account,d);
  const records=(view.work.walkthrough||[]).filter(r=>r.kind==='sop-document-work');
  const record=body.plan_id?records.find(r=>r.id===body.plan_id):records.at(-1);
  if(!record)throw Object.assign(new Error('DOCUMENT_PLAN_NOT_FOUND'),{statusCode:404});
  const offset=Math.max(0,Math.floor(Number(body.offset)||0)),count=Math.min(50,Math.max(1,Number(body.count)||50));
  if(body.file_id){
    const source=record.sources.find(s=>s.file_id===body.file_id);
    if(!source)throw Object.assign(new Error('DOCUMENT_SOURCE_CHANGED'),{statusCode:404});
    const from=Math.max(1,Math.floor(Number(body.page_from)||1)),length=Math.min(200,Math.max(1,Number(body.page_count)||100));
    const pages=Array.from({length:Math.max(0,Math.min(length,(source.total_pages||0)-from+1))},(_,i)=>({page:from+i,status:source.coverage?.[from+i]||'not_processed',characters:source.page_characters?.[from+i]||0,analyses:(source.analysis_spans||[]).filter(s=>s.page===from+i)}));
    return {file_id:source.file_id,name:source.name,total_pages:source.total_pages,pages_read:source.pages_read.length,pages,source_revision:source.modified,ocr:source.ocr};
  }
  return {plan_id:record.id,coverage:record.coverage,exhaustive:record.exhaustive,offset,
    findings:record.findings.slice(offset,offset+count),findings_total:record.findings.length,
    questions:record.questions.slice(offset,offset+count),questions_total:record.questions.length,
    sources:record.sources.map(s=>({file_id:s.file_id,name:s.name,total_pages:s.total_pages,pages_read:s.pages_read?.length||0,partial:s.partial,ocr:s.ocr})).slice(offset,offset+count),sources_total:record.sources.length};
}
