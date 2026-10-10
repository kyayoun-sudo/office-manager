import crypto from 'node:crypto';
import { rest } from './supabase.js';

// "À valider": list proposed actions and record the manager's decision.
// Decisions go to office_action_decisions (append-only, content hash). Since 2026-10-07 the
// validated action is then carried out by action-executor.js — inside the firm only:
// never an e-mail to a client, never a deletion.
import { executeDecision } from './action-executor.js';
import { audit } from './audit-log.js';

export const DECISIONS = Object.freeze(['approve', 'reject', 'defer']);
const ACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING = 'status=in.(proposed,awaiting_approval)&approved_at=is.null&executed_at=is.null';
// Private staffing advice stays in the dedicated People view.
const NOT_PRIVATE = 'action_type=neq.PEOPLE_INTELLIGENCE_RECOMMENDATION';

function fail(code, statusCode) {
  return Object.assign(new Error(code), { statusCode });
}

// Stable hash of the exact content the manager saw.
export function contentHash(action) {
  const canonical = JSON.stringify({
    id: action.id,
    agent_key: action.agent_key ?? null,
    action_type: action.action_type ?? null,
    summary: action.summary ?? null,
    payload: action.payload ?? null
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function validateDecision(input = {}) {
  const actionId = String(input.action_id || '');
  if (!ACTION_ID.test(actionId)) throw fail('VALID_ACTION_ID_REQUIRED', 400);
  const decision = String(input.decision || '');
  if (!DECISIONS.includes(decision)) throw fail('INVALID_DECISION', 400);
  const note = input.note == null || input.note === '' ? null : String(input.note).trim().slice(0, 1000);
  const by = input.decided_by == null || input.decided_by === '' ? null : String(input.decided_by).trim().slice(0, 120);
  if (decision === 'reject' && !note) throw fail('NOTE_REQUIRED_FOR_REJECTION', 400);
  return { action_id: actionId, decision, note, decided_by: by };
}

export async function listPendingActions(orgId, fetchRows = rest) {
  const org = 'org_id=eq.' + encodeURIComponent(orgId);
  let actions = await fetchRows('office_action_queue?' + org + '&' + PENDING + '&' + NOT_PRIVATE +
    '&select=id,agent_key,office_mission_id,action_type,summary,status,work_state,verification_evidence,due_at,created_at' +
    '&order=created_at.desc&limit=101');
  const approved = await fetchRows('office_action_queue?' + org + '&action_type=eq.FILE_MOVE&status=eq.approved&executed_at=is.null&verified_at=is.null&select=id,agent_key,office_mission_id,action_type,summary,status,work_state,verification_evidence,due_at,created_at&order=created_at.desc&limit=101');
  actions = [...new Map([...actions, ...approved].map(a => [a.id, a])).values()];
  actions = actions.filter(a => a.verification_evidence?.error_code !== 'PROPOSAL_SUPERSEDED');
  const ids = actions.slice(0, 100).map(a => a.id).filter(id => ACTION_ID.test(id));
  let decisions = [];
  if (ids.length) {
    decisions = await fetchRows('office_action_decisions?' + org + '&action_id=in.(' + ids.join(',') + ')' +
      '&select=action_id,decision,note,decided_by,created_at&order=created_at.desc&limit=500');
  }
  const latest = {};
  for (const d of decisions) if (!latest[d.action_id]) latest[d.action_id] = d;
  return {
    actions: actions.slice(0, 100).map(a => ({ ...a, last_decision: latest[a.id] || null, retry_needed: a.action_type === 'FILE_MOVE' && latest[a.id]?.decision === 'approve' })),
    truncated: actions.length > 100,
    guardrail: 'Valider lance l’action à l’intérieur du cabinet (tâche de l’équipe, pièce à classer, message à un collègue à valider). Jamais d’e-mail à un client, jamais de suppression.'
  };
}

export async function recordDecision(orgId, input, fetchRows = rest, deps = {}) {
  if (input?.action === 'retry') return retryFileMove(orgId, input, fetchRows, deps);
  const clean = validateDecision(input);
  const org = 'org_id=eq.' + encodeURIComponent(orgId);
  const rows = await fetchRows('office_action_queue?' + org + '&id=eq.' + clean.action_id + '&' + NOT_PRIVATE +
    '&select=id,agent_key,office_mission_id,action_type,summary,payload,status,verification_evidence,approved_at,executed_at&limit=1');
  const action = rows?.[0];
  if (!action) throw fail('ACTION_NOT_FOUND', 404);
  if (action.verification_evidence?.error_code === 'PROPOSAL_SUPERSEDED') throw fail('PROPOSAL_SUPERSEDED', 409);
  if (!['proposed', 'awaiting_approval'].includes(action.status) || action.approved_at || action.executed_at) {
    throw fail('ACTION_NOT_PENDING', 409);
  }
  const record = {
    org_id: orgId,
    action_id: clean.action_id,
    decision: clean.decision,
    note: clean.note,
    decided_by: clean.decided_by,
    content_hash: contentHash(action),
    action_snapshot: {
      agent_key: action.agent_key ?? null,
      action_type: action.action_type ?? null,
      summary: action.summary ?? null,
      office_mission_id: action.office_mission_id ?? null
    }
  };
  const saved = await fetchRows('office_action_decisions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([record])
  });
  const row = saved?.[0] || record;
  let execution = { executed: false, effect: null };
  try {
    execution = await (deps.execute || executeDecision)(orgId, action, clean.decision, clean.decided_by, { fetchRows, ...deps });
  } catch (e) {
    execution = { executed: false, effect: 'Décision enregistrée ; exécution impossible pour l’instant : ' + String(e.message || e).slice(0, 200) };
  }
  // Audit log (added): who decided what, and what was done. Offline tests inject deps.audit or nothing.
  const auditFn = deps.audit !== undefined ? deps.audit : (fetchRows === rest ? audit : null);
  if (auditFn && clean.decision !== 'defer') {
    const at = new Date().toISOString();
    await auditFn(orgId, { agent: action.agent_key || 'office-manager', mission_id: action.office_mission_id, action_type: action.action_type || 'ACTION',
      source_ref: 'office_action_queue:' + action.id, input_hash: record.content_hash, decision: clean.decision,
      status: clean.decision === 'reject' ? 'rejected' : execution.executed ? 'executed' : 'failed', error: execution.error_code || null, reviewer: clean.decided_by,
      approved_by: clean.decision === 'approve' ? clean.decided_by : null, approved_at: clean.decision === 'approve' ? at : null,
      executed_at: clean.decision === 'approve' && execution.executed ? at : null, output_ref: String(execution.effect || '').slice(0, 300), ref_id: action.id }).catch(() => null);
  }
  return {
    recorded: true,
    action_id: row.action_id,
    decision: row.decision,
    content_hash: row.content_hash,
    executed: execution.executed,
    effect: execution.effect,
    verified: execution.verified ?? null,
    message_id: execution.message_id || null,
    needs_assignee: Boolean(execution.needs_assignee),
    assigned_to: execution.assigned_to || null
  };
}


// Resume only the exact internal filing action already approved by a human.
export async function retryFileMove(orgId, input, fetchRows = rest, deps = {}) {
  const id = String(input.action_id || '');
  if (!ACTION_ID.test(id)) throw fail('VALID_ACTION_ID_REQUIRED', 400);
  const org = 'org_id=eq.' + encodeURIComponent(orgId);
  const action = (await fetchRows('office_action_queue?' + org + '&id=eq.' + id + '&select=*&limit=1'))?.[0];
  if (action?.verification_evidence?.error_code === 'PROPOSAL_SUPERSEDED') throw fail('PROPOSAL_SUPERSEDED', 409);
  if (!action || action.action_type !== 'FILE_MOVE' || !['approved', 'proposed', 'awaiting_approval'].includes(action.status) || action.executed_at || action.verified_at) throw fail('ACTION_NOT_RETRYABLE', 409);
  const decision = (await fetchRows('office_action_decisions?' + org + '&action_id=eq.' + id + '&select=decision,content_hash,decided_by&order=created_at.desc&limit=1'))?.[0];
  if (decision?.decision !== 'approve' || decision.content_hash !== contentHash(action)) throw fail('APPROVAL_REQUIRED_FOR_CURRENT_CONTENT', 409);
  const execution = await (deps.execute || executeDecision)(orgId, action, 'approve', decision.decided_by, { fetchRows, ...deps, reexecute: action.status === 'approved' });
  const auditFn = deps.audit !== undefined ? deps.audit : (fetchRows === rest ? audit : null);
  if (auditFn) await auditFn(orgId, { agent: action.agent_key, action_type: 'FILE_MOVE_RETRY', source_ref: 'office_action_queue:' + id, reviewer: input.decided_by || null, input_hash: decision.content_hash, status: execution.verified ? 'verified' : execution.executed ? 'executed' : 'failed', error: execution.error_code || null, output_ref: String(execution.effect || '').slice(0, 300) });
  return { action_id: id, retried: true, ...execution };
}
