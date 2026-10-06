import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getMissionDossier, listMissions } from '../lib/mission-dossier.js';
import handler from '../api/missions.js';
import { buildRootTools, buildSpecialistTools } from '../lib/agent-tools.js';

const id='d64b9ce0-510a-4c6b-bc75-4b2a3bba6021';
test('mission dossier reads current scoped data and never requests private staffing profiles', async () => {
  process.env.SUPABASE_URL='https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async url => {
    calls.push(url);
    let rows=[];
    if(url.includes('/office_missions?')) rows=[{id,name:'Synthetic advice mission',status:'draft',planned_start:'2026-10-12',planned_end:'2026-10-30'}];
    if(url.includes('/office_mission_people_requirements?')) rows=[{mission_context:'Synthetic detailed scope',required_skills:['Conseil'],preferred_team_size:3}];
    return new Response(JSON.stringify(rows));
  };
  try {
    const result=await getMissionDossier('server-org',id);
    assert.equal(result.requirements.mission_context,'Synthetic detailed scope');
    assert.equal(result.assignments.length,0);
    assert.ok(result.blockers.some(b=>b.includes('équipe à valider')));
    assert.ok(calls.every(url=>url.includes('org_id=eq.server-org')));
    assert.ok(calls.some(url=>url.includes('action_type=neq.PEOPLE_INTELLIGENCE_RECOMMENDATION')));
    assert.ok(!calls.some(url=>url.includes('management_profiles') || url.includes('staffing_advice')));
    await assert.rejects(getMissionDossier('server-org','id&org_id=eq.attacker'),/VALID_MISSION_ID_REQUIRED/);
  } finally { globalThis.fetch=original; }
});

test('mission list reports truncation instead of claiming full coverage', async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify(Array.from({length:101},(_,i)=>({id:i}))));
  try {
    const result=await listMissions('server-org');
    assert.equal(result.missions.length,100);
    assert.equal(result.truncated,true);
  } finally { globalThis.fetch=original; }
});

test('mission route rejects unauthorized access before reading the database', async () => {
  process.env.OFFICE_MANAGER_ACCESS_TOKEN='synthetic';
  const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.value=value;return this;}};
  await handler({method:'GET',headers:{}},res);
  assert.equal(res.code,401);
});

test('root and mission controller have a live dossier tool and page script remains valid', () => {
  for(const tools of [buildRootTools({orgId:'synthetic'}),buildSpecialistTools('mission-controller',{orgId:'synthetic'})]) {
    assert.ok(tools.some(t=>t.name==='read_office_mission_dossier'));
  }
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  new vm.Script(html.slice(html.indexOf('<script>')+8,html.indexOf('</script>')));
});
