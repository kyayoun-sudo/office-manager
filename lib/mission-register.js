import { updateJsonFile as legacyUpdate, saveJsonFile } from './mapping-scan.js';
import { currentOrgId } from './firm-context.js';
import { strictMemory } from './mission-shared-memory.js';
import { acquireReaderLease } from './inspection-runtime.js';
import { rest } from './supabase.js';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export async function updateMissionRegister(name,mutate,options={}) {
  const orgId=options.orgId || currentOrgId();
  // Existing isolated adapter tests use non-UUID scopes; production always has a firm UUID.
  if(!UUID.test(String(orgId || '')))return legacyUpdate(name,mutate,options);
  let lease;
  for(let attempt=0;attempt<8 && !lease;attempt++) {
    lease=await (options.acquireLease || acquireReaderLease)(orgId,{kind:'mission-register',name,folder:options.folder},{fetchRows:options.fetchRows || rest,ttl:120});
    if(!lease)await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!lease)throw new Error('MISSION_REGISTER_BUSY_RETRY');
  try {
    const cur=await strictMemory(name,options.folder,options.drive);
    const next=await mutate(cur.state?structuredClone(cur.state):null);
    if(next==null)return {...cur,written:false};
    await lease.assertOwner();
    const fileId=await saveJsonFile(name,options.drive,options.folder,cur.fileId,next,cur.modifiedTime);
    return {fileId,state:next,written:true};
  } finally { await lease.release(); }
}
export async function assertMissionRegisterScope(orgId,missionId,d={}) {
  if(!UUID.test(String(orgId || '')))return;
  const found=await (d.fetchRows || rest)('office_missions?org_id=eq.'+encodeURIComponent(orgId)+'&id=eq.'+encodeURIComponent(missionId)+'&select=id&limit=1');
  if(!found?.length)throw new Error('MISSION_NOT_FOUND');
}
export async function notifyMissionKnowledge(orgId,missionId,{agent,action,source,input}={},d={}) {
  if(!UUID.test(String(orgId || '')) || !UUID.test(String(missionId || '')))return {status:'not_configured'};
  const fetchRows=d.fetchRows || rest;
  const m=(await fetchRows('office_missions?org_id=eq.'+encodeURIComponent(orgId)+'&id=eq.'+encodeURIComponent(missionId)+'&select=id&limit=1'))?.[0];
  if(!m)throw new Error('MISSION_NOT_FOUND');
  const log=await (d.audit || (await import('./audit-log.js')).audit)(orgId,{agent:agent || 'mission-controller',mission_id:missionId,action_type:action || 'MISSION_KNOWLEDGE_UPDATED',source_ref:source || null,input,status:'succeeded'},{fetchRows,drive:false});
  if(!log?.db)return {status:'audit_pending',error:log?.db_error || 'AUDIT_UNAVAILABLE'};
  // Canonical data is already safe. A failed cache refresh remains retryable through the DB log.
  return (d.syncMissionSharedMemory || (await import('./mission-shared-memory.js')).syncMissionSharedMemory)(orgId,missionId,d).catch(e=>({status:'pending',error:String(e.message).slice(0,160)}));
}
