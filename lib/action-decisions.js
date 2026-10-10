import crypto from 'node:crypto';
import { rest } from './supabase.js';

// "À valider": list proposed actions and record the manager's decision.
// Decisions go to office_action_decisions (append-only, content hash). Since 2026-10-07 the
// validated action is then carried out by action-executor.js — inside the firm only:
// never an e-mail to a client, never a deletion.
import { executeDecision } from './action-executor.js';
import { audit } from './audit-log.js';

export const DECISIONS = Object.freeze(['approve', 'reject', 'defer']);
export function filingBlock(action) {
  const code = action.verification_evidence?.error_code;
  return ({ SOURCE_CHANGED_REPLAN_REQUIRED: 'Le fichier a changé de dossier : Orpailleur doit refaire la proposition.', CONTENT_DUPLICATE: 'Doublon de contenu : les deux fichiers doivent être comparés avant une décision.', FILE_TRASHED: 'Le fichier est à la corbeille : cette proposition ne peut pas être exécutée.', FILE_UNAVAILABLE: 'Le fichier est inaccessible : vérifier la source et les droits.' })[code] || null;
}
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
    '&select=id,agent_key,office_mission_id,action_type,summary,status,work_state,verification_evidence,due_at,created_at,file_name:payload->>file_name,file_id:payload->>file_id,destination:payload->>to_name' +
    '&order=created_at.desc&limit=101');
  const approved = await fetchRows('office_action_queue?' + org + '&action_type=eq.FILE_MOVE&status=eq.approved&executed_at=is.null&verified_at=is.null&select=id,agent_key,office_mission_id,action_type,summary,status,work_state,verification_evidence,due_at,created_at,file_name:payload->>file_name,file_id:payload->>file_id,destination:payload->>to_name&order=created_at.desc&limit=101');
  actions = [...new Map([...actions, ...approved].map(a => [a.id, a])).values()];
  actions = actions.filter(a => !['PROPOSAL_SUPERSEDED', 'FILE_TRASHED'].includes(a.verification_evidence?.error_code));
  const ids = actions.slice(0, 100).map(a => a.id).filter(id => ACTION_ID.test(id));
  let decisions = [];
  if (ids.length) {
    decisions = await fetchRows('office_action_decisions?' + org + '&action_id=in.(' + ids.join(',') + ')' +
      '&select=action_id,decision,note,decided_by,created_at&order=created_at.desc&limit=500');
  }
  const latest = {};
  for (const d of decisions) if (!latest[d.action_id]) latest[d.action_id] = d;
  return {
    actions: actions.slice(0, 100).map(a => ({ ...a, last_decision: latest[a.id] || null, retry_needed: a.action_type === 'FILE_MOVE' && latest[a.id]?.decision === 'approve', blocked_reason: filingBlock(a), can_retry: !filingBlock(a) })),
    truncated: actions.length > 100,
    guardrail: 'Valider lance l’action à l’intérieur du cabinet (tâche de l’équipe, pièce à classer, message à un collègue à valider). Jamais d’e-mail à un client, jamais de suppression.'
  };
}

export async function recordDecision(orgId, input, fetchRows = rest, deps = {}) {
  if (input?.action === 'apply-current-destination') return applyCurrentDestination(orgId, input, fetchRows, deps);
  if (input?.action === 'inspect-file' || input?.action === 'trash-file') return proposalFileAction(orgId, input, fetchRows, deps);
  if (input?.action === 'rename-file') return renameFromProposal(orgId, input, fetchRows, deps);
  if (input?.action === 'resolve-duplicate') return resolveDuplicate(orgId, input, fetchRows, deps);
  if (input?.action === 'reconcile') return reconcileFileMove(orgId, input, fetchRows, deps);
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

export async function proposalFileAction(orgId, input, fetchRows = rest, deps = {}) {
  const id = String(input.action_id || '');
  if (!ACTION_ID.test(id)) throw fail('VALID_ACTION_ID_REQUIRED', 400);
  if (input.action === 'trash-file' && input.confirm_trash !== true) throw fail('TRASH_CONFIRMATION_REQUIRED', 400);
  const path = 'office_action_queue?org_id=eq.' + encodeURIComponent(orgId) + '&id=eq.' + id;
  const action = (await fetchRows(path + '&select=*&limit=1'))?.[0];
  if (!action || action.action_type !== 'FILE_MOVE' || !action.payload?.file_id) throw fail('ACTION_NOT_FOUND', 404);
  const td = deps.tidyDrive || (await import('./tidy-drive.js')).tidyDrive;
  const live = await td.getFile(action.payload.file_id);
  if (!live || live.trashed || live.mimeType === 'application/vnd.google-apps.folder') throw fail('FILE_UNAVAILABLE', 409);
  if (!deps.tidyDrive) {
    const { assertReaderFileScope } = await import('./bounded-content.js');
    const { firmDriveId, firmDriveKind } = await import('./google-connection.js');
    await assertReaderFileScope(live, { rootId: firmDriveId(), kind: firmDriveKind(), getMeta: fileId => td.getFile(fileId) });
  }
  if (input.action === 'inspect-file') return { file_id: live.id, name: live.name, version: live.version, checksum: live.md5Checksum || null, can_trash: live.capabilities?.canTrash ?? null, owner: live.owners?.[0]?.emailAddress || null, url: 'https://drive.google.com/file/d/' + encodeURIComponent(live.id) + '/view' };
  if (live.capabilities?.canTrash === false) throw fail('DRIVE_TRASH_PERMISSION_REQUIRED', 403);
  if (!input.version || String(live.version) !== String(input.version) || live.name !== input.file_name) throw fail('FILE_CHANGED_REVIEW_REQUIRED', 409);
  await fetchRows('office_action_decisions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ org_id: orgId, action_id: id, decision: 'defer', decided_by: input.decided_by || null, content_hash: contentHash(action), note: 'Instruction humaine : mettre ce fichier à la corbeille et annuler la proposition.', action_snapshot: { action_type: 'FILE_MOVE', file_id: live.id, name: live.name, version: live.version, resolution: 'trash-file' } }]) });
  const result = await td.trashFile(live.id, { expectedVersion: live.version, expectedName: live.name });
  if (!result?.trashed) throw fail('TRASH_VERIFICATION_FAILED', 409);
  await fetchRows('office_action_decisions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ org_id: orgId, action_id: id, decision: 'reject', decided_by: input.decided_by || null, content_hash: contentHash(action), note: 'Mise à la corbeille vérifiée ; proposition annulée.', action_snapshot: { action_type: 'FILE_MOVE', file_id: live.id, resolution: 'SOURCE_TRASHED_BY_HUMAN' } }]) });
  await fetchRows(path, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'rejected', work_state: 'cancelled', verification_evidence: { resolution: 'SOURCE_TRASHED_BY_HUMAN', file_id: live.id, version: live.version, resolved_at: new Date().toISOString() } }) });
  const auditFn = deps.audit !== undefined ? deps.audit : (fetchRows === rest ? audit : null);
  if (auditFn) await auditFn(orgId, { agent: action.agent_key || 'orpailleur', action_type: 'FILE_TRASHED_BY_HUMAN', ref_id: id, reviewer: input.decided_by, decision: 'trash-file', status: 'verified', output_ref: live.id });
  return { resolved: true, trashed: true, effect: '« ' + live.name + ' » a été mis à la corbeille et vérifié dans le Drive.' };
}

export async function renameFromProposal(orgId, input, fetchRows = rest, deps = {}) {
  const id = String(input.action_id || '');
  if (!ACTION_ID.test(id)) throw fail('VALID_ACTION_ID_REQUIRED', 400);
  const name = String(input.new_name || '').trim();
  if (!name || name.length > 250 || /[\\/\x00-\x1f]/.test(name) || ['.', '..'].includes(name)) throw fail('VALID_FILENAME_REQUIRED', 400);
  const source = (await fetchRows('office_action_queue?org_id=eq.' + encodeURIComponent(orgId) + '&id=eq.' + id + '&select=*&limit=1'))?.[0];
  if (!source || source.action_type !== 'FILE_MOVE' || source.status === 'rejected') throw fail('ACTION_NOT_FOUND', 404);
  const td = deps.tidyDrive || (await import('./tidy-drive.js')).tidyDrive;
  const live = await td.getFile(source.payload.file_id);
  if (!live || live.trashed || live.mimeType === 'application/vnd.google-apps.folder') throw fail('FILE_UNAVAILABLE', 409);
  if (!deps.tidyDrive) {
    const { assertReaderFileScope } = await import('./bounded-content.js');
    const { firmDriveId, firmDriveKind } = await import('./google-connection.js');
    await assertReaderFileScope(live, { rootId: firmDriveId(), kind: firmDriveKind(), getMeta: fileId => td.getFile(fileId) });
  }
  const ext = /\.[a-z0-9]{1,10}$/i.exec(live.name || '')?.[0];
  if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) throw fail('KEEP_FILE_EXTENSION', 400);
  if (live.name === name) return { executed: true, verified: true, effect: 'Le fichier porte déjà ce nom.' };
  const parent = live.parents?.[0];
  if (!parent) throw fail('FILE_PARENT_REQUIRED', 409);
  if (td.nameTaken && await td.nameTaken(parent, name, live.id)) throw fail('FILENAME_ALREADY_EXISTS', 409);
  const row = { org_id: orgId, agent_key: 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', summary: 'Renommage demandé : ' + live.name + ' → ' + name, idempotency_key: 'human-rename:' + crypto.createHash('sha256').update(JSON.stringify([live.id,live.version || live.name,name])).digest('hex'), payload: { file_id: live.id, file_name: live.name, from_parent: parent, to_parent: parent, new_name: name, requested_from: id, rename_only: true } };
  const action = (await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([row]) }))?.[0];
  if (!action?.id) throw fail('RENAME_ALREADY_REQUESTED_REFRESH', 409);
  return recordDecision(orgId, { action_id: action.id, decision: 'approve', decided_by: input.decided_by, note: 'Nom choisi explicitement par l’utilisateur ; conserver le dossier actuel.' }, fetchRows, { ...deps, tidyDrive: { ...td, findContentDuplicate: async () => null } });
}

export async function applyCurrentDestination(orgId, input, fetchRows = rest, deps = {}) {
  const id = String(input.action_id || '');
  if (!ACTION_ID.test(id)) throw fail('VALID_ACTION_ID_REQUIRED', 400);
  if (input.confirm_destination !== true) throw fail('DESTINATION_CONFIRMATION_REQUIRED', 400);
  const org = 'org_id=eq.' + encodeURIComponent(orgId);
  const old = (await fetchRows('office_action_queue?' + org + '&id=eq.' + id + '&select=*&limit=1'))?.[0];
  if (!old || old.action_type !== 'FILE_MOVE' || !old.payload?.to_parent || old.payload.create || old.executed_at || old.status === 'rejected' || old.verification_evidence?.error_code === 'PROPOSAL_SUPERSEDED') throw fail('ACTION_NOT_RETRYABLE', 409);
  const td = deps.tidyDrive || (await import('./tidy-drive.js')).tidyDrive;
  const live = await td.getFile(old.payload.file_id);
  if (!live || live.trashed || !live.parents?.[0] || live.mimeType === 'application/vnd.google-apps.folder') throw fail('FILE_UNAVAILABLE', 409);
  if (!input.version || String(input.version) !== String(live.version)) throw fail('FILE_CHANGED_REVIEW_REQUIRED', 409);
  const target = await td.getFile(old.payload.to_parent);
  if (!target || target.trashed || target.mimeType !== 'application/vnd.google-apps.folder') throw fail('DESTINATION_UNAVAILABLE', 409);
  if (!deps.tidyDrive) {
    const { assertReaderFileScope } = await import('./bounded-content.js');
    const { firmDriveId, firmDriveKind } = await import('./google-connection.js');
    const scope = { rootId: firmDriveId(), kind: firmDriveKind(), getMeta: fileId => td.getFile(fileId) };
    await assertReaderFileScope(live, scope); await assertReaderFileScope(target, scope);
  }
  const row = { org_id: orgId, agent_key: old.agent_key || 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', office_mission_id: old.office_mission_id || null, summary: old.summary, payload: { ...old.payload, from_parent: live.parents[0], file_name: live.name, requested_from: id }, idempotency_key: 'human-destination:' + crypto.createHash('sha256').update(JSON.stringify([id,live.id,live.version,live.parents,old.payload.to_parent,old.payload.new_name])).digest('hex') };
  const action = (await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([row]) }))?.[0];
  if (!action?.id) throw fail('DESTINATION_ALREADY_REQUESTED_REFRESH', 409);
  const result = await recordDecision(orgId, { action_id: action.id, decision: 'approve', decided_by: input.decided_by, note: 'Destination explicitement confirmée après vérification du dossier actuel.' }, fetchRows, { ...deps, tidyDrive: td });
  await fetchRows('office_action_queue?' + org + '&id=eq.' + id + '&executed_at=is.null', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'blocked', verification_evidence: { error_code: 'PROPOSAL_SUPERSEDED', superseded_by: action.id, checked_at: new Date().toISOString() } }) });
  return { ...result, replacement_action_id: action.id };
}

export async function resolveDuplicate(orgId, input, fetchRows = rest, deps = {}) {
  const id = String(input.action_id || '');
  if (!ACTION_ID.test(id)) throw fail('VALID_ACTION_ID_REQUIRED', 400);
  if (!['keep-both', 'cancel-move', 'trash-file'].includes(input.choice)) throw fail('DUPLICATE_CHOICE_REQUIRED', 400);
  if (input.choice === 'trash-file' && input.confirm_trash !== true) throw fail('TRASH_CONFIRMATION_REQUIRED', 400);
  const path = 'office_action_queue?org_id=eq.' + encodeURIComponent(orgId) + '&id=eq.' + id;
  const action = (await fetchRows(path + '&select=*&limit=1'))?.[0];
  if (!action || action.action_type !== 'FILE_MOVE' || action.status !== 'approved' || action.executed_at || action.verification_evidence?.error_code !== 'CONTENT_DUPLICATE') throw fail('DUPLICATE_NOT_PENDING', 409);
  const prior = (await fetchRows('office_action_decisions?org_id=eq.' + encodeURIComponent(orgId) + '&action_id=eq.' + id + '&select=decision,content_hash&order=created_at.desc&limit=1'))?.[0];
  if (prior?.decision !== 'approve' || prior.content_hash !== contentHash(action)) throw fail('APPROVAL_REQUIRED_FOR_CURRENT_CONTENT', 409);
  const keep = input.choice === 'keep-both';
  if (input.choice === 'trash-file') {
    const td = deps.tidyDrive || (await import('./tidy-drive.js')).tidyDrive;
    const twin = await td.findContentDuplicate(action.payload.file_id, action.payload.to_parent || action.payload.from_parent);
    if (!twin || twin.id !== action.verification_evidence.existing_file_id || !twin.checksum || twin.checksum !== action.verification_evidence.checksum) throw fail('DUPLICATE_CHANGED_REVIEW_REQUIRED', 409);
    await fetchRows('office_action_decisions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ org_id: orgId, action_id: id, decision: 'approve', decided_by: input.decided_by || null, content_hash: contentHash(action), note: 'Décision explicite : mettre uniquement le fichier source du doublon à la corbeille.', action_snapshot: { action_type: 'FILE_MOVE', duplicate_choice: 'trash-file', file_id: action.payload.file_id, existing_file_id: twin.id } }]) });
    const result = await td.trashFile(action.payload.file_id, { expectedChecksum: twin.checksum });
    if (result?.trashed !== true) throw fail('TRASH_VERIFICATION_FAILED', 409);
    await fetchRows(path + '&status=eq.approved&executed_at=is.null', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'rejected', work_state: 'cancelled', verification_evidence: { ...action.verification_evidence, resolution: 'SOURCE_TRASHED_BY_HUMAN', resolved_at: new Date().toISOString(), file_id: action.payload.file_id } }) });
    const auditFn = deps.audit !== undefined ? deps.audit : (fetchRows === rest ? audit : null);
    if (auditFn) await auditFn(orgId, { agent: action.agent_key || 'orpailleur', action_type: 'DUPLICATE_SOURCE_TRASHED', ref_id: id, reviewer: input.decided_by, decision: 'trash-file', input_hash: contentHash(action), status: 'verified', output_ref: action.payload.file_id });
    return { resolved: true, trashed: true, executed: false, effect: 'Ce fichier a été mis à la corbeille et vérifié. L’autre exemplaire est conservé ; le déplacement est annulé.' };
  }
  await fetchRows('office_action_decisions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ org_id: orgId, action_id: id, decision: keep ? 'approve' : 'reject', decided_by: input.decided_by || null, content_hash: contentHash(action), note: keep ? 'Doublon : conserver les deux fichiers et ranger celui-ci à la destination approuvée.' : 'Doublon : annuler ce déplacement et conserver les deux fichiers à leurs emplacements actuels.', action_snapshot: { action_type: 'FILE_MOVE', duplicate_choice: input.choice, existing_file_id: action.verification_evidence.existing_file_id } }]) });
  let result;
  if (!keep) {
    await fetchRows(path + '&status=eq.approved&executed_at=is.null', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'rejected', work_state: 'cancelled', verification_evidence: { ...action.verification_evidence, resolution: 'CANCEL_MOVE_KEEP_FILES', resolved_at: new Date().toISOString() } }) });
    result = { resolved: true, executed: false, effect: 'Déplacement annulé. Les deux fichiers restent à leurs emplacements actuels.' };
  } else result = await (deps.execute || executeDecision)(orgId, action, 'approve', input.decided_by, { ...deps, fetchRows, reexecute: true, duplicateConsent: { id: action.verification_evidence.existing_file_id, checksum: action.verification_evidence.checksum } });
  const auditFn = deps.audit !== undefined ? deps.audit : (fetchRows === rest ? audit : null);
  if (auditFn) await auditFn(orgId, { agent: action.agent_key || 'orpailleur', action_type: 'DUPLICATE_RESOLVED', ref_id: id, reviewer: input.decided_by, decision: input.choice, input_hash: contentHash(action), status: result.executed ? 'executed' : result.resolved ? 'cancelled' : 'blocked', output_ref: result.effect });
  return result;
}

export async function reconcileFileMove(orgId, input, fetchRows = rest, deps = {}) {
  const id = String(input.action_id || '');
  if (!ACTION_ID.test(id)) throw fail('VALID_ACTION_ID_REQUIRED', 400);
  const path = 'office_action_queue?org_id=eq.' + encodeURIComponent(orgId) + '&id=eq.' + id;
  const action = (await fetchRows(path + '&select=*&limit=1'))?.[0];
  if (!action || action.action_type !== 'FILE_MOVE') throw fail('ACTION_NOT_FOUND', 404);
  if (action.verification_evidence?.error_code === 'PROPOSAL_SUPERSEDED') throw fail('PROPOSAL_SUPERSEDED', 409);
  if (!['approved', 'proposed', 'awaiting_approval'].includes(action.status)) throw fail('ACTION_NOT_RETRYABLE', 409);
  if (action.executed_at) return { executed: true, verified: Boolean(action.verified_at), effect: 'Cette action est déjà terminée.' };
  const td = deps.tidyDrive || (await import('./tidy-drive.js')).tidyDrive;
  const live = await td.getFile(action.payload.file_id);
  const now = new Date().toISOString();
  let evidence;
  let closed = false;
  const p = action.payload;
  if (!live || live.trashed) evidence = { error_code: live?.trashed ? 'FILE_TRASHED' : 'FILE_UNAVAILABLE', checked_at: now };
  else if (!p.create && p.to_parent && live.parents?.includes(p.to_parent) && (!p.new_name || live.name === p.new_name)) {
    closed = true; evidence = { result: 'ALREADY_AT_APPROVED_DESTINATION', file_id: live.id, name: live.name, parents: live.parents, checked_at: now };
  } else if (p.from_parent && !live.parents?.includes(p.from_parent) && !live.parents?.includes(p.to_parent)) evidence = { error_code: 'SOURCE_CHANGED_REPLAN_REQUIRED', file_id: live.id, actual_parents: live.parents, expected_parent: p.from_parent, checked_at: now };
  else {
    const duplicate = td.findContentDuplicate ? await td.findContentDuplicate(p.file_id, p.to_parent || p.from_parent) : null;
    evidence = duplicate ? { error_code: 'CONTENT_DUPLICATE', file_id: p.file_id, existing_file_id: duplicate.id, checksum: duplicate.checksum, checked_at: now } : { result: 'SOURCE_RECHECKED', file_id: live.id, parents: live.parents, checked_at: now };
  }
  await fetchRows(path + '&executed_at=is.null', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: closed ? 'executed' : evidence.error_code ? 'blocked' : 'requested', verification_evidence: evidence, ...(closed ? { executed_at: now, verified_at: now } : {}) }) });
  const auditFn = deps.audit !== undefined ? deps.audit : (fetchRows === rest ? audit : null);
  if (auditFn) await auditFn(orgId, { agent: action.agent_key || 'orpailleur', action_type: 'FILE_MOVE_RECONCILED', source_ref: 'office_action_queue:' + id, ref_id: id, status: closed ? 'verified' : evidence.error_code ? 'blocked' : 'requested', error: evidence.error_code || null, output_ref: JSON.stringify(evidence).slice(0, 300) });
  return { executed: closed, verified: closed, reconciled: true, can_retry: !evidence.error_code, effect: closed ? 'Déjà à la destination prévue : vérifié et clôturé, sans déplacer le fichier.' : filingBlock({ verification_evidence: evidence }) || 'Source vérifiée. Le déplacement approuvé peut être repris.' };
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
