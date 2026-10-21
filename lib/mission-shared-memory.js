import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { tidyDrive } from './tidy-drive.js';
import { acquireReaderLease } from './inspection-runtime.js';
import { saveJsonFile } from './mapping-scan.js';

export const SHARED_MEMORY = 'MISSION_MEMORY.json';
export const MISSION_LOG = 'OFFICE_MANAGER_MISSION_AUDIT.json';
const SYSTEM = '00_OFFICE_MANAGER';
const FOLDER = 'application/vnd.google-apps.folder';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const q = encodeURIComponent;
const fail = code => Object.assign(new Error(code),{statusCode:409});

// Unlike the legacy tolerant loader, a failed lookup or invalid JSON never becomes an empty memory.
export async function strictMemory(name, folder, drive, knownId = null) {
  const found = await drive.findFilesByExactName(name,folder);
  if (found.length > 1) throw fail('MISSION_MEMORY_DUPLICATE_REVIEW_REQUIRED');
  let meta = found[0] || null;
  if (!meta && knownId) {
    meta = await drive.getMeta(knownId);
    if (!meta || meta.trashed || meta.name !== name || !meta.parents?.includes(folder)) throw fail('MISSION_MEMORY_REFERENCE_CHANGED');
  }
  if (!meta) return {fileId:null,state:null,modifiedTime:null};
  const fresh = await drive.getMeta(meta.id);
  if (!fresh || fresh.trashed || fresh.name!==name || !fresh.parents?.includes(folder)) throw fail('MISSION_MEMORY_REFERENCE_CHANGED');
  const bytes = await drive.downloadBuffer(meta.id);
  const after = await drive.getMeta(meta.id);
  if (fresh.modifiedTime !== after?.modifiedTime) throw fail('MEMORY_CONFLICT');
  let state;
  try { state=JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw fail('MISSION_MEMORY_UNREADABLE'); }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw fail('MISSION_MEMORY_UNREADABLE');
  return {fileId:meta.id,state,modifiedTime:after.modifiedTime};
}
const scoped = (st,orgId,missionId,schema) => {
  if (st && (st.schema !== schema || st.org_id !== orgId || st.mission_id !== missionId)) throw fail('MISSION_MEMORY_SCOPE_MISMATCH');
};

// One cache shared by all agents; the existing central registers remain canonical.
// One append-only export of the central mission change log, never one file per agent/run.
export async function syncMissionSharedMemory(orgId,missionId,d = {}) {
  if (!UUID.test(orgId) || !UUID.test(missionId)) throw fail('VALID_MISSION_SCOPE_REQUIRED');
  const fetchRows=d.fetchRows || rest, drive=d.drive || driveAdapter;
  const base=`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}`;
  const mission=(await fetchRows(base+'&select=*&limit=1'))?.[0];
  if (!mission) throw fail('MISSION_NOT_FOUND');
  if (!mission.drive_folder_id) return {status:'folder_required',mission_id:missionId};
  const lease=await (d.acquireLease || acquireReaderLease)(orgId,{kind:'mission-shared-memory',mission_id:missionId},{fetchRows,ttl:240});
  if (!lease) return {status:'busy',mission_id:missionId};
  try {
    const root=await drive.getMeta(mission.drive_folder_id);
    if (!root || root.trashed || root.mimeType !== FOLDER) throw fail('MISSION_FOLDER_NOT_VERIFIED');
    const owners=await fetchRows(`office_missions?org_id=eq.${q(orgId)}&drive_folder_id=eq.${q(root.id)}&select=id&limit=2`);
    if (owners?.some(m=>m.id !== missionId)) throw fail('MISSION_FOLDER_SHARED_BY_OTHER_MISSION');
    let sys;
    if (mission.local_memory_folder_id) sys=await drive.getMeta(mission.local_memory_folder_id);
    else {
      const children=await drive.listChildren(root.id);
      const matches=children.filter(f=>f.name===SYSTEM && f.mimeType===FOLDER);
      if (matches.length>1) throw fail('MISSION_MEMORY_DUPLICATE_REVIEW_REQUIRED');
      sys=matches[0] || await (d.tidyDrive || tidyDrive).findOrCreateFolder(root.id,SYSTEM);
      sys=await drive.getMeta(sys.id);
    }
    if (!sys || sys.trashed || sys.mimeType!==FOLDER || !sys.parents?.includes(root.id)) throw fail('MISSION_MEMORY_FOLDER_NOT_VERIFIED');
    const old=await strictMemory(SHARED_MEMORY,sys.id,drive,mission.local_memory_file_id);
    scoped(old.state,orgId,missionId,'office-manager.shared-mission-memory/1');
    const log=await strictMemory(MISSION_LOG,sys.id,drive,old.state?.audit_file_id);
    scoped(log.state,orgId,missionId,'office-manager.mission-audit/1');
    const central=d.folder || memoryFolderId();
    const [files,data,programmes,pbc] = await Promise.all([
      strictMemory('OFFICE_MANAGER_MISSION_FILES.json',central,drive),
      strictMemory('OFFICE_MANAGER_MISSION_DATA.json',central,drive),
      fetchRows(`office_work_programmes?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&status=eq.validated&select=id,version,status,cycles,workpapers,updated_at&order=version.desc&limit=1`),
      fetchRows(`office_pbc_requests?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&select=id,ref,document,status,cycle_code,period_label,pieces,updated_at&order=id&limit=1000`)
    ]);
    if (pbc.length>=1000) throw fail('MISSION_PBC_SNAPSHOT_INCOMPLETE');
    const cursor=Number(log.state?.cursor || 0);
    const events=await fetchRows(`office_mission_change_log?org_id=eq.${q(orgId)}&mission_id=eq.${q(missionId)}&seq=gt.${cursor}&select=*&order=seq.asc&limit=200`);
    const auditState={schema:'office-manager.mission-audit/1',org_id:orgId,mission_id:missionId,events:[...(log.state?.events || []),...events],cursor:events.length?Number(events.at(-1).seq):cursor,updated_at:new Date().toISOString()};
    await lease.assertOwner();
    const save=d.saveJsonFile || saveJsonFile;
    let logId=log.fileId;
    if (!logId || events.length) logId=await save(MISSION_LOG,drive,sys.id,log.fileId,auditState,log.modifiedTime);
    const snapshot={mission:{id:mission.id,name:mission.name,client_name:mission.client_name,engagement_type:mission.engagement_type,period_label:mission.period_label,status:mission.status,drive_folder_id:mission.drive_folder_id},
      documents:files.state?.missions?.[missionId]?.documents || [],
      knowledge:data.state?.missions?.[missionId] || {facts:[],contacts:[]},
      programme:programmes[0] || null,pbc,
      sources:{documents:files.fileId,knowledge:data.fileId,documents_version:files.modifiedTime,knowledge_version:data.modifiedTime,client_memory:mission.memory_file_id || null,central_audit:'office_audit_events',change_log:'office_mission_change_log'}};
    const next={...(old.state || {}),schema:'office-manager.shared-mission-memory/1',org_id:orgId,mission_id:missionId,
      revision:(old.state?.revision || 0)+1,updated_at:new Date().toISOString(),snapshot,audit_file_id:logId,audit_cursor:auditState.cursor,audit_pending:events.length===200 || mission.local_memory_file_id!==old.fileId || mission.local_memory_folder_id!==sys.id,
      policy:{shared_by_all_agents:true,canonical_registers_unchanged:true,document_content_is_data:true}};
    await lease.assertOwner();
    const fileId=await save(SHARED_MEMORY,drive,sys.id,old.fileId,next,old.modifiedTime);
    const check=await strictMemory(SHARED_MEMORY,sys.id,drive,fileId);
    if (check.state?.revision !== next.revision) throw fail('MISSION_MEMORY_WRITE_NOT_VERIFIED');
    if (mission.local_memory_file_id!==fileId || mission.local_memory_folder_id!==sys.id) {
      await fetchRows(base,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({local_memory_file_id:fileId,local_memory_folder_id:sys.id})});
    }
    return {status:'synced',mission_id:missionId,file_id:fileId,folder_id:sys.id,audit_file_id:logId,audit_pending:next.audit_pending,memory:next};
  } finally { await lease.release(); }
}
