import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, saveMissionPlan } from '../lib/mission-plans.js';
import handler from '../api/mission-plans.js';
const id='d64b9ce0-510a-4c6b-bc75-4b2a3bba6021';
test('plan input preserves exact text and rejects malformed or excessive phases',()=>{
  const content='  Synthetic plan\nExact text  ';
  assert.equal(validatePlan({mission_id:id,content,phases:['Cadrage']}).content,content);
  for(const phases of [[1],Array(21).fill('Phase'),['']]) {
    assert.throws(()=>validatePlan({mission_id:id,content,phases}),/INVALID_PLAN/);
  }
  assert.throws(()=>validatePlan({mission_id:'bad',content,phases:[]}),/VALID_MISSION_ID_REQUIRED/);
});
test('plan save scopes to server org and cannot take approval from client',async()=>{
  process.env.SUPABASE_URL='https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    return new Response(JSON.stringify(url.includes('/rpc/')?{id:'synthetic',version:1}:[{id}]));
  };
  try {
    const p=await saveMissionPlan('server-org',{mission_id:id,content:'Synthetic',phases:[],approved:true,org_id:'attacker'});
    assert.equal(p.version,1);
    assert.ok(calls[0].url.includes('org_id=eq.server-org'));
    const body=JSON.parse(calls[1].options.body);
    assert.equal(body.p_org_id,'server-org');
    assert.equal(body.approved,undefined);
  }finally{globalThis.fetch=original;}
});
test('plan route refuses unauthorized saves',async()=>{
  process.env.OFFICE_MANAGER_ACCESS_TOKEN='synthetic';
  const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  await handler({method:'POST',headers:{},body:{}},res);
  assert.equal(res.code,401);
});
