import { createHash, randomUUID } from 'node:crypto';
import { rest } from '../supabase.js';
import { audit } from '../audit-log.js';
import * as mock from './adapters/mock.js';
import * as mcp from './adapters/mcp.js';
import * as api from './adapters/rest.js';
import * as huggingface from './adapters/huggingface.js';
import * as internal from './adapters/internal.js';

export const AGENTS = Object.freeze(['firm-manager','mission-controller','enhanced-auditor','orpailleur','sika','shadow']);
export const ADAPTERS = Object.freeze(['mock','mcp','rest','huggingface','internal']);
const adapters = { mock, mcp, rest: api, huggingface, internal };
const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const identity = (orgId, actor) => { if (!UUID.test(orgId) || !actor?.email) throw fail('SPECIALIST_SESSION_REQUIRED',403); };
const admin = actor => { if (!['owner','partner','it_admin'].includes(actor?.role)) throw fail('SPECIALIST_ADMIN_REQUIRED',403); };
const approval = actor => { if (!['owner','partner','manager'].includes(actor?.role)) throw fail('SPECIALIST_APPROVER_REQUIRED',403); };
const db = d => d.fetchRows || rest;
const emit = async (orgId, event, d) => {
  const out = await (d.audit || audit)(orgId, event, { fetchRows: db(d), drive: false });
  if (!out?.db) throw fail('SPECIALIST_AUDIT_UNAVAILABLE',503);
};
async function one(orgId, key, d) {
  return (await db(d)(`specialists?org_id=eq.${q(orgId)}&specialist_key=eq.${q(key)}&select=*&limit=1`))?.[0];
}
export async function registry(orgId, actor, d = {}) {
  identity(orgId,actor); admin(actor);
  const [specialists,permissions,calls] = await Promise.all([
    db(d)(`specialists?org_id=eq.${q(orgId)}&select=*&order=name`),
    db(d)(`specialist_permissions?org_id=eq.${q(orgId)}&select=*`),
    db(d)(`specialist_calls?org_id=eq.${q(orgId)}&select=*&order=created_at.desc&limit=100`)
  ]);
  return { specialists, permissions, calls, agents: AGENTS, adapters: ADAPTERS, external_connections_enabled: false,
    scores: specialists.map(s => {
      const done = calls.filter(c => c.specialist_id === s.id && ['succeeded','failed'].includes(c.status));
      const ok = done.filter(c => c.status === 'succeeded');
      return { specialist_id: s.id, sample_size: done.length, performance: done.length ? ok.length / done.length : null,
        confidence: ok.length ? ok.reduce((n,c) => n + Number(c.confidence || 0),0)/ok.length : null,
        scope: '100 derniers appels du cabinet ; fiabilité technique, pas une conclusion d’audit' };
    }) };
}
export async function saveSpecialist(orgId, input, actor, d = {}) {
  identity(orgId,actor); admin(actor);
  const key = String(input.specialist_key || '');
  if (!/^[a-z][a-z0-9-]{1,79}$/.test(key)) throw fail('SPECIALIST_KEY_INVALID');
  if (!ADAPTERS.includes(input.adapter_type) || typeof input.enabled !== 'boolean' || typeof input.requires_human_approval !== 'boolean') throw fail('SPECIALIST_CONFIG_INVALID');
  if (input.enabled && input.adapter_type !== 'mock') throw fail('SPECIALIST_ADAPTER_NOT_CONNECTED',409);
  const name = String(input.name || '').trim();
  if (!Array.isArray(input.capabilities)) throw fail('SPECIALIST_CONFIG_INVALID');
  const capabilities = [...new Set(input.capabilities)];
  if (!name || name.length > 160 || !capabilities.length || capabilities.length > 20 || capabilities.some(c => !/^[a-z][a-z0-9_.-]{1,79}$/.test(c))) throw fail('SPECIALIST_CONFIG_INVALID');
  const old = await one(orgId,key,d);
  if (old && input.revision !== old.revision) throw fail('SPECIALIST_CONFIG_CHANGED',409);
  const record = { org_id: orgId, specialist_key: key, name, adapter_type: input.adapter_type, capabilities,
    enabled: input.enabled, requires_human_approval: input.requires_human_approval, revision: (old?.revision || 0)+1, updated_at: new Date().toISOString() };
  await emit(orgId,{agent:'specialist-registry',action_type:'SPECIALIST_CONFIG_REQUESTED',status:'started',approved_by:actor.email,input_hash:hash(record)},d);
  const saved = await db(d)(old ? `specialists?org_id=eq.${q(orgId)}&id=eq.${q(old.id)}&revision=eq.${old.revision}` : 'specialists',
    {method:old?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(record)});
  if (!saved?.length) throw fail('SPECIALIST_CONFIG_CHANGED',409);
  await emit(orgId,{agent:'specialist-registry',action_type:'SPECIALIST_CONFIG_SAVED',status:'succeeded',approved_by:actor.email,output_ref:saved[0].id},d);
  return saved[0];
}
export async function setPermission(orgId,input,actor,d = {}) {
  identity(orgId,actor); admin(actor);
  if (!AGENTS.includes(input.agent_key) || typeof input.allowed !== 'boolean') throw fail('SPECIALIST_PERMISSION_INVALID');
  const s = await one(orgId,input.specialist_key,d);
  if (!s) throw fail('SPECIALIST_NOT_FOUND',404);
  await emit(orgId,{agent:'specialist-registry',action_type:'SPECIALIST_PERMISSION_CHANGED',status:'started',approved_by:actor.email,source_ref:s.id,decision:input.agent_key+':'+input.allowed},d);
  await db(d)('specialist_permissions?on_conflict=org_id,specialist_id,agent_key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({org_id:orgId,specialist_id:s.id,agent_key:input.agent_key,allowed:input.allowed})});
  return {saved:true};
}
export async function decideCall(orgId,input,actor,d = {}) {
  identity(orgId,actor); approval(actor);
  if (!UUID.test(input.call_id) || !['approve','reject'].includes(input.decision)) throw fail('SPECIALIST_DECISION_INVALID');
  const rows = await db(d)(`specialist_calls?org_id=eq.${q(orgId)}&id=eq.${q(input.call_id)}&status=eq.pending_approval`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:input.decision==='approve'?'approved':'rejected',approved_by:actor.email,approved_at:new Date().toISOString()})});
  if (!rows?.length) throw fail('SPECIALIST_CALL_NOT_PENDING',409);
  await emit(orgId,{agent:'specialist-registry',action_type:'SPECIALIST_CALL_DECIDED',status:input.decision==='approve'?'approved':'rejected',approved_by:actor.email,output_ref:input.call_id},d);
  return {call_id:input.call_id,status:rows[0].status};
}

// Called only from a server-side router bound to the internal agent. No browser-selected identity.
export async function callSpecialist(orgId, agentKey, request, actor, d = {}) {
  identity(orgId,actor);
  if (!AGENTS.includes(agentKey)) throw fail('SPECIALIST_AGENT_INVALID',403);
  const inputHash = hash({capability:request.capability,input:request.input ?? null,mission_id:request.mission_id || null});
  if (JSON.stringify(request.input ?? null).length > 100000) throw fail('SPECIALIST_INPUT_TOO_LARGE',413);
  const id = request.call_id || randomUUID();
  if (!UUID.test(id) || (request.mission_id && !UUID.test(request.mission_id))) throw fail('SPECIALIST_REQUEST_INVALID');
  const s = await one(orgId,String(request.specialist_key || ''),d);
  const permission = s && (await db(d)(`specialist_permissions?org_id=eq.${q(orgId)}&specialist_id=eq.${q(s.id)}&agent_key=eq.${q(agentKey)}&allowed=eq.true&select=agent_key&limit=1`))?.[0];
  let denied = !s ? 'SPECIALIST_NOT_FOUND' : !s.enabled ? 'SPECIALIST_DISABLED' : !permission ? 'SPECIALIST_FORBIDDEN' : !s.capabilities.includes(request.capability) ? 'SPECIALIST_CAPABILITY_UNSUPPORTED' : s.adapter_type !== 'mock' ? 'SPECIALIST_ADAPTER_NOT_CONNECTED' : null;
  if (request.mission_id && !(await db(d)(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(request.mission_id)}&select=id&limit=1`))?.length) denied = 'MISSION_NOT_FOUND';
  if (denied) {
    await db(d)('specialist_calls',{method:'POST',body:JSON.stringify({id:randomUUID(),org_id:orgId,specialist_id:s?.id || null,agent_key:agentKey,mission_id:request.mission_id || null,capability:String(request.capability || ''),input_hash:inputHash,status:'denied',requested_by:actor.email,error_code:denied})});
    throw fail(denied,403);
  }
  if (request.call_id) {
    const c = (await db(d)(`specialist_calls?org_id=eq.${q(orgId)}&id=eq.${q(id)}&select=*&limit=1`))?.[0];
    if (!c || c.status !== 'approved' || c.specialist_id !== s.id || c.agent_key !== agentKey || c.input_hash !== inputHash || c.registry_revision !== s.revision || c.requested_by !== actor.email) throw fail('SPECIALIST_APPROVAL_INVALID',409);
    const claimed = await db(d)(`specialist_calls?org_id=eq.${q(orgId)}&id=eq.${q(id)}&status=eq.approved`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'running'})});
    if (!claimed?.length) throw fail('SPECIALIST_CALL_ALREADY_CLAIMED',409);
  } else {
    const status = s.requires_human_approval ? 'pending_approval' : 'running';
    await db(d)('specialist_calls',{method:'POST',body:JSON.stringify({id,org_id:orgId,specialist_id:s.id,agent_key:agentKey,mission_id:request.mission_id || null,capability:request.capability,input_hash:inputHash,registry_revision:s.revision,requested_by:actor.email,status})});
    if (status === 'pending_approval') return {call_id:id,status,simulated:true};
  }
  const start = Date.now();
  try {
    const r = await adapters[s.adapter_type].invoke({capability:request.capability,input:request.input});
    if (!r || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1 || !Array.isArray(r.sources)) throw new Error('SPECIALIST_RESULT_INVALID');
    const result = {schema:'office-manager.specialist-result/1',call_id:id,specialist_key:s.specialist_key,agent:agentKey,status:'succeeded',data:r.data,confidence:r.confidence,sources:r.sources,limitations:r.limitations || [],simulated:true,authority:'advisory_only',audit_conclusion:false,validation:false,sign_off:false};
    await db(d)(`specialist_calls?org_id=eq.${q(orgId)}&id=eq.${q(id)}&status=eq.running`,{method:'PATCH',body:JSON.stringify({status:'succeeded',finished_at:new Date().toISOString(),duration_ms:Date.now()-start,confidence:r.confidence,result_hash:hash(result)})});
    return result;
  } catch {
    await db(d)(`specialist_calls?org_id=eq.${q(orgId)}&id=eq.${q(id)}&status=eq.running`,{method:'PATCH',body:JSON.stringify({status:'failed',finished_at:new Date().toISOString(),duration_ms:Date.now()-start,error_code:'SPECIALIST_EXECUTION_FAILED'})});
    throw fail('SPECIALIST_EXECUTION_FAILED',502);
  }
}
