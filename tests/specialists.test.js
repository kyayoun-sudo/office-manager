import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { specialistRouter } from '../lib/specialists/specialistRouter.js';
import { saveSpecialist, setPermission, decideCall, registry } from '../lib/specialists/specialistService.js';
import { specialistsAdmin } from '../lib/specialists/admin.js';
const org='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const actor={email:'manager@example.test',role:'owner'};

// Exercise actual SQL constraints and actual service REST filters; no external service.
async function fixture() {
  const pg=new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role; create table office_organizations(id uuid primary key); create table office_missions(id uuid primary key, org_id uuid);');
  await pg.exec(await readFile(new URL('../db/specialists.sql',import.meta.url),'utf8'));
  await pg.query('insert into office_organizations values ($1),($2)',[org,other]);
  const audit=[];
  const fetchRows=async(path,o={})=>{
    const [table,query]=path.split('?'),params=new URLSearchParams(query);const vals=[],where=[];
    for(const [k,v] of params) if(v.startsWith('eq.')) {assert.match(k,/^[a-z_]+$/);vals.push(k==='allowed' ? v.slice(3)==='true' : v.slice(3));where.push(`${k}=$${vals.length}`);}
    const suffix=where.length?' where '+where.join(' and '):'';
    const method=o.method || 'GET';
    if(method==='GET') {
      const order=params.get('order')?.split('.');
      return (await pg.query('select * from '+table+suffix+(order?' order by '+order[0]+(order[1]==='desc'?' desc':''):'')+(params.has('limit')?' limit '+Number(params.get('limit')):''),vals)).rows;
    }
    const body=JSON.parse(o.body),keys=Object.keys(body);
    if(method==='POST'){
      const conflict=params.get('on_conflict');const names=keys.join(',');
      return (await pg.query(`insert into ${table} (${names}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')})`+(conflict?` on conflict (${conflict}) do update set allowed=excluded.allowed`:'')+' returning *',Object.values(body))).rows;
    }
    const set=keys.map(k=>{vals.push(body[k]);return `${k}=$${vals.length}`;}).join(',');
    return (await pg.query('update '+table+' set '+set+suffix+' returning *',vals)).rows;
  };
  const d={fetchRows,audit:async(o,e)=>{audit.push({org:o,...e});return {db:true};}};
  const s=await saveSpecialist(org,{specialist_key:'mock-specialist',name:'Mock',adapter_type:'mock',enabled:true,requires_human_approval:true,capabilities:['mock.echo']},actor,d);
  await setPermission(org,{specialist_key:s.specialist_key,agent_key:'shadow',allowed:true},actor,d);
  return {pg,d,s,audit,router:specialistRouter({orgId:org,agentKey:'shadow',actor},d),request:{specialist_key:s.specialist_key,capability:'mock.echo',input:{message:'test'}}};
}
test('registry: complete SQL-backed mock flow, approval, structured advisory result and replay rejection',async()=>{
  const f=await fixture();try {
    const pending=await f.router.call(f.request);assert.equal(pending.status,'pending_approval');
    await decideCall(org,{call_id:pending.call_id,decision:'approve'},actor,f.d);
    const result=await f.router.call({...f.request,call_id:pending.call_id});
    assert.equal(result.authority,'advisory_only');assert.equal(result.sign_off,false);assert.equal(result.simulated,true);
    await assert.rejects(f.router.call({...f.request,call_id:pending.call_id}),/APPROVAL_INVALID/);
    const view=await registry(org,actor,f.d);assert.equal(view.scores[0].performance,1);assert.equal(view.calls[0].status,'succeeded');assert.ok(view.calls[0].result_hash);assert.ok(!('input' in view.calls[0]));
  }finally{await f.pg.close();}
});
test('registry: default deny, disable, capabilities, cross tenant and non-admin restrictions',async()=>{
  const f=await fixture();try {
    await assert.rejects(specialistRouter({orgId:org,agentKey:'sika',actor},f.d).call(f.request),/FORBIDDEN/);
    await assert.rejects(f.router.call({...f.request,capability:'audit.sign'}),/UNSUPPORTED/);
    assert.deepEqual((await registry(other,actor,f.d)).specialists,[]);
    await assert.rejects(specialistRouter({orgId:other,agentKey:'shadow',actor},f.d).call(f.request),/NOT_FOUND/);
    await assert.rejects(registry(org,{...actor,role:'auditor'},f.d),/ADMIN_REQUIRED/);
    await saveSpecialist(org,{...f.s,enabled:false},actor,f.d);await assert.rejects(f.router.call(f.request),/DISABLED/);
    const calls=await f.d.fetchRows('specialist_calls?org_id=eq.'+org);assert.equal(calls.length,3);
  }finally{await f.pg.close();}
});
test('registry: approval cannot authorize changed payload, agent, config, or a concurrent replay',async()=>{
  const f=await fixture();try {
    const p=await f.router.call(f.request);await decideCall(org,{call_id:p.call_id,decision:'approve'},actor,f.d);
    await assert.rejects(f.router.call({...f.request,input:{message:'changed'},call_id:p.call_id}),/APPROVAL_INVALID/);
    const results=await Promise.allSettled([f.router.call({...f.request,call_id:p.call_id}),f.router.call({...f.request,call_id:p.call_id})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const p2=await f.router.call(f.request);await decideCall(org,{call_id:p2.call_id,decision:'approve'},actor,f.d);
    await saveSpecialist(org,{...f.s,name:'Changed'},actor,f.d);await assert.rejects(f.router.call({...f.request,call_id:p2.call_id}),/APPROVAL_INVALID/);
    await assert.rejects(decideCall(org,{call_id:p2.call_id,decision:'approve'},{...actor,role:'it_admin'},f.d),/APPROVER_REQUIRED/);
  }finally{await f.pg.close();}
});
test('registry: all external adapters disconnected, stale admin writes rejected and no fake approval flag',async()=>{
  const f=await fixture();try {
    for(const type of ['mcp','rest','huggingface','internal']) {
      await assert.rejects(saveSpecialist(org,{...f.s,adapter_type:type},actor,f.d),/NOT_CONNECTED/);
      const adapter=await import('../lib/specialists/adapters/'+(type==='huggingface'?'huggingface':type)+'.js');await assert.rejects(adapter.invoke({}),/DISABLED_V1|NOT_REGISTERED/);
    }
    await assert.rejects(saveSpecialist(org,{...f.s,revision:0},actor,f.d),/CONFIG_CHANGED/);
    const p=await f.router.call({...f.request,approved:true});assert.equal(p.status,'pending_approval');
    await assert.rejects(specialistsAdmin(org,{action:'test'},{...actor,role:'auditor'},f.d),/ADMIN_REQUIRED/);
    const r=await f.pg.query("select relname,relrowsecurity from pg_class where relname in ('specialists','specialist_calls','specialist_permissions')");assert.ok(r.rows.every(x=>x.relrowsecurity));
    for(const table of ['specialists','specialist_calls','specialist_permissions']) {const a=await f.pg.query('select has_table_privilege($1,$2,$3) as allowed',['authenticated',table,'SELECT']);assert.equal(a.rows[0].allowed,false);}
  }finally{await f.pg.close();}
});
