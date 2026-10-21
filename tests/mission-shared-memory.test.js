import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { syncMissionSharedMemory, SHARED_MEMORY, MISSION_LOG } from '../lib/mission-shared-memory.js';
import { acquireOfflineReaderLease } from '../lib/inspection-runtime.js';
import { organizedMissionParent, missionYear } from '../lib/mission-layout.js';

const O='11111111-1111-4111-8111-111111111111',M='22222222-2222-4222-8222-222222222222';
const F='application/vnd.google-apps.folder';
function world() {
  let seq=0;const store=new Map(),events=[];
  const add=(id,name,parent,state=null,mimeType='application/json')=>{const f={id,name,parents:[parent],mimeType,modifiedTime:String(++seq),buffer:state===null?null:Buffer.from(JSON.stringify(state))};store.set(id,f);return f;};
  add('root','Mission','audit',null,F);add('central','Central','home',null,F);
  add('files','OFFICE_MANAGER_MISSION_FILES.json','central',{missions:{[M]:{documents:[{id:'evidence',name:'Convention',role:'convention',summary:'Contenu lu'}]}}});
  add('data','OFFICE_MANAGER_MISSION_DATA.json','central',{missions:{[M]:{facts:[{agent:'sika',kind:'budget',label:'Honoraires',value:'100',source:'contrat'}],contacts:[]}}});
  const mission={id:M,org_id:O,name:'Mission',client_name:'Client',drive_folder_id:'root',period_label:'2023 et 2024'};
  const drive={getMeta:async id=>store.get(id),listChildren:async id=>[...store.values()].filter(f=>f.parents.includes(id)),findFilesByExactName:async(name,parent)=>[...store.values()].filter(f=>f.name===name&&f.parents.includes(parent)),downloadBuffer:async id=>store.get(id).buffer,
    createBinary:async({name,parentId,buffer,mimeType})=>{const f=add('new'+seq,name,parentId,null,mimeType);f.buffer=buffer;return f;},
    updateBinary:async(id,{buffer,expectedModifiedTime})=>{const f=store.get(id);if(expectedModifiedTime && f.modifiedTime!==expectedModifiedTime)throw new Error('MEMORY_CONFLICT');f.buffer=buffer;f.modifiedTime=String(++seq);}};
  const tidy={findOrCreateFolder:async(parent,name)=>{const old=[...store.values()].find(f=>f.name===name&&f.parents.includes(parent));return old || add('dir'+seq,name,parent,null,F);}};
  const fetchRows=async(path,o={})=>{
    if(path.startsWith('office_missions')){if(o.method==='PATCH'){Object.assign(mission,JSON.parse(o.body));return [];}return path.includes('org_id=eq.'+O)?[mission]:[];}
    if(path.startsWith('office_mission_change_log')) {const cursor=Number(new URLSearchParams(path.split('?')[1]).get('seq').slice(3));return events.filter(e=>e.seq>cursor).slice(0,200);}
    if(path.startsWith('office_work_programmes'))return [{id:'p',version:2,status:'validated',workpapers:[{cycle_code:'PRJ',file_id:'wp'}]}];
    return [];
  };
  const d={drive,tidyDrive:tidy,folder:'central',fetchRows,acquireLease:async(o,scope)=>acquireOfflineReaderLease({org:o,...scope})};
  return {store,add,drive,tidy,mission,events,d};
}

test('a newer draft never replaces the validated programme and its working-file links in shared context',async()=>{
  const w=world(),base=w.d.fetchRows;
  const versions=[{id:'draft',version:3,status:'draft',workpapers:[]},{id:'active',version:2,status:'validated',workpapers:[{file_id:'real-cabinet-copy'}]}];
  w.d.fetchRows=async(path,o)=>path.startsWith('office_work_programmes')?versions.filter(p=>!path.includes('status=eq.validated')||p.status==='validated').slice(0,1):base(path,o);
  const out=await syncMissionSharedMemory(O,M,w.d);
  assert.equal(out.memory.snapshot.programme.id,'active');assert.equal(out.memory.snapshot.programme.workpapers[0].file_id,'real-cabinet-copy');
});
test('one shared cache and one log persist signed facts, full inventory, period and programme; no file per agent/pass',async()=>{
  const w=world();w.events.push({seq:1,actor:'enhanced-auditor',operation:'UPDATE'});
  const first=await syncMissionSharedMemory(O,M,w.d);assert.equal(first.status,'synced');
  assert.equal(first.memory.snapshot.knowledge.facts[0].agent,'sika');assert.equal(first.memory.snapshot.mission.period_label,'2023 et 2024');
  const second=await syncMissionSharedMemory(O,M,w.d);assert.equal(first.file_id,second.file_id);assert.equal(first.audit_file_id,second.audit_file_id);
  assert.equal([...w.store.values()].filter(f=>[SHARED_MEMORY,MISSION_LOG].includes(f.name)).length,2);
  assert.equal(JSON.parse(w.store.get(first.audit_file_id).buffer).events.length,1);
  w.events.push({seq:2,actor:'mission-controller',operation:'INSERT'});const third=await syncMissionSharedMemory(O,M,w.d);assert.equal(JSON.parse(w.store.get(third.audit_file_id).buffer).events.length,2);
});
test('cache never crosses firms or overwrites corrupt/duplicate memory; failed lookup never creates an empty replacement',async()=>{
  const w=world();await assert.rejects(syncMissionSharedMemory('33333333-3333-4333-8333-333333333333',M,w.d),/MISSION_NOT_FOUND/);
  const r=await syncMissionSharedMemory(O,M,w.d);const before=w.store.size;w.store.get(r.file_id).buffer=Buffer.from('{bad');
  await assert.rejects(syncMissionSharedMemory(O,M,w.d),/UNREADABLE/);assert.equal(w.store.size,before);
  w.store.get(r.file_id).buffer=Buffer.from(JSON.stringify({...r.memory,org_id:'other'}));await assert.rejects(syncMissionSharedMemory(O,M,w.d),/SCOPE_MISMATCH/);
  const f=world();f.drive.findFilesByExactName=async()=>{throw new Error('LOOKUP_FAILED');};await assert.rejects(syncMissionSharedMemory(O,M,f.d),/LOOKUP_FAILED/);
  assert.equal([...f.store.values()].filter(x=>x.name===SHARED_MEMORY).length,0);
});
test('concurrent cache writers serialize; an interrupted export resumes without duplicating or truncating history',async()=>{
  const w=world();for(let i=1;i<=205;i++)w.events.push({seq:i,actor:'sika'});
  const out=await Promise.all([syncMissionSharedMemory(O,M,w.d),syncMissionSharedMemory(O,M,w.d)]);assert.equal(out.filter(x=>x.status==='busy').length,1);
  const a=out.find(x=>x.status==='synced');assert.equal(a.audit_pending,true);
  const b=await syncMissionSharedMemory(O,M,w.d);assert.equal(b.audit_pending,false);assert.equal(JSON.parse(w.store.get(b.audit_file_id).buffer).events.length,205);
});
test('mission hierarchy reuses client/year or year/client; the audited period is never mistaken for the mission year',async()=>{
  const w=world();w.mission.created_at='2026-10-19T00:00:00Z';w.mission.planned_start='2027-01-02';
  assert.deepEqual(missionYear(w.mission),{year:'2027',source:'planned_start'});
  const root={id:'root'};let layout=await organizedMissionParent(root,w.mission,w.drive,w.tidy);
  assert.equal(layout.layout,'client/year/mission');assert.equal(w.store.get(layout.id).name,'2027');
  const count=w.store.size;assert.equal((await organizedMissionParent(root,w.mission,w.drive,w.tidy)).id,layout.id);assert.equal(w.store.size,count);
  const z=world();z.mission.created_at='2026-10-19T00:00:00Z';z.add('year','2026','root',null,F);
  layout=await organizedMissionParent({id:'root'},z.mission,z.drive,z.tidy);assert.equal(layout.layout,'year/client/mission');assert.equal(z.store.get(layout.client_folder_id).parents[0],'year');
  z.add('duplicate','Client','root',null,F);await assert.rejects(organizedMissionParent({id:'root'},z.mission,z.drive,z.tidy),/AMBIGUOUS/);
});
test('actual SQL: every mission change is append-only, hashed, tenant scoped, and protected from browser access',async()=>{
  const pg=new PGlite();try {
    await pg.exec('create role anon;create role authenticated;create role service_role;create table office_missions(id uuid primary key,org_id uuid,name text);create table office_pbc_requests(id uuid primary key,org_id uuid,office_mission_id uuid,status text,created_by text);');
    await pg.exec(await readFile(new URL('../db/mission-shared-memory.sql',import.meta.url),'utf8'));
    await pg.query('insert into office_missions(id,org_id,name) values ($1,$2,$3)',[M,O,'Client']);
    await pg.query('insert into office_pbc_requests values ($1,$2,$3,$4,$5)',['33333333-3333-4333-8333-333333333333',O,M,'needed','Mission Controller (IA)']);
    await pg.exec("update office_pbc_requests set status='to_confirm';");
    const rows=(await pg.query('select * from office_mission_change_log order by seq')).rows;
    assert.equal(rows.length,3);assert.equal(rows[1].actor,'Mission Controller (IA)');assert.equal(rows[2].actor_kind,'technical');assert.deepEqual(rows[2].changes.status,{before:'needed',after:'to_confirm'});assert.deepEqual(rows[2].changed_keys,['status']);assert.equal(rows[2].after_hash.length,64);
    assert.ok(!('content' in rows[2]));
    const acl=(await pg.query("select has_table_privilege('authenticated','office_mission_change_log','SELECT') as browser,has_table_privilege('service_role','office_mission_change_log','DELETE') as deletable")).rows[0];assert.equal(acl.browser,false);assert.equal(acl.deletable,false);
  }finally{await pg.close();}
});
