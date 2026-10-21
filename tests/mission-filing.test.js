import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMissionFiling } from '../lib/mission-filing.js';
import { reconcileReceivedDocuments } from '../lib/pbc-loop.js';
import { createMissionFolder, missionReference } from '../lib/mission-quick.js';
import { recordMissionDocuments } from '../lib/mission-files.js';
import { updateMissionRegister } from '../lib/mission-register.js';
import { acquireOfflineReaderLease } from '../lib/inspection-runtime.js';

const F='application/vnd.google-apps.folder';
function filing() {
  const items=new Map([['root',{id:'root',name:'Mission',mimeType:F,parents:['audit']}],['in',{id:'in',name:'PIECES_RECUES',mimeType:F,parents:['root']}],['contracts',{id:'contracts',name:'Conventions',mimeType:F,parents:['root']}],['mem',{id:'mem',name:'00_OFFICE_MANAGER',mimeType:F,parents:['root']}],['file',{id:'file',name:'scan.pdf',mimeType:'application/pdf',parents:['in'],modifiedTime:'1'}]]);
  const queued=[],auto=[];let enabled=true,allowed=true,status='READ_SUCCESS',target='contracts';
  const text='Convention de financement du projet. Le bailleur est la Banque.';
  const d={recordMissionDocuments:async()=>{},drive:{getMeta:async id=>items.get(id),listChildren:async id=>[...items.values()].filter(x=>x.parents.includes(id))},
    fetchRows:async p=>p.startsWith('office_missions')?[{id:'m',name:'Mission',drive_folder_id:'root'}]:[],
    agentPermissions:async()=>({granted:allowed}),agentSettings:async()=>({auto_filing:enabled}),
    readForTidy:async()=>({text,method:'native',inspection:{status}}),
    runAI:async()=>({text:JSON.stringify({decisions:[{file_id:'file',action:'move_rename',to_folder_id:target,new_name:'Convention.pdf',confidence:'haute',content_read:true,evidence_quote:'Convention de financement du projet.'}]})}),
    queueFilingProposal:async(o,row)=>{queued.push(row);return [{id:'action'}];},recordDecision:async(o,row)=>{auto.push(row);return {executed:true,verified:true};},audit:async()=>({db:true})};
  return {d,items,queued,auto,set:(v)=>{if('enabled'in v)enabled=v.enabled;if('allowed'in v)allowed=v.allowed;if('status'in v)status=v.status;if('target'in v)target=v.target;}};
}
test('controller uses Orpailleur brain, exact source passage, this mission only, and existing automatic-filing policy',async()=>{
  const w=filing();const r=await prepareMissionFiling('o','m',['file'],w.d);
  assert.equal(r.files[0].status,'filed_verified');assert.equal(w.queued[0].office_mission_id,'m');assert.equal(w.queued[0].payload.mission_root_id,'root');assert.equal(w.auto.length,1);
  const z=filing();z.set({enabled:false});assert.equal((await prepareMissionFiling('o','m',['file'],z.d)).files[0].status,'filing_pending');assert.equal(z.auto.length,0);
});
test('partial/unread documents are not auto-filed; invented/outside destinations, memory folders and unread permissions cannot pass',async()=>{
  const w=filing();w.set({status:'PARTIAL'});assert.equal((await prepareMissionFiling('o','m',['file'],w.d)).files[0].status,'filing_pending');assert.equal(w.auto.length,0);
  for(const target of ['other-mission','mem']) {const z=filing();z.set({target});const r=await prepareMissionFiling('o','m',['file'],z.d);assert.equal(r.files[0].status,'destination_outside_mission_refused');assert.equal(z.queued.length,0);}
  const a=filing();a.set({allowed:false});assert.equal((await prepareMissionFiling('o','m',['file'],a.d)).status,'agents_not_authorized');assert.equal(a.queued.length,0);
  const b=filing();b.d.runAI=async()=>({text:JSON.stringify({decisions:[{file_id:'file',action:'move',confidence:'haute',content_read:true,to_folder_id:'contracts',evidence_quote:'Une clause inventée et absente.'}]})});assert.equal((await prepareMissionFiling('o','m',['file'],b.d)).files[0].status,'classification_review_required');
});
test('PBC controller reconciliation creates needs once, attaches a documented candidate, never confirms it as received',async()=>{
  let rows=[],patches=[];const d={agentPermissions:async()=>({granted:true}),
    fetchRows:async(p,o={})=>{
      if(p.startsWith('office_missions'))return [{id:'m',period_label:'2023 et 2024'}];
      if(p.startsWith('office_work_programmes'))return [{id:'p',version:1,cycles:[{cycle_code:'PRJ',sop_file_id:'s',procedures:[{code:'PRJ-01',active:true}]}]}];
      if(p.startsWith('office_pbc_requests')&&o.method==='POST'){if(!rows.length)rows=JSON.parse(o.body).map((x,i)=>({...x,id:String(i)}));return [];}
      if(o.method==='PATCH'){const change=JSON.parse(o.body);patches.push(change);Object.assign(rows[0],change);return [];}
      return rows;
    },methodology:async()=>({sops:[{file_id:'s',cycle:{pbc:[{document:'convention complète'}]}}]}),missionDocuments:async()=>[{id:'file',type:'convention complète',summary:'Convention complète lue',period:'2023-2024'}]};
  const r=await reconcileReceivedDocuments('o','m',d);assert.equal(r.found.length,1);assert.equal(rows[0].status,'to_confirm');assert.equal(rows[0].created_by,'Mission Controller (IA)');
  await reconcileReceivedDocuments('o','m',d);assert.equal(rows.length,1);assert.equal(patches.length,1);
});
test('flat mission is moved under client/year keeping the same folder and document identities; unrelated type reference is not used',async()=>{
  assert.equal(missionReference([{cycle:'statutory',file_id:'wrong'}],{engagement_type:'project'}),null);
  const items=new Map([['audit',{id:'audit',name:'01_AUDIT',mimeType:F,parents:['drive']}],['mission',{id:'mission',name:'Mission',mimeType:F,parents:['audit']}],['doc',{id:'doc',name:'GL.xlsx',parents:['mission']}]]);
  const drive={getMeta:async id=>items.get(id),listChildren:async id=>[...items.values()].filter(f=>f.parents.includes(id)),findFilesByExactName:async(name,id)=>[...items.values()].filter(f=>f.name===name&&f.parents.includes(id))};
  const tidy={findOrCreateFolder:async(parent,name)=>{const old=[...items.values()].find(f=>f.name===name&&f.parents.includes(parent));if(old)return old;const f={id:'n'+items.size,name,parents:[parent],mimeType:F};items.set(f.id,f);return f;},move:async(id,from,to)=>{items.get(id).parents=[to];}};
  const m={id:'m',name:'Mission',client_name:'Client',created_at:'2026-10-19T00:00:00Z',period_label:'2023 et 2024',drive_folder_id:'mission'};
  const r=await createMissionFolder('o',m,{drive,tidy,documentReferences:async()=>[{document_type:'mission_root',document_role:'firm_reference',file_id:'audit'}],fetchRows:async(p,o={})=>o.method==='PATCH'?[]:[m],audit:async()=>({db:true})});
  assert.equal(r.id,'mission');assert.equal(r.relocated,true);assert.equal(r.year,'2026');assert.deepEqual(items.get('doc').parents,['mission']);assert.equal(items.get(items.get('mission').parents[0]).name,'2026');
});
test('re-registering a received document preserves its known content and PBC association instead of resetting them',async()=>{
  let state={missions:{m:{name:'Mission',documents:[{id:'f',name:'Convention.pdf',type:'convention',role:'convention',summary:'Lu',period:'2024',pbc_ref:'PBC-1',pbc_status:'RECEIVED_REVIEW_REQUIRED'}]}}};
  await recordMissionDocuments({id:'m',name:'Mission'},[{id:'f',name:'Convention.pdf',role:'piece_recue'}],{drive:{},folder:'memory',updateJsonFile:async(n,fn)=>{state=fn(state);return {state,fileId:'state'};}});
  assert.equal(state.missions.m.documents[0].role,'convention');assert.equal(state.missions.m.documents[0].pbc_ref,'PBC-1');assert.equal(state.missions.m.documents[0].summary,'Lu');
});
