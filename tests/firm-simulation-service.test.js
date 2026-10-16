import test from 'node:test';
import assert from 'node:assert/strict';
import {firmAction,firmView} from '../lib/firm-simulation-service.js';
import {referenceAnswer} from '../lib/firm-simulation.js';
const owner={role:'owner',email:'owner@simulation.invalid'};
function harness(){let lab={};return {get lab(){return lab;},loadLab:async()=>structuredClone(lab),changeLab:async fn=>{const copy=structuredClone(lab);const out=fn(copy);lab=copy;return out;}};}
test('reference results persist per organisation and cannot contaminate AI campaign',async()=>{
 const d=harness();await firmAction('A',owner,{action:'firm-create',mode:'reference'},d);
 await firmAction('A',owner,{action:'firm-reference',mode:'reference',limit:500},d);
 const r=await firmView('A',{...d,mode:'reference'});assert.equal(r.campaign.status,'completed');
 assert.equal((await firmView('B',{...d,mode:'reference'})).campaign,null);
 assert.equal((await firmView('A',d)).campaign,null);
 await assert.rejects(firmAction('A',owner,{action:'firm-ai-step',mode:'reference'},d),/AI_MODE/);
 await assert.rejects(firmAction('A',{role:'junior'},{action:'firm-create'},d),/PARTNERS/);
});
test('AI adapter gets existing root instructions, persists results, enforces separate call budget',async()=>{
 const d=harness();await firmAction('A',owner,{action:'firm-create',max_calls:1},d);await firmAction('A',owner,{action:'firm-start'},d);
 let calls=0;d.ai=async(order,args)=>{calls++;assert.ok(args.instructions.includes('Grand Contrôleur'));const ctx=JSON.parse(args.input);assert.ok(!('expected' in ctx));return {provider:'test-double',model:'stub',text:JSON.stringify(referenceAnswer(d.lab['firm_simulation:A:ai']))};};
 await firmAction('A',owner,{action:'firm-ai-step'},d);assert.equal(calls,1);
 const r=await firmView('A',d);assert.equal(r.campaign.results.ai_events,1);assert.equal(r.campaign.budget.calls,1);
 await firmAction('A',owner,{action:'firm-ai-step'},d);assert.equal(calls,1);
 assert.equal((await firmView('A',d)).campaign.blocker,'SIMULATION_CALL_BUDGET_REACHED');
});
test('provider failure is resumable and consumes reserved call without losing previous state',async()=>{
 const d=harness();await firmAction('A',owner,{action:'firm-create'},d);await firmAction('A',owner,{action:'firm-start'},d);
 d.ai=async()=>{throw Error('PROVIDER_UNAVAILABLE');};await assert.rejects(firmAction('A',owner,{action:'firm-ai-step'},d),/PROVIDER/);
 const r=await firmView('A',d);assert.equal(r.campaign.status,'paused');assert.equal(r.campaign.budget.calls,1);assert.equal(r.campaign.lease,undefined);
 await firmAction('A',owner,{action:'firm-start'},d);assert.equal((await firmView('A',d)).campaign.status,'running');
});
test('concurrent call lease rejects duplicate work and retains one result',async()=>{
 const d=harness();await firmAction('A',owner,{action:'firm-create'},d);await firmAction('A',owner,{action:'firm-start'},d);
 let release,entered;const started=new Promise(r=>entered=r);d.ai=async()=>{entered();await new Promise(r=>release=r);return {provider:'stub',text:JSON.stringify(referenceAnswer(d.lab['firm_simulation:A:ai']))};};
 const first=firmAction('A',owner,{action:'firm-ai-step'},d);await started;
 await assert.rejects(firmAction('A',owner,{action:'firm-ai-step'},d),/STEP_ALREADY_RUNNING/);release();await first;
 assert.equal((await firmView('A',d)).campaign.results.ai_events,1);
});
test('all specialist instruction paths and year transitions complete through AI adapter test double',async()=>{
 const d=harness();await firmAction('A',owner,{action:'firm-create',max_calls:200},d);await firmAction('A',owner,{action:'firm-start'},d);
 d.ai=async()=>({provider:'TEST_DOUBLE_NOT_REAL_AI',model:'stub',text:JSON.stringify(referenceAnswer(d.lab['firm_simulation:A:ai']))});
 let count=0;while((await firmView('A',d)).campaign.status==='running'&&count<200){await firmAction('A',owner,{action:'firm-ai-step'},d);count++;}
 const r=(await firmView('A',d)).campaign;assert.equal(r.status,'completed');assert.equal(r.results.ai_events,166);assert.equal(r.evaluation.ai_quality,'NOT_EVALUATED');
 assert.ok(r.events.every(e=>e.provider==='TEST_DOUBLE_NOT_REAL_AI'));
});
