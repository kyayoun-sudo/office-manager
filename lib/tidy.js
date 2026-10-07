import { rest } from './supabase.js';
import { runAI } from './ai.js';
import { mappingGate } from './memory-runtime.js';
import { tidyDrive } from './tidy-drive.js';
import {
  AI_BATCH, pickPreference, ruleMatch, decideMode, preferenceKeys, buildAiRequest, parseAiDecisions
} from './tidy-planner.js';

// Orpailleur "Rangement" — requests, background steps, decisions, undo.
// One step does a bounded amount of work (plan a batch of files, or move a batch),
// so it fits in a Vercel function; steps are chained in the background.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_BATCH = AI_BATCH * 2;
const MOVE_BATCH = 15;
const err = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const q = v => encodeURIComponent(v);
const now = () => new Date().toISOString();

function d(deps = {}) {
  return {
    fetchRows: deps.fetchRows || rest,
    ai: deps.ai || runAI,
    drive: deps.drive || tidyDrive,
    gate: deps.gate || (() => mappingGate())
  };
}

async function loadRequest(orgId, id, fetchRows) {
  if (!UUID.test(id || '')) throw err('VALID_REQUEST_REQUIRED');
  const rows = await fetchRows('office_tidy_requests?org_id=eq.' + q(orgId) + '&id=eq.' + q(id) + '&select=*&limit=1');
  if (!rows?.[0]) throw err('REQUEST_NOT_FOUND', 404);
  return rows[0];
}

async function patchRequest(orgId, id, fields, fetchRows) {
  await fetchRows('office_tidy_requests?org_id=eq.' + q(orgId) + '&id=eq.' + q(id), {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...fields, updated_at: now() })
  });
}

async function patchItem(orgId, itemId, fields, fetchRows) {
  await fetchRows('office_tidy_items?org_id=eq.' + q(orgId) + '&id=eq.' + q(itemId), {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fields)
  });
}

export async function tally(orgId, requestId, fetchRows) {
  const rows = await fetchRows('office_tidy_items?org_id=eq.' + q(orgId) + '&request_id=eq.' + q(requestId) + '&select=mode,status&limit=10000');
  const c = { total: 0, moved: 0, to_review: 0, approved: 0, in_place: 0, needs_reading: 0, unsure: 0, rejected: 0, failed: 0, undone: 0 };
  for (const r of rows || []) {
    c.total++;
    if (r.status === 'moved') c.moved++;
    else if (r.status === 'approved') c.approved++;
    else if (r.status === 'rejected') c.rejected++;
    else if (r.status === 'failed') c.failed++;
    else if (r.status === 'undone') c.undone++;
    else if (r.mode === 'in_place') c.in_place++;
    else if (r.mode === 'needs_reading') c.needs_reading++;
    else if (r.mode === 'unsure') c.unsure++;
    else if (r.status === 'planned') c.to_review++;
  }
  return c;
}

// ---- Requests ----

export async function createRequest(orgId, body = {}, deps = {}) {
  const { fetchRows } = d(deps);
  const instructions = String(body.instructions || '').trim().slice(0, 2000);
  const scope = String(body.scope_path || '').trim().slice(0, 500) || null;
  if (!instructions && !scope) throw err('INSTRUCTIONS_REQUIRED');
  const title = (instructions || 'Rangement de ' + scope).replace(/\s+/g, ' ').slice(0, 90);
  const rows = await fetchRows('office_tidy_requests', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{ org_id: orgId, title, scope_path: scope, instructions: instructions || null,
      requested_by: body.requested_by ? String(body.requested_by).slice(0, 120) : null, status: 'planning', counts: {} }])
  });
  return rows?.[0] || { status: 'planning' };
}

export async function listRequests(orgId, deps = {}) {
  const { fetchRows } = d(deps);
  const rows = await fetchRows('office_tidy_requests?org_id=eq.' + q(orgId) + '&select=id,title,scope_path,status,counts,last_error,requested_by,created_at,updated_at&order=created_at.desc&limit=20');
  return { requests: rows || [] };
}

export async function getRequest(orgId, id, deps = {}) {
  const { fetchRows } = d(deps);
  const request = await loadRequest(orgId, id, fetchRows);
  const items = await fetchRows('office_tidy_items?org_id=eq.' + q(orgId) + '&request_id=eq.' + q(id) +
    '&select=id,file_name,current_path,dest_path,dest_folder_id,new_folder_name,confidence,rationale,source,mode,status,error,moved_at,decided_by' +
    '&order=status.asc,confidence.desc&limit=1000');
  return { request, items: items || [] };
}

// ---- Background step ----

export async function step(orgId, id, deps = {}) {
  const x = d(deps);
  const request = await loadRequest(orgId, id, x.fetchRows);
  if (['done', 'stopped', 'failed'].includes(request.status)) return { status: request.status, more: false };
  try {
    const result = request.status === 'planning' ? await planBatch(orgId, request, x) : await executeBatch(orgId, request, x);
    const counts = { ...(request.counts || {}), ...(await tally(orgId, id, x.fetchRows)), cursor: result.cursor ?? request.counts?.cursor ?? null };
    await patchRequest(orgId, id, { status: result.status, counts, last_error: result.last_error ?? null }, x.fetchRows);
    return { status: result.status, more: result.more, counts, last_error: result.last_error ?? null };
  } catch (e) {
    await patchRequest(orgId, id, { last_error: String(e.message || e).slice(0, 1000) }, x.fetchRows);
    throw e;
  }
}

async function planBatch(orgId, request, x) {
  const { fetchRows } = x;
  const org = 'org_id=eq.' + q(orgId);
  const cursor = request.counts?.cursor || null;
  const scope = request.scope_path ? '&folder_path=ilike.' + q('*' + request.scope_path.replace(/[*,()]/g, ' ') + '*') : '';
  const files = await fetchRows('orpailleur_inventory?' + org + '&is_folder=eq.false' + scope +
    (cursor ? '&file_id=gt.' + q(cursor) : '') +
    '&select=file_id,name,folder_path,parent_id,client_name,document_type,document_period,decision_status' +
    '&order=file_id.asc&limit=' + PLAN_BATCH);
  if (!files?.length) {
    const c = await tally(orgId, request.id, fetchRows);
    const status = c.approved ? 'executing' : c.to_review ? 'ready' : 'done';
    return { status, more: status === 'executing', cursor };
  }
  const folders = await fetchRows('orpailleur_inventory?' + org + '&is_folder=eq.true&select=file_id,name,folder_path,parent_id&limit=3000') || [];
  const folderIds = new Set(folders.map(f => f.file_id));
  const prefs = await fetchRows('office_tidy_preferences?' + org + '&select=key,dest_folder_id,dest_path,weight&limit=2000') || [];
  let excerpts = {};
  try {
    const ex = await fetchRows('orpailleur_inspection_queue?' + org + '&file_id=in.(' + files.map(f => '"' + String(f.file_id).replace(/"/g, '') + '"').join(',') + ')&select=file_id,content_excerpt&limit=' + PLAN_BATCH * 2);
    for (const e of ex || []) if (e.content_excerpt && !excerpts[e.file_id]) excerpts[e.file_id] = e.content_excerpt;
  } catch { excerpts = {}; }
  const gate = await x.gate().catch(() => ({ allowed: false }));

  const decisions = {};
  const forAi = [];
  for (const f of files) {
    f.excerpt = excerpts[f.file_id] || null;
    const dec = pickPreference(f, prefs, folderIds) || ruleMatch(f, folders);
    if (dec) decisions[f.file_id] = dec;
    else if (f.excerpt || f.client_name || f.document_type) forAi.push(f);
  }
  for (let i = 0; i < forAi.length; i += AI_BATCH) {
    const batch = forAi.slice(i, i + AI_BATCH);
    try {
      const reqAi = buildAiRequest(batch, folders, request.instructions);
      const res = await x.ai({ agentKey: 'orpailleur', provider: 'openai', instructions: reqAi.instructions, input: reqAi.input });
      Object.assign(decisions, parseAiDecisions(res.text, folders, batch));
    } catch { /* AI unavailable: these files stay "unsure" */ }
  }

  const rows = files.map(f => {
    const dec = decisions[f.file_id] || null;
    const mode = decideMode(f, dec, { gateAllowed: Boolean(gate?.allowed) });
    return {
      org_id: orgId, request_id: request.id, file_id: f.file_id, file_name: f.name || f.file_id,
      current_parent_id: f.parent_id || null, current_path: f.folder_path || null,
      dest_folder_id: dec?.dest_folder_id || null, dest_path: dec?.dest_path || null,
      new_folder_parent_id: dec?.new_folder_parent_id || null, new_folder_name: dec?.new_folder_name || null,
      confidence: dec ? Number(dec.confidence.toFixed(2)) : null, rationale: dec?.rationale || null,
      source: dec?.source || 'none', mode,
      status: mode === 'auto' ? 'approved' : mode === 'in_place' ? 'skipped' : 'planned',
      decided_by: mode === 'auto' ? 'Orpailleur (automatique)' : null, decided_at: mode === 'auto' ? now() : null,
      learn_keys: preferenceKeys(f)
    };
  });
  await fetchRows('office_tidy_items?on_conflict=request_id,file_id', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows)
  });
  return { status: 'planning', more: true, cursor: files[files.length - 1].file_id };
}

async function executeBatch(orgId, request, x) {
  const { fetchRows, drive } = x;
  const org = 'org_id=eq.' + q(orgId);
  const items = await fetchRows('office_tidy_items?' + org + '&request_id=eq.' + q(request.id) + '&status=eq.approved&error=is.null&select=*&order=created_at.asc&limit=' + MOVE_BATCH) || [];
  if (!items.length) {
    const c = await tally(orgId, request.id, fetchRows);
    return { status: c.to_review ? 'ready' : 'done', more: false };
  }
  const gate = await x.gate().catch(() => ({ allowed: false, state: 'MAP_UNREADABLE' }));
  if (!gate.allowed) return { status: 'ready', more: false, last_error: 'MAPPING_REVIEW_REQUIRED' };
  if (!drive.canWrite()) return { status: 'ready', more: false, last_error: 'DRIVE_WRITE_REQUIRES_DIRECT_ACCESS' };

  const created = {};
  for (const it of items) {
    // Claim the item first, so two overlapping steps never move the same file twice.
    const claimed = await fetchRows('office_tidy_items?' + org + '&id=eq.' + q(it.id) + '&status=eq.approved&error=is.null', {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ error: 'EN_COURS' })
    });
    if (!claimed?.length) continue;
    try {
      let dest = it.dest_folder_id;
      if (!dest && it.new_folder_parent_id && it.new_folder_name) {
        const key = it.new_folder_parent_id + '/' + it.new_folder_name;
        if (!created[key]) {
          const prior = await fetchRows('office_tidy_items?' + org + '&request_id=eq.' + q(request.id) +
            '&new_folder_parent_id=eq.' + q(it.new_folder_parent_id) + '&new_folder_name=eq.' + q(it.new_folder_name) +
            '&status=eq.moved&select=dest_folder_id&limit=1');
          created[key] = prior?.[0]?.dest_folder_id || (await drive.createFolder(it.new_folder_parent_id, it.new_folder_name)).id;
        }
        dest = created[key];
      }
      if (!dest) throw new Error('NO_DESTINATION');
      await drive.move(it.file_id, it.current_parent_id, dest);
      await patchItem(orgId, it.id, { status: 'moved', moved_at: now(), previous_parent_id: it.current_parent_id, dest_folder_id: dest, error: null }, fetchRows);
    } catch (e) {
      await patchItem(orgId, it.id, { status: 'failed', error: String(e.message || e).slice(0, 500) }, fetchRows);
    }
  }
  return { status: 'executing', more: true };
}

// ---- Learning ----

async function learn(orgId, keys, destId, destPath, delta, fetchRows) {
  if (!destId || !keys?.length) return;
  const org = 'org_id=eq.' + q(orgId);
  for (const key of keys.slice(0, 5)) {
    const cur = await fetchRows('office_tidy_preferences?' + org + '&key=eq.' + q(key) + '&dest_folder_id=eq.' + q(destId) + '&select=weight&limit=1');
    const weight = Math.max(-50, Math.min(50, Number(cur?.[0]?.weight || 0) + delta));
    await fetchRows('office_tidy_preferences?on_conflict=org_id,key,dest_folder_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, key, dest_folder_id: destId, dest_path: destPath || null, weight, updated_at: now() }])
    });
  }
}

// decision: approve | reject | correct (with dest_folder_id). item_ids: list, or "all" proposals.
export async function decide(orgId, body = {}, deps = {}) {
  const { fetchRows } = d(deps);
  const request = await loadRequest(orgId, body.request_id, fetchRows);
  const decision = String(body.decision || '');
  if (!['approve', 'reject', 'correct'].includes(decision)) throw err('INVALID_DECISION');
  const org = 'org_id=eq.' + q(orgId);
  let filter = '&status=eq.planned&mode=eq.proposal';
  if (body.item_ids !== 'all') {
    const ids = (Array.isArray(body.item_ids) ? body.item_ids : []).filter(i => UUID.test(i)).slice(0, 500);
    if (!ids.length) throw err('ITEMS_REQUIRED');
    filter = '&status=eq.planned&id=in.(' + ids.join(',') + ')';
  }
  const items = await fetchRows('office_tidy_items?' + org + '&request_id=eq.' + q(request.id) + filter + '&select=id,dest_folder_id,dest_path,learn_keys,mode&limit=500') || [];
  let destId = null, destPath = null;
  if (decision === 'correct') {
    destId = String(body.dest_folder_id || '');
    const f = await fetchRows('orpailleur_inventory?' + org + '&file_id=eq.' + q(destId) + '&is_folder=eq.true&select=file_id,name,folder_path&limit=1');
    if (!f?.[0]) throw err('DEST_FOLDER_NOT_FOUND', 404);
    destPath = [f[0].folder_path, f[0].name].filter(Boolean).join('/');
  }
  const by = body.decided_by ? String(body.decided_by).slice(0, 120) : null;
  for (const it of items) {
    if (decision === 'reject') {
      await patchItem(orgId, it.id, { status: 'rejected', decided_by: by, decided_at: now() }, fetchRows);
      await learn(orgId, it.learn_keys, it.dest_folder_id, it.dest_path, -1, fetchRows);
    } else {
      const fields = { status: 'approved', decided_by: by, decided_at: now() };
      if (decision === 'correct') Object.assign(fields, { dest_folder_id: destId, dest_path: destPath, new_folder_parent_id: null, new_folder_name: null });
      await patchItem(orgId, it.id, fields, fetchRows);
      await learn(orgId, it.learn_keys, decision === 'correct' ? destId : it.dest_folder_id, decision === 'correct' ? destPath : it.dest_path, decision === 'correct' ? 2 : 1, fetchRows);
    }
  }
  if (decision !== 'reject' && items.length && request.status !== 'planning') {
    await patchRequest(orgId, request.id, { status: 'executing' }, fetchRows);
  }
  return { updated: items.length, decision };
}

export async function undo(orgId, body = {}, deps = {}) {
  const { fetchRows, drive } = d(deps);
  if (!UUID.test(body.item_id || '')) throw err('VALID_ITEM_REQUIRED');
  const rows = await fetchRows('office_tidy_items?org_id=eq.' + q(orgId) + '&id=eq.' + q(body.item_id) + '&select=*&limit=1');
  const it = rows?.[0];
  if (!it) throw err('ITEM_NOT_FOUND', 404);
  if (it.status !== 'moved' || !it.previous_parent_id) throw err('NOT_UNDOABLE', 409);
  await drive.move(it.file_id, it.dest_folder_id, it.previous_parent_id);
  await patchItem(orgId, it.id, { status: 'undone', error: null }, fetchRows);
  await learn(orgId, it.learn_keys, it.dest_folder_id, it.dest_path, -2, fetchRows);
  return { undone: true };
}

export async function stop(orgId, body = {}, deps = {}) {
  const { fetchRows } = d(deps);
  const request = await loadRequest(orgId, body.request_id, fetchRows);
  await patchRequest(orgId, request.id, { status: 'stopped' }, fetchRows);
  return { stopped: true };
}
