import { rest } from './supabase.js';
import { MISSION_ID } from './mission-dossier.js';
const fail = (message, statusCode=400) => Object.assign(new Error(message), {statusCode});

export function validatePlanDecision(body) {
  if (!body || !MISSION_ID.test(body.plan_id || '') || !MISSION_ID.test(body.request_id || '') ||
      !/^[0-9a-f]{64}$/.test(body.content_hash || '') || !['approve','defer','reject'].includes(body.decision) ||
      !Object.hasOwn(body,'expected_decision_id') ||
      (body.expected_decision_id !== null && !MISSION_ID.test(body.expected_decision_id || '')) ||
      typeof body.note !== 'string' || body.note.length > 1000 ||
      (body.decision === 'reject' && !body.note.trim())) throw fail('INVALID_PLAN_DECISION');
  return { p_plan_id:body.plan_id, p_content_hash:body.content_hash, p_request_id:body.request_id,
    p_decision:body.decision, p_note:body.note, p_expected_decision_id:body.expected_decision_id };
}

export async function getPlanDecisions(orgId, missionId, fetchRows=rest) {
  if (!MISSION_ID.test(missionId || '')) throw fail('VALID_MISSION_ID_REQUIRED');
  const scope='org_id=eq.'+encodeURIComponent(orgId);
  const missions=await fetchRows('office_missions?'+scope+'&id=eq.'+missionId+'&select=id,name&limit=1');
  if (!missions[0]) throw fail('MISSION_NOT_FOUND',404);
  const plans=await fetchRows('office_mission_plan_versions?'+scope+'&office_mission_id=eq.'+missionId+
    '&select=id,version,content,phases,content_hash,created_at&order=version.desc&limit=21');
  // A separate bounded history per version ensures its latest decision is never
  // lost through a global limit consumed by another version's activity.
  const entries=await Promise.all(plans.slice(0,20).map(async plan => {
    const history=await fetchRows('office_mission_plan_decisions?'+scope+'&plan_id=eq.'+plan.id+
      '&select=id,plan_id,decision,note,authority,content_hash,sequence,created_at&order=sequence.desc&limit=51');
    return {...plan,last_decision:history[0] || null,history:history.slice(0,50),history_truncated:history.length>50};
  }));
  return {mission:missions[0],plans:entries,truncated:plans.length>20,executed:false};
}

export async function decideMissionPlan(orgId, body, fetchRows=rest) {
  const input=validatePlanDecision(body);
  let result;
  try {
    result=await fetchRows('rpc/office_decide_mission_plan',{method:'POST',body:JSON.stringify({p_org_id:orgId,...input})});
  } catch (error) {
    for (const code of ['PLAN_NOT_FOUND','PLAN_CONTENT_CHANGED','PLAN_SUPERSEDED','DECISION_CHANGED','DECISION_REQUEST_CONFLICT','INVALID_PLAN_DECISION']) {
      if (String(error.message).includes(code)) throw fail(code,code==='PLAN_NOT_FOUND'?404:code==='INVALID_PLAN_DECISION'?400:409);
    }
    throw error;
  }
  return {decision:Array.isArray(result)?result[0]:result,executed:false};
}
