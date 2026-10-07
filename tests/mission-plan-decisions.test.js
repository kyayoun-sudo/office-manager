import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {getPlanDecisions,decideMissionPlan,validatePlanDecision} from '../lib/mission-plan-decisions.js';
import {handleApp,ROUTES} from '../api/app.js';
const id='00000000-0000-0000-0000-000000000002',org='org-test';
const body={plan_id:id,request_id:id,content_hash:'a'.repeat(64),decision:'approve',note:'',expected_decision_id:null};

test('plan decision validates exact content, explicit concurrency cursor and refusal note',()=>{
  assert.equal(validatePlanDecision(body).p_content_hash,body.content_hash);
  for(const bad of [{...body,decision:'execute'},{...body,content_hash:'wrong'},{...body,expected_decision_id:undefined},{...body,note:'x'.repeat(1001)},{...body,decision:'reject',note:' '}])assert.throws(()=>validatePlanDecision(bad),/INVALID_PLAN_DECISION/);
});
test('plan journal is tenant scoped, preserves versions, never inherits approval',async()=>{
  const calls=[];
  const result=await getPlanDecisions(org,id,async path=>{
    calls.push(path);assert.match(path,/org_id=eq.org-test/);
    if(path.startsWith('office_missions?'))return[{id,name:'Synthetic'}];
    if(path.startsWith('office_mission_plan_versions?'))return[{id:'v2',version:2},{id:'v1',version:1}];
    return path.includes('plan_id=eq.v1')?[{id:'decision',decision:'approve'}]:[];
  });
  assert.equal(result.plans[0].last_decision,null);assert.equal(result.plans[1].last_decision.decision,'approve');assert.equal(result.executed,false);
  assert.equal(calls.length,4);
});
test('decision uses only restricted RPC, ignores forged org/actor, returns no execution',async()=>{
  const result=await decideMissionPlan(org,{...body,org_id:'forged',decided_by:'forged'},async(path,options)=>{
    assert.equal(path,'rpc/office_decide_mission_plan');const sent=JSON.parse(options.body);
    assert.equal(sent.p_org_id,org);assert.equal(sent.decided_by,undefined);return[{id:'decision'}];
  });
  assert.deepEqual(result,{decision:{id:'decision'},executed:false});
  await assert.rejects(decideMissionPlan(org,body,async()=>{throw new Error('SUPABASE_400 PLAN_SUPERSEDED');}),e=>e.message==='PLAN_SUPERSEDED'&&e.statusCode===409);
});
test('plan decision route requires both pilot and owner credentials before database access',async()=>{
  process.env.OFFICE_MANAGER_ACCESS_TOKEN='pilot-test';process.env.OFFICE_MANAGER_OWNER_TOKEN='owner-test';process.env.DEFAULT_ORG_ID=org;
  assert.equal(ROUTES['plan-decisions'].POST.ownerOnly,true);
  await assert.rejects(handleApp({method:'POST',query:{route:'plan-decisions'},headers:{'x-office-manager-token':'pilot-test'},body}),e=>e.statusCode===403);
  await assert.rejects(handleApp({method:'POST',query:{route:'plan-decisions'},headers:{'x-office-manager-token':'bad','x-office-manager-owner-token':'owner-test'},body}),e=>e.statusCode===401);
});
test('new screen scripts parse, render untrusted text safely and stay within function limit',()=>{
  new vm.Script(readFileSync(new URL('../assets/plan-validations.js',import.meta.url),'utf8'));
  const html=readFileSync(new URL('../plan-validations.html',import.meta.url),'utf8');assert.match(html,/id="reviewed" required/);
  assert.doesNotMatch(readFileSync(new URL('../assets/plan-validations.js',import.meta.url),'utf8'),/innerHTML/);
  assert.ok(readdirSync(new URL('../api/',import.meta.url)).filter(p=>p.endsWith('.js')).length<=12);
});
