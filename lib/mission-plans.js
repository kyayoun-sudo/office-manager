import { rest } from './supabase.js';
import { MISSION_ID } from './mission-dossier.js';

export function validatePlan(body) {
  if(typeof body?.mission_id !== 'string' || !MISSION_ID.test(body.mission_id)) {
    throw Object.assign(new Error('VALID_MISSION_ID_REQUIRED'),{statusCode:400});
  }
  if(typeof body.content !== 'string' || !body.content.trim() || body.content.length>50000 ||
     !Array.isArray(body.phases) || body.phases.length>20 ||
     body.phases.some(p=>typeof p!=='string' || !p.trim() || p.length>500)) {
    throw Object.assign(new Error('INVALID_PLAN'),{statusCode:400});
  }
  return { mission_id:body.mission_id, content:body.content, phases:body.phases };
}
export async function saveMissionPlan(orgId,body) {
  const plan=validatePlan(body);
  const missions=await rest('office_missions?org_id=eq.'+encodeURIComponent(orgId)+
    '&id=eq.'+plan.mission_id+'&select=id&limit=1');
  if(!missions[0]) throw Object.assign(new Error('MISSION_NOT_FOUND'),{statusCode:404});
  const result=await rest('rpc/office_save_mission_plan',{method:'POST',body:JSON.stringify({
    p_org_id:orgId,p_mission_id:plan.mission_id,p_content:plan.content,p_phases:plan.phases
  })});
  return Array.isArray(result) ? result[0] : result;
}
