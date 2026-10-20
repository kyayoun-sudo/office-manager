import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {exhaustivePass} from '../lib/sop-exhaustive-reading.js';
import {readSopPdf} from '../lib/sop-pdf-reading.js';
import {validateFindings} from '../lib/sop-document-work.js';
import {missionQuestions} from '../lib/procedure-mission-context.js';
import {publicWork,readingReport} from '../lib/procedure-reading-report.js';

function fixture({pages=1000,documents=8,badPage=null,blankPage=null}={}){
  const sources=Array.from({length:documents},(_,i)=>({file_id:'DOC'+i,name:'Document '+i+'.pdf'}));
  const view={mission:{period_label:'2023-2024',context_available:true},line:{code:'PRJ-01'},card:{objective:'Comprendre toutes les clauses',ask:[]},work:{id:'W',walkthrough:[]}};
  const seen=new Set(),windows=[];let bytesSent=0,analyses=0;
  const h={map:{targets:[]},sources:async(o,m,d)=>{assert.equal(d.strictSources,true);return sources;},revision:v=>JSON.stringify([v.card,v.mission.period_label]),validate:validateFindings,
    getView:async()=>structuredClone(view),save:async(v,c)=>Object.assign(view.work,structuredClone(c)),
    drive:{getMeta:async id=>({name:id+'.pdf',mimeType:'application/pdf',modifiedTime:'v1',md5Checksum:'md5-'+id,size:100000}),
      readText:async(id,o)=>{
        if(o.verifyFingerprintOnly)return {source_fingerprint:'fp-'+id};
        assert.ok(o.startPage>=1);assert.equal(o.pageCount,6);
        const total=id==='DOC0'?pages:1,selected=Array.from({length:Math.min(6,total-o.startPage+1)},(_,i)=>o.startPage+i);
        windows.push([id,...selected]);
        const sections=selected.filter(p=>p!==badPage&&p!==blankPage).map(p=>({text:`PAGE ${p} OF ${id} : clause de financement et obligation documentaire. `+'Données complètes. '.repeat(35)+(p===1000?'CLAUSE_FINALE_MILLE':'FIN_PAGE'),source:{kind:'page',page:p}}));
        return {supported:true,total_pages:total,selected_pages:selected,pages_read:sections.map(s=>s.source.page),sections,text:sections.map(s=>s.text).join('\n'),source_fingerprint:'fp-'+id,
          needs_ocr_pages:selected.filter(p=>p===badPage||p===blankPage),ocr_pages:[],blank_pages:selected.filter(p=>p===blankPage),partial_pages:[]};
      }}};
  const d={ai:async(order,o)=>{
    const input=JSON.parse(o.input);assert.equal(input.mission.period_label,'2023-2024');
    if(input.notes)return {text:JSON.stringify({analysis_complete:true,summary:'Synthèse des passages, détails conservés dans les faits sourcés.',questions:[]})};
    analyses++;bytesSent+=input.fragments.reduce((n,p)=>n+p.text.length,0);
    const findings=input.fragments.map(p=>{seen.add(input.document.file_id+':'+p.page);return {fact:`Obligation ${input.document.file_id} page ${p.page}`,file_id:input.document.file_id,page:p.page,quote:p.text,reference:'Clause du passage',target:null};});
    return {text:JSON.stringify({analysis_complete:true,summary:'Faits documentaires à relire.',questions:['Quel est l’exercice audité ?'],findings})};
  }};
  const step={n:1,text:'Comprendre toutes les clauses.'};
  async function pass(body={}){return exhaustivePass('ORG','MISSION',structuredClone(view),step,body,{},d,h);}
  async function drain(initial){let r=initial||await pass();for(let i=0;r.pending&&i<3000;i++)r=await pass({read_job:r.read_job});assert.equal(r.pending,undefined);return r;}
  return {view,sources,h,d,step,pass,drain,seen,windows,stats:()=>({bytesSent,analyses})};
}

test('1000 pages and more than six documents: every page reaches analysis, including content beyond 60000 characters',async()=>{
  const f=fixture(),first=await f.pass();
  assert.equal(first.pending,true);assert.equal(first.read,0);assert.equal(f.stats().analyses,0);
  f.view.work.walkthrough[0].at='2020-01-01T00:00:00Z'; // no one-hour expiry for long audits
  const result=await f.drain(first);
  assert.equal(result.exhaustive,true);assert.equal(result.coverage.documents,8);
  assert.equal(result.coverage.pages,1007);assert.equal(result.coverage.pages_analysed,1007);
  assert.equal(f.seen.size,1007);assert.ok(f.seen.has('DOC0:1000'));assert.ok(f.stats().bytesSent>60000);
  assert.equal(result.findings.length,1007);assert.ok(result.findings.some(f=>f.quote.includes('CLAUSE_FINALE_MILLE')));
  assert.equal(result.questions.some(q=>/exercice audité/.test(q)),false);
  assert.equal(result.coverage.scope,'mission_documents');
});

test('a real 1000-page PDF can read the final window without a 64-page ceiling',async()=>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=1000;i++)pdf.addPage().drawText(`Page ${i} : obligation de reporting et preuve documentaire a conserver. ${i===1000?'CLAUSE_FINALE_MILLE':''}`,{font,size:10});
  const r=await readSopPdf(Buffer.from(await pdf.save()),{startPage:995,pageCount:6});
  assert.equal(r.total_pages,1000);assert.deepEqual(r.selected_pages,[995,996,997,998,999,1000]);
  assert.match(r.text,/CLAUSE_FINALE_MILLE/);assert.deepEqual(r.pages_read,[995,996,997,998,999,1000]);
});

test('unreadable pages prevent exhaustive status; positively identified blank pages are covered',async()=>{
  const f=fixture({pages:12,documents:1,badPage:3,blankPage:4});const r=await f.drain();
  assert.equal(r.exhaustive,false);assert.equal(r.docs[0].coverage[3],'unreadable');assert.equal(r.docs[0].coverage[4],'blank');
  assert.equal(r.coverage.pages_analysed,11);assert.match(r.unread[0].reason,/3/);
});

test('an incomplete analysis cannot advance the page cursor or claim coverage',async()=>{
  const f=fixture({pages:6,documents:1}),first=await f.pass();
  const good=f.d.ai;f.d.ai=async()=>({text:JSON.stringify({analysis_complete:false,summary:'Incomplete',findings:[]})});
  await assert.rejects(f.pass({read_job:first.read_job}),/DOCUMENT_BATCH_ANALYSIS_INCOMPLETE/);
  assert.equal(f.view.work.walkthrough[0].queue.length,1);assert.equal(f.view.work.walkthrough[0].docs[0].coverage[1],'pending');
  f.d.ai=good;assert.equal((await f.drain(first)).exhaustive,true);
});

test('stored mission context removes generic period questions but preserves a concrete period conflict',()=>{
  const questions=['Quel est l’exercice audité et la période de dépenses à couvrir ?','La période diffère de la mission : quelle explication ?','Quel amendement reporte la clôture ?'];
  assert.deepEqual(missionQuestions(questions,{period_label:'2023-2024'}),questions.slice(1));
  assert.deepEqual(missionQuestions(questions,{period_label:null}),questions);
});

test('all findings remain available through authorised pagination; pending raw content never reaches the browser',async()=>{
  const findings=Array.from({length:123},(_,i)=>({fact:'Fait '+i,source:'Agreement',quote:'Citation source vérifiable.'}));
  const work={walkthrough:[{kind:'sop-reading-job',version:4,id:'JOB',step:1,docs:[],ids:['A'],queue:[{text:'PRIVATE RAW TEXT'}],index:0},
    {kind:'sop-document-work',id:'PLAN',findings,questions:[],sources:[],coverage:{exhaustive:true}}]};
  const pub=publicWork(work);assert.equal(JSON.stringify(pub).includes('PRIVATE RAW TEXT'),false);
  assert.equal(pub.walkthrough[1].findings.length,50);assert.equal(pub.walkthrough[1].findings_total,123);
  const page=await readingReport('O','M','P',{plan_id:'PLAN',offset:100},{},{view:async()=>({work})});
  assert.equal(page.findings.length,23);assert.equal(page.findings[22].fact,'Fait 122');
  await assert.rejects(readingReport('O','OTHER','P',{plan_id:'PLAN'},{},{view:async()=>{throw new Error('NOT_YOUR_PROCEDURE');}}),/NOT_YOUR_PROCEDURE/);
});


test('a single dense page is analysed to its final character, without the old character ceiling',async()=>{
  const f=fixture({pages:1,documents:1}),text='Donnée documentaire lisible. '.repeat(5000)+'CLAUSE_TOUT_A_LA_FIN';
  const ranges=[];let lastSeen=false;
  f.h.drive.readText=async(id,o)=>o.verifyFingerprintOnly?{source_fingerprint:'fp-'+id}:{supported:true,source_fingerprint:'fp-'+id,total_pages:1,selected_pages:[1],sections:[{text,source:{kind:'page',page:1}}],needs_ocr_pages:[]};
  f.d.ai=async(order,o)=>{const input=JSON.parse(o.input);if(input.notes)return {text:JSON.stringify({analysis_complete:true,summary:'Synthèse',questions:[]})};for(const part of input.fragments){ranges.push([part.start,part.end]);if(part.text.includes('CLAUSE_TOUT_A_LA_FIN'))lastSeen=true;}return {text:JSON.stringify({analysis_complete:true,summary:'Passage examiné',questions:[],findings:[]})};};
  const r=await f.drain();assert.equal(r.exhaustive,true);assert.equal(lastSeen,true);assert.equal(ranges[0][0],0);assert.equal(ranges.at(-1)[1],text.length);
  for(let i=1;i<ranges.length;i++)assert.ok(ranges[i][0]<=ranges[i-1][1]);
});
