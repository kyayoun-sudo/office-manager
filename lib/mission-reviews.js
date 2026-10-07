import {rest} from './supabase.js';
import {getProgramme} from './mission-programmes.js';
import {MISSION_ID} from './mission-dossier.js';
const q=encodeURIComponent;
const fail=(code,statusCode=409)=>{throw Object.assign(new Error(code),{statusCode});};
export async function getMissionReviews(orgId,missionId,fetchRows=rest){
 if(!MISSION_ID.test(missionId||''))fail('VALID_MISSION_ID_REQUIRED',400);
 const scope='org_id=eq.'+q(orgId), filter=scope+'&office_mission_id=eq.'+q(missionId);
 const [source,teams,decisions,staff]=await Promise.all([
  getProgramme(orgId,missionId,fetchRows),
  fetchRows('office_mission_team_versions?'+filter+'&select=*&order=version.desc&limit=21'),
  fetchRows('office_mission_review_decisions?'+filter+'&select=*&order=sequence.desc&limit=201'),
  fetchRows('office_staff_profiles?'+scope+'&active=eq.true&select=id,full_name,role_title&order=full_name&limit=201')
 ]);
 // Never infer a latest decision from a truncated global history.
 const team=teams[0]||null,programme=source.programmes[0]||null;
 const latest=async(kind,target)=>target?(await fetchRows('office_mission_review_decisions?'+scope+'&target_kind=eq.'+kind+'&target_id=eq.'+q(target.id)+'&select=*&order=sequence.desc&limit=1'))[0]||null:null;
 const [team_decision,programme_decision]=await Promise.all([latest('team',team),latest('programme',programme)]);
 const activeStaff=new Set(staff.map(s=>s.id));
 const members_current=Boolean(team?.members.every(m=>activeStaff.has(m.staff_profile_id)&&source.mission.planned_start&&source.mission.planned_end&&m.planned_start>=source.mission.planned_start&&m.planned_end<=source.mission.planned_end));
 const team_approved=Boolean(members_current&&source.plan_approved&&team?.plan_id===source.plan?.id&&team_decision?.decision==='approve'&&team_decision.content_hash===team.content_hash);
 const programme_approved=Boolean(team_approved&&programme?.plan_id===source.plan?.id&&programme_decision?.decision==='approve'&&programme_decision.content_hash===programme.content_hash&&programme_decision.reviewed_team_id===team.id);
 return{source,team,teams:teams.slice(0,20),team_decision,programme_decision,team_approved,programme_approved,staff:staff.slice(0,200),decisions:decisions.slice(0,200),truncated:{teams:teams.length>20,staff:staff.length>200,decisions:decisions.length>200},executed:false};
}
export function validateTeam(body){
 if(!body||!MISSION_ID.test(body.mission_id||'')||!MISSION_ID.test(body.plan_id||'')||!/^[0-9a-f]{64}$/.test(body.plan_hash||'')||!Object.hasOwn(body,'expected_team_id')||(body.expected_team_id!==null&&!MISSION_ID.test(body.expected_team_id||''))||!Array.isArray(body.members)||!body.members.length||body.members.length>100)fail('INVALID_TEAM',400);
 const seen=new Set();
 const members=body.members.map(m=>{
  if(!m||Object.keys(m).sort().join(',')!=='allocation_pct,mission_role,planned_end,planned_start,staff_profile_id'||!MISSION_ID.test(m.staff_profile_id||'')||seen.has(m.staff_profile_id)||typeof m.mission_role!=='string'||!m.mission_role.trim()||m.mission_role.length>120||typeof m.allocation_pct!=='number'||!Number.isFinite(m.allocation_pct)||m.allocation_pct<=0||m.allocation_pct>100||![m.planned_start,m.planned_end].every(d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d)||m.planned_start>m.planned_end)fail('INVALID_TEAM',400);
  seen.add(m.staff_profile_id);return{...m,mission_role:m.mission_role.trim()};
 }).sort((a,b)=>a.staff_profile_id.localeCompare(b.staff_profile_id));
 return{p_mission_id:body.mission_id,p_plan_id:body.plan_id,p_plan_hash:body.plan_hash,p_members:members,p_expected_team_id:body.expected_team_id};
}
export async function missionReviewAction(orgId,body,fetchRows=rest){
 let path,input;
 if(body?.action==='save-team'){path='rpc/office_save_mission_team';input=validateTeam(body);}
 else{
  if(body?.action!=='decide')fail('UNKNOWN_REVIEW_ACTION',400);
  if(!body||!MISSION_ID.test(body.mission_id||'')||!MISSION_ID.test(body.target_id||'')||!MISSION_ID.test(body.request_id||'')||!['team','programme'].includes(body.target_kind)||!/^[0-9a-f]{64}$/.test(body.content_hash||'')||!['approve','defer','reject'].includes(body.decision)||typeof body.note!=='string'||body.note.length>1000||(body.decision==='reject'&&!body.note.trim())||!Object.hasOwn(body,'expected_decision_id')||(body.expected_decision_id!==null&&!MISSION_ID.test(body.expected_decision_id||''))||!Object.hasOwn(body,'reviewed_team_id')||(body.reviewed_team_id!==null&&!MISSION_ID.test(body.reviewed_team_id||'')))fail('INVALID_REVIEW_DECISION',400);
  if(body.target_kind==='team'&&body.decision==='approve'&&body.capacity_reviewed!==true)fail('CAPACITY_REVIEW_REQUIRED',400);
  path='rpc/office_decide_mission_review';input={p_mission_id:body.mission_id,p_target_kind:body.target_kind,p_target_id:body.target_id,p_content_hash:body.content_hash,p_decision:body.decision,p_note:body.note,p_request_id:body.request_id,p_expected_decision_id:body.expected_decision_id,p_reviewed_team_id:body.reviewed_team_id,p_capacity_reviewed:body.capacity_reviewed===true};
 }
 try{const rows=await fetchRows(path,{method:'POST',body:JSON.stringify({p_org_id:orgId,...input})});return{result:Array.isArray(rows)?rows[0]:rows,executed:false};}
 catch(e){if(/PLAN_|TEAM_|STAFF_|REVIEW_|INVALID_|MISSION_NOT_FOUND/.test(String(e.message)))fail(String(e.message).match(/(?:PLAN|TEAM|STAFF|REVIEW|INVALID|MISSION)_[A-Z_]+/)?.[0]||'MISSION_REVIEW_FAILED');throw e;}
}
export async function approvedMissionTeam(orgId,missionId,fetchRows=rest){
 const review=await getMissionReviews(orgId,missionId,fetchRows);
 if(!review.team_approved)fail('TEAM_APPROVAL_REQUIRED');
 if(!review.programme_approved)fail('PROGRAMME_APPROVAL_REQUIRED');
 const ids=new Set(review.staff.map(s=>s.id));
 if(review.team.members.some(m=>!ids.has(m.staff_profile_id)))fail('STAFF_NOT_AVAILABLE');
 return{team_version_id:review.team.id,team_hash:review.team.content_hash,assignments:review.team.members.map(m=>({...m,id:m.staff_profile_id,status:'validated'}))};
}
