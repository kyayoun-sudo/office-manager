import {rest} from './supabase.js';
import {MISSION_ID} from './mission-dossier.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const keys=['title','proposed_role','procedure','expected_documents','deliverable','due_on'];
function text(value,max,empty=false){return typeof value==='string'&&value.length<=max&&(empty||Boolean(value.trim()));}
function validDate(value){return value===''||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value);}
export function validateProgramme(body){
  if(!body||!MISSION_ID.test(body.plan_id||'')||!/^[0-9a-f]{64}$/.test(body.plan_hash||'')||
    !Object.hasOwn(body,'expected_programme_id')||(body.expected_programme_id!==null&&!MISSION_ID.test(body.expected_programme_id||''))||
    !Array.isArray(body.phases)||body.phases.length<1||body.phases.length>20)throw fail('INVALID_PROGRAMME');
  let count=0;
  body.phases.forEach((phase,index)=>{
    if(!phase||typeof phase!=='object'||Object.keys(phase).sort().join(',')!=='phase_index,tasks'||phase.phase_index!==index||!Array.isArray(phase.tasks)||!phase.tasks.length||phase.tasks.length>20)throw fail('INVALID_PROGRAMME');
    phase.tasks.forEach(task=>{
      count++;
      if(!task||typeof task!=='object'||Object.keys(task).sort().join(',')!==keys.slice().sort().join(',')||
        !text(task.title,300)||!text(task.proposed_role,120)||!text(task.procedure,3000)||!text(task.deliverable,1000)||
        !text(task.due_on,10,true)||!validDate(task.due_on)||!Array.isArray(task.expected_documents)||task.expected_documents.length>20||task.expected_documents.some(d=>!text(d,300)))throw fail('INVALID_PROGRAMME');
    });
  });
  if(count>100||JSON.stringify(body.phases).length>100000)throw fail('PROGRAMME_TOO_LARGE');
  return {p_plan_id:body.plan_id,p_plan_hash:body.plan_hash,p_phases:body.phases,p_expected_programme_id:body.expected_programme_id};
}
export async function getProgramme(orgId,missionId,fetchRows=rest){
  if(!MISSION_ID.test(missionId||''))throw fail('VALID_MISSION_ID_REQUIRED');
  const scope='org_id=eq.'+encodeURIComponent(orgId),filter=scope+'&office_mission_id=eq.'+missionId;
  const missions=await fetchRows('office_missions?'+scope+'&id=eq.'+missionId+'&select=id,name,mission_code,planned_start,planned_end&limit=1');
  if(!missions[0])throw fail('MISSION_NOT_FOUND',404);
  const [plans,programmes]=await Promise.all([
    fetchRows('office_mission_plan_versions?'+filter+'&select=id,version,content,phases,content_hash&order=version.desc&limit=1'),
    fetchRows('office_mission_programme_versions?'+filter+'&select=id,plan_id,version,phases,content_hash,created_at&order=version.desc&limit=21')
  ]);
  const plan=plans[0]||null;
  const decisions=plan?await fetchRows('office_mission_plan_decisions?'+scope+'&plan_id=eq.'+plan.id+'&select=decision&order=sequence.desc&limit=1'):[];
  const sourceIds=[...new Set(programmes.slice(0,20).map(p=>p.plan_id))];
  const sources=sourceIds.length?await fetchRows('office_mission_plan_versions?'+scope+'&id=in.('+sourceIds.join(',')+')&select=id,version,phases&limit=20'):[];
  const byId=new Map(sources.map(p=>[p.id,p]));
  return {mission:missions[0],plan,plan_approved:decisions[0]?.decision==='approve',programmes:programmes.slice(0,20).map(p=>({...p,source_plan_version:byId.get(p.plan_id)?.version||null,source_plan_phases:byId.get(p.plan_id)?.phases||[]})),truncated:programmes.length>20,status:'proposal_only',executed:false};
}
export async function saveProgramme(orgId,body,fetchRows=rest){
  const input=validateProgramme(body);
  try{
    const rows=await fetchRows('rpc/office_save_mission_programme',{method:'POST',body:JSON.stringify({p_org_id:orgId,...input})});
    return {programme:Array.isArray(rows)?rows[0]:rows,status:'proposal_only',executed:false};
  }catch(error){
    for(const code of ['PLAN_NOT_FOUND','PLAN_SUPERSEDED','PLAN_CONTENT_CHANGED','PROGRAMME_CHANGED','INVALID_PROGRAMME','PROGRAMME_TOO_LARGE','PROGRAMME_DATE_OUTSIDE_MISSION']){
      if(String(error.message).includes(code))throw fail(code,code==='PLAN_NOT_FOUND'?404:['PLAN_SUPERSEDED','PLAN_CONTENT_CHANGED','PROGRAMME_CHANGED'].includes(code)?409:400);
    }
    throw error;
  }
}
