import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { analyticalReviewContext, chooseAnalyticalManager, startAnalyticalReview } from '../lib/analytical-review.js';
import { setMissionFunction } from '../lib/mission-function.js';
const M='11111111-1111-1111-1111-111111111111', owner={role:'owner',email:'owner@example.test',display_name:'Propriétaire'};
function setup({emptyStaff=false,plannedStart='2026-10-01',plannedEnd='2026-10-31'}={}) {
  const staff=emptyStaff?[]:[{id:'person',org_id:'org',full_name:'Amina Manager',email:'amina@example.test',active:true},{id:'inactive',org_id:'org',full_name:'Ancien membre',email:'old@example.test',active:false}];
  const users=[{...owner,org_id:'org',active:true},{org_id:'org',email:'amina@example.test',display_name:'Amina Manager',role:'manager',active:true},{org_id:'org',email:'account@example.test',display_name:'Compte sans fiche',role:'manager',active:true}];
  const assignments=[],writes=[],files=new Map();
  const drive={findFilesByExactName:async n=>files.has(n)?[{id:n}]:[],downloadBuffer:async id=>Buffer.from(JSON.stringify(files.get(id))),getMeta:async()=>({}),createBinary:async({name,buffer})=>{files.set(name,JSON.parse(buffer));return{id:name};},updateBinary:async(id,{buffer})=>files.set(id,JSON.parse(buffer))};
  const d={drive,folder:'memory',audit:async()=>{},missionDocuments:async()=>[{id:'source',name:'Export_01.xlsx',deposit:'analytical_review_pending'}],
    fetchRows:async(path,o={})=>{
      const table=path.split('?')[0],params=new URLSearchParams(path.split('?')[1]);
      if(table==='office_missions')return[{id:M,name:'Audit',drive_folder_id:'mission',planned_start:plannedStart,planned_end:plannedEnd}];
      const rows=table==='office_staff_profiles'?staff:table==='office_app_users'?users:table==='office_mission_assignments'?assignments:[];
      const match=r=>['org_id','office_mission_id','id','email'].every(key=>{const v=params.get(key);return !v||v.startsWith('eq.')? !v||String(r[key])===v.slice(3):v.startsWith('in.(')?v.slice(4,-1).split(',').includes(String(r[key])):true;})&&(!params.get('active')||r.active===true)&&(!params.get('status')||!['completed','cancelled','canceled','rejected'].includes(r.status));
      if(o.method==='POST'){const body=JSON.parse(o.body);assert.equal(body.org_id,'org');if(table==='office_mission_assignments'){assert(body.planned_start,'planned_start is NOT NULL');assert(body.planned_end,'planned_end is NOT NULL');assert.notEqual(body.allocation_pct,null);}writes.push({table,body});let r=rows.find(x=>x.id===body.id);if(r)Object.assign(r,body);else{r={...body};rows.push(r);}return[r];}
      if(o.method==='PATCH'){const body=JSON.parse(o.body);writes.push({table,body});rows.filter(match).forEach(r=>Object.assign(r,body));return[];}
      assert.equal(params.get('org_id'),'eq.org');return rows.filter(match).map(r=>({...r}));
    }};
  return{d,staff,users,assignments,writes};
}
test('manager menu contains active firm members before any mission assignment, without writes',async()=>{
 const {d,writes}=setup();const r=await analyticalReviewContext('org',M,owner,d);
 assert.equal(r.team.length,0);assert(r.manager_candidates.some(p=>p.full_name==='Amina Manager'));assert(r.manager_candidates.some(p=>p.full_name==='Compte sans fiche'));assert(!r.manager_candidates.some(p=>p.full_name==='Ancien membre'));assert.equal(r.manager_candidates.filter(p=>p.email==='amina@example.test').length,1);assert.equal(writes.length,0);
});
test('selecting an unassigned member attaches them and unblocks launch with arbitrary file names',async()=>{
 const {d,assignments}=setup();await chooseAnalyticalManager('org',M,'staff:person',owner,d);
 assert.equal(assignments.length,1);assert.equal(assignments[0].mission_function,'manager');
 const ctx=await analyticalReviewContext('org',M,owner,d);assert.equal(ctx.manager.full_name,'Amina Manager');assert.equal(ctx.manager_required,false);
 let payload;d.startAuditorReview=async(o,r,b)=>{payload=b;return{started:true};};await startAnalyticalReview('org',{},M,owner,d);assert.deepEqual(payload.evidence_files,['source']);
 await chooseAnalyticalManager('org',M,'staff:person',owner,d);assert.equal(assignments.length,1);
});
test('active account without synced staff profile can be selected and gets only its own profile',async()=>{
 const {d,staff,assignments}=setup({emptyStaff:true});await chooseAnalyticalManager('org',M,'user:account@example.test',owner,d);
 assert.equal(staff.length,1);assert.equal(staff[0].email,'account@example.test');assert.equal(assignments[0].mission_function,'manager');
});
test('single-person owner may explicitly take responsibility without changing account grades',async()=>{
 const {d,users,assignments}=setup({emptyStaff:true});await chooseAnalyticalManager('org',M,'user:owner@example.test',owner,d);
 assert.equal(assignments[0].mission_function,'manager');assert.equal(users[0].role,'owner');
 await assert.rejects(setMissionFunction('org',{mission_id:M,assignment_id:assignments[0].id,function:'partner'},owner,d),/NO_SELF_FUNCTION_CHANGE/);
});
test('ordinary members cannot appoint themselves or anyone, and invented or inactive candidates are rejected',async()=>{
 const {d,writes}=setup();await assert.rejects(chooseAnalyticalManager('org',M,'staff:person',{role:'manager',email:'amina@example.test'},d),/PARTNER_SETS_LEAD_FUNCTIONS/);
 await assert.rejects(chooseAnalyticalManager('org',M,'staff:inactive',owner,d),/MANAGER_CANDIDATE_NOT_AVAILABLE/);
 await assert.rejects(chooseAnalyticalManager('org',M,'user:external@example.test',owner,d),/MANAGER_CANDIDATE_NOT_AVAILABLE/);assert.equal(writes.length,0);
});

const html=await readFile(new URL('../revue-analytique.html',import.meta.url),'utf8');
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
function page({hasManager=false,docs=[],missionDates=true}={}) {
 const nodes=new Map(),calls=[],storage=new Map();let ready,review={status:'none'};
 let ctx={mission:{name:'Mission',period_label:'2026',planned_start:missionDates?'2026-10-01':null,planned_end:missionDates?'2026-10-31':null},manager:hasManager?{full_name:'Amina'}:null,manager_required:!hasManager,can_choose_manager:true,team:[],manager_candidates:[{id:'staff:person',full_name:'Amina Manager',email:'amina@example.test'}],documents:docs,requirements:[{key:'trial_balance_current',label:'Balance N',required:true,match_terms:['balance generale']},{key:'trial_balance_prior',label:'Balance N-1',required:true,match_terms:['balance n-1']},{key:'general_ledger',label:'Grand livre',required:true,match_terms:['grand livre']}],finalized:false};
 function element(tag='div') {
   const classes=new Set();let content='';
   const n={tag,value:'',hidden:false,disabled:false,files:[],children:[],attrs:{},listeners:{},className:'',
    setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},appendChild(x){this.children.push(x);return x;},addEventListener(k,fn){this.listeners[k]=fn;},
    classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},click(){if(!this.disabled&&this.onclick)this.onclick();}};
   Object.defineProperty(n,'id',{set(id){nodes.set(id,n);},get(){return [...nodes].find(([,x])=>x===n)?.[0];}});
   Object.defineProperty(n,'textContent',{set(v){content=v;this.children=[];},get(){return content;}});
   Object.defineProperty(n,'childNodes',{get(){return this.children;}});return n;
 }
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const UI={el:(tag,text,cls)=>{const n=element(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;},safeLink:(url,text)=>{const n=element('a');n.href=url;n.textContent=text;return n;},table:()=>element('table'),requireLogin:fn=>{ready=fn();}};
 const OM={api:async(url,o={})=>{
  calls.push({url,body:o.body?JSON.parse(o.body):null});
  if(url.startsWith('/api/app?route=analytical-review&'))return structuredClone(ctx);
  if(url.includes('route=auditor'))return structuredClone(review);
  const b=JSON.parse(o.body||'{}');
  if(b.action==='refresh-lab')return{};
  if(b.action==='choose-manager'){ctx.manager={full_name:'Amina'};ctx.manager_required=false;return{};}
  if(b.action==='start'){review={status:'running',stage:'analytical',focus:'[REVUE_ANALYTIQUE_PRELIMINAIRE]'};return{started:true};}
  if(b.action==='piece')return{file_id:'imported',name:b.name};
  if(b.action==='pieces-done')return{};
  if(b.action==='import-review'){ctx.finalized=true;review={status:'done',focus:'[REVUE_ANALYTIQUE_PRELIMINAIRE]',summary:'Revue importée'};return{imported:true,finalized:true};}
  throw Error('Unexpected API action: '+b.action);
 }};
 class FileReader{readAsDataURL(){this.result='data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,dGVzdA==';this.onload();}}
 vm.runInNewContext(script,{window:{OfficeManager:OM,OMScreens:UI},document:{getElementById:get,createElement:element},location:{search:'?mission_id='+M},sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)},URLSearchParams,FileReader,confirm:()=>true,setTimeout:()=>0});
 return{get,calls,ready,ctx};
}
test('UI offers real manager names when the mission team is empty and selection enables review',async()=>{
 const p=page({docs:[{id:'piece',name:'export_01.xlsx',deposit:'analytical_review_pending'}]});await p.ready;await flush();
 p.get('path-app').click();assert.equal(p.get('app-path').hidden,false);
 const select=p.get('manager-select');assert(select.children.some(n=>n.textContent.includes('Amina Manager')));assert.equal(p.get('run-review').disabled,true);
 select.value='staff:person';select.onchange();const button=p.get('manager-content').children[0].children[1];button.click();await flush();
 assert(p.calls.some(c=>c.body?.action==='choose-manager'&&c.body.candidate_id==='staff:person'));assert.equal(p.get('run-review').disabled,false);
 p.get('run-review').click();await flush();assert(p.calls.some(c=>c.body?.action==='start'));assert.equal(p.get('run-review').disabled,true);
});
test('UI accepts completed Excel import without a manager or source pieces',async()=>{
 const p=page();await p.ready;await flush();p.get('path-import').click();assert.equal(p.get('import-path').hidden,false);assert.equal(p.get('app-path').hidden,true);
 p.get('review-file').files=[{name:'Revue_client.xlsx',type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:100}];p.get('review-upload').click();await flush();
 assert(p.calls.some(c=>c.body?.action==='import-review'));assert(!p.calls.some(c=>c.body?.action==='choose-manager'||c.body?.action==='start'));assert.equal(p.get('programme').getAttribute('aria-disabled'),'false');assert.match(p.get('review-status').textContent,/Revue importée et terminée/);
});
test('UI only blocks generated review for absent manager, absent pieces, or an ongoing review, not name recognition',async()=>{
 const p=page({hasManager:true,docs:[{id:'client',name:'export_01.xlsx',deposit:'analytical_review_pending'},{id:'working',name:'Balance N-1.xlsx',deposit:'analytical_review_template'}]});await p.ready;await flush();assert.equal(p.get('run-review').disabled,false);assert.match(p.get('run-status').textContent,/nom des fichiers ne bloque pas/);
 const empty=page({hasManager:true,docs:[{id:'working',name:'Balance N-1.xlsx',deposit:'analytical_review_template'}]});await empty.ready;await flush();assert.equal(empty.get('run-review').disabled,true);
});

test('partner can accept manager responsibility only through this explicit setup, without self-promotion',async()=>{
 const {d,users,assignments}=setup({emptyStaff:true});const partner={role:'partner',email:'partner@example.test',display_name:'Associé'};users.push({...partner,org_id:'org',active:true});
 await chooseAnalyticalManager('org',M,'user:partner@example.test',partner,d);assert.equal(assignments[0].mission_function,'manager');
 await assert.rejects(setMissionFunction('org',{mission_id:M,assignment_id:assignments[0].id,function:'manager'},partner,d),/NO_SELF_FUNCTION_CHANGE/);
 assert.equal(users.at(-1).role,'partner');
});


test('new manager assignment includes the mission dates and an explicit allocation; retry preserves existing planning',async()=>{
 const {d,assignments}=setup();await chooseAnalyticalManager('org',M,'staff:person',owner,d);
 assert.equal(assignments[0].planned_start,'2026-10-01');assert.equal(assignments[0].planned_end,'2026-10-31');assert.equal(assignments[0].allocation_pct,0);
 assignments[0].planned_start='2026-10-07';assignments[0].allocation_pct=25;
 await chooseAnalyticalManager('org',M,'staff:person',owner,d);assert.equal(assignments[0].planned_start,'2026-10-07');assert.equal(assignments[0].allocation_pct,25);
});
test('missing dates cause an actionable validation error before creating any profile or assignment',async()=>{
 const {d,writes}=setup({emptyStaff:true,plannedStart:null,plannedEnd:null});
 await assert.rejects(chooseAnalyticalManager('org',M,'user:account@example.test',owner,d),/MANAGER_ASSIGNMENT_DATES_REQUIRED/);assert.equal(writes.length,0);
 await chooseAnalyticalManager('org',M,'user:account@example.test',owner,d,{planned_start:'2026-10-23',planned_end:'2026-10-31'});
 assert(writes.some(x=>x.table==='office_mission_assignments'&&x.body.planned_start==='2026-10-23'));
});
test('invalid calendar dates or a reversed range never reach the database',async()=>{
 const {d,writes}=setup({plannedStart:null,plannedEnd:null});
 for(const dates of [{planned_start:'2026-02-30',planned_end:'2026-03-31'},{planned_start:'2026-10-31',planned_end:'2026-10-01'}]) await assert.rejects(chooseAnalyticalManager('org',M,'staff:person',owner,d,dates),/MANAGER_ASSIGNMENT_DATES_INVALID/);
 assert.equal(writes.length,0);
});
test('UI asks for missing dates beside the manager selection and submits them',async()=>{
 const p=page({missionDates:false});await p.ready;await flush();const select=p.get('manager-select');select.value='staff:person';select.onchange();
 const button=p.get('manager-content').children[0].children[1];assert.equal(button.disabled,true);assert.equal(p.get('manager-content').children[1].hidden,false);
 p.get('manager-start').value='2026-10-23';p.get('manager-end').value='2026-10-31';p.get('manager-end').onchange();assert.equal(button.disabled,false);button.click();await flush();
 const call=p.calls.find(c=>c.body?.action==='choose-manager');assert.equal(call.body.planned_start,'2026-10-23');assert.equal(call.body.planned_end,'2026-10-31');
});
test('real PostgreSQL NOT NULL constraints reproduce the screenshot and accept the corrected payload',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();
 try{
  await db.exec('create table office_mission_assignments(id text primary key, planned_start date not null, planned_end date not null, allocation_pct numeric not null check(allocation_pct between 0 and 100))');
  await assert.rejects(db.query('insert into office_mission_assignments(id) values ($1)',['old']),e=>e.code==='23502');
  const {d,assignments}=setup();await chooseAnalyticalManager('org',M,'staff:person',owner,d);const row=assignments[0];
  await db.query('insert into office_mission_assignments values ($1,$2,$3,$4)',[row.id,row.planned_start,row.planned_end,row.allocation_pct]);
  const saved=await db.query('select planned_start::text as start, planned_end::text as end, allocation_pct::text as allocation from office_mission_assignments');
  assert.deepEqual(saved.rows,[{start:'2026-10-01',end:'2026-10-31',allocation:'0'}]);
 }finally{await db.close();}
});
