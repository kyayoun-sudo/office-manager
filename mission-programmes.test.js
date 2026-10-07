import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {prepareProgramme} from '../assets/programme-models.js';
import {validateProgramme,getProgramme,saveProgramme} from '../lib/mission-programmes.js';
import {handleApp} from '../api/app.js';
const id='00000000-0000-0000-0000-000000000002',hash='a'.repeat(64);
const plan={id,phases:['Cadrage','Cartographie du parcours','Diagnostic','Conception cible','Plan de mise en œuvre et restitution']};
const valid=()=>({plan_id:id,plan_hash:hash,expected_programme_id:null,phases:prepareProgramme(plan,'client-journey')});
test('programme model is editable, covers phases, proposes roles without staff IDs or evidence claims',()=>{
  const phases=prepareProgramme(plan,'client-journey');assert.equal(phases.length,5);
  assert.equal(validateProgramme(valid()).p_phases.length,5);
  phases[0].tasks[0].expected_documents.push('New');assert.equal(prepareProgramme(plan,'client-journey')[0].tasks[0].expected_documents.length,2);
  assert.throws(()=>prepareProgramme({phases:['Payroll','Tax','Audit','Legal','Billing']},'client-journey'),/MODEL_DOES_NOT_MATCH_PLAN/);
  assert.doesNotMatch(JSON.stringify(phases),/staff_profile_id|content_verified_at|approved/);
});
test('programme validates structure, mandatory fields, real calendar dates and bounded size',()=>{
  const invalid=[];
  const a=valid();a.phases[0].phase_index=2;invalid.push(a);
  const b=valid();b.phases[0].tasks[0].procedure='';invalid.push(b);
  const c=valid();c.phases[0].tasks[0].due_on='2026-02-30';invalid.push(c);
  const d=valid();d.phases[0].tasks[0].staff_profile_id=id;invalid.push(d);
  const e=valid();delete e.expected_programme_id;invalid.push(e);
  invalid.forEach(body=>assert.throws(()=>validateProgramme(body),/INVALID_PROGRAMME/));
});
test('programme read preserves historical source phases and tenant scope',async()=>{
  const data=await getProgramme('org',id,async path=>{
    assert.match(path,/org_id=eq.org/);
    if(path.startsWith('office_missions?'))return[{id,name:'Synthetic'}];
    if(path.startsWith('office_mission_programme_versions?'))return[{id:'programme',plan_id:id,version:1,phases:[]}];
    if(path.startsWith('office_mission_plan_decisions?'))return[{decision:'defer'}];
    if(path.includes('&id=in.'))return[{id,version:1,phases:['Old phase']}];
    return[{id:'new-plan',version:2,phases:['New phase']}];
  });
  assert.equal(data.programmes[0].source_plan_phases[0],'Old phase');assert.equal(data.plan_approved,false);assert.equal(data.executed,false);assert.equal(data.status,'proposal_only');
});
test('programme saves only through restricted RPC with server org and maps stale version to conflict',async()=>{
  const data=await saveProgramme('org',{...valid(),org_id:'forged'},async(path,options)=>{
    assert.equal(path,'rpc/office_save_mission_programme');assert.equal(JSON.parse(options.body).p_org_id,'org');return[{id:'saved'}];
  });assert.equal(data.executed,false);assert.equal(data.status,'proposal_only');
  await assert.rejects(saveProgramme('org',valid(),async()=>{throw new Error('SUPABASE_400 PROGRAMME_CHANGED');}),e=>e.statusCode===409);
});
test('programme route rejects unauthenticated saves and keeps function count',async()=>{
  process.env.OFFICE_MANAGER_ACCESS_TOKEN='test';
  await assert.rejects(handleApp({method:'POST',query:{route:'mission-programme'},headers:{'x-office-manager-token':'wrong'},body:valid()}),e=>e.statusCode===401);
  assert.ok(readdirSync(new URL('../api/',import.meta.url)).filter(f=>f.endsWith('.js')).length<=12);
  assert.doesNotMatch(readFileSync(new URL('../assets/mission-programme.js',import.meta.url),'utf8'),/innerHTML/);
});
