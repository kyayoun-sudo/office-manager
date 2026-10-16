import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirm,startFirm,advance,nextEvent,agentContext,referenceAnswer,applyAnswer,viewFirm} from '../lib/firm-simulation.js';
test('15 persistent staff, independent reviewer, 16 engagements, 24-month replay and resume',()=>{
 const c=createFirm({seed:7});assert.equal(c.staff.length,15);assert.equal(c.missions.length,16);
 assert.ok(c.missions.every(m=>!m.team.includes(m.quality_reviewer)));
 startFirm(c);advance(c,{limit:20});assert.equal(c.events.length,20);
 const restored=JSON.parse(JSON.stringify(c));advance(restored,{limit:500});
 const fresh=createFirm({seed:7});startFirm(fresh);advance(fresh,{limit:500});
 assert.deepEqual(restored,fresh);assert.equal(fresh.month,24);assert.equal(fresh.status,'completed');
 const v=viewFirm(fresh);assert.equal(v.summary.closed,12);assert.equal(v.summary.refused,2);assert.equal(v.summary.lost,2);
 assert.equal(v.results.ai_events,0);assert.equal(v.evaluation.structural_ai_score,null);assert.equal(v.evaluation.production_workflow_tested,false);
 assert.equal(new Set(fresh.events.map(e=>e.id)).size,fresh.events.length);
 assert.ok(fresh.missions.filter(m=>m.year===2).every(m=>m.previous_id));
 assert.ok(fresh.lessons.every(l=>l.applied_to_production===false));
});
test('context excludes hidden evaluator and production writes; malicious actions and fabricated sources rejected',()=>{
 const c=createFirm();startFirm(c);const ctx=agentContext(c);assert.equal(ctx.simulation_only,true);assert.ok(!('expected' in ctx));
 const a=referenceAnswer(c);a.actions=['send_email'];assert.throws(()=>applyAnswer(c,a),/SIMULATION_ACTION_FORBIDDEN/);
 const b=referenceAnswer(c);b.sources=['client-reel/secret'];assert.throws(()=>applyAnswer(c,b),/FABRICATED/);
 assert.equal(c.events.length,0);
});
test('missing checks retain the same stage, correction history and eventual blocking',()=>{
 const c=createFirm();startFirm(c);const id=nextEvent(c).mission_id;
 for(let i=0;i<3;i++)applyAnswer(c,{actions:[],sources:[],summary:'Travail incomplet à reprendre.',messages:[]},{mode:'ai',provider:'stub'});
 assert.equal(c.status,'blocked');assert.equal(c.missions.find(m=>m.id===id).stage,0);assert.equal(c.results.ai_events,3);
 assert.equal(viewFirm(c).evaluation.structural_ai_score,0);
});
test('valid answer yields persisted proposal, sources and trace, never a real signoff',()=>{
 const c=createFirm();startFirm(c);applyAnswer(c,referenceAnswer(c),{mode:'ai',provider:'test-double'});
 assert.equal(c.results.ai_events,1);assert.equal(c.results.reference_events,0);
 assert.equal(c.missions[0].artifacts[0].status,'AI_PROPOSAL');
 assert.equal(c.missions[0].artifacts[0].simulated_review,true);
 assert.equal(viewFirm(c).evaluation.ai_quality,'NOT_EVALUATED');
});
