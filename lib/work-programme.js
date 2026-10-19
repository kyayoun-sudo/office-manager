import { acquireReaderLease } from './inspection-runtime.js';
import { analysePlanning, cleanPlanning, verifyPlanningSources } from './programme-planning.js';
import { exportProgramme } from './programme-document.js';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { methodologyState, librarySummary } from './methodology.js';
import { audit } from './audit-log.js';
import { emit } from './event-bus.js';

// THE MISSION'S WORK PROGRAMME (Paul, 2026-10-12). After the analytical review the Manager chooses the cycles and the
// controls. Two ways in: he fills it here — the Mission Controller proposes, for each chosen cycle, the procedures of the
// firm's SOP with their codes (mandatory ones ticked, risk-dependent ones to activate with a reason, optional ones to
// choose) — or he imports his own programme (a file in the Drive: the procedure codes written in it are recognised by
// code, never guessed). He sets the materiality (from his Excel), who prepares each cycle, the sample sizes, and the
// reviews this mission requires (Senior, Manager, Supervisor, Partner — only if the mission requires them). Validated,
// the programme is frozen (a later change = a new version) and it is what the Enhanced Auditor follows.

const q = encodeURIComponent;
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const cut = (s, n) => s == null || s === '' ? null : String(s).slice(0, n);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EDITORS = ['owner', 'partner', 'manager', 'supervisor'];
export const VALIDATORS = ['owner', 'partner', 'manager'];
export const REVIEW_LEVELS = ['senior', 'manager', 'supervisor', 'partner'];
const CYCLE_STATUS = ['IN_SCOPE', 'LIMITED_SCOPE', 'N/A_JUSTIFIED'];

async function mission(orgId, missionId, fetchRows) {
  if (!UUID.test(String(missionId || ''))) throw fail('MISSION_ID_REQUIRED');
  const m = (await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=id,name,client_name,drive_folder_id,client_folder_id,planned_start,planned_end&limit=1`))?.[0];
  if (!m) throw fail('MISSION_NOT_FOUND', 404);
  return m;
}
export async function missionTeam(orgId, missionId, fetchRows = rest) {
  const asg = await fetchRows(`office_mission_assignments?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&select=staff_profile_id,mission_role,status`).catch(() => []) || [];
  const ids = [...new Set(asg.map(a => a.staff_profile_id).filter(Boolean))];
  const people = ids.length ? await fetchRows(`office_staff_profiles?org_id=eq.${q(orgId)}&id=in.(${ids.map(q).join(',')})&select=id,full_name,email,role_title`).catch(() => []) || [] : [];
  const byId = new Map(people.map(p => [p.id, p]));
  return asg.filter(a => byId.has(a.staff_profile_id) && a.status !== 'cancelled').map(a => ({ name: byId.get(a.staff_profile_id).full_name, email: byId.get(a.staff_profile_id).email || null, mission_role: a.mission_role || null }));
}
async function versions(orgId, missionId, fetchRows) {
  return await fetchRows(`office_work_programmes?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&select=*&order=version.desc&limit=20`) || [];
}
// The programme a person sees: the current draft if any, else the validated one.
function current(list) { return list.find(r => r.status === 'draft') || list.find(r => r.status === 'validated') || null; }

// A mission created directly (lib/mission-quick.js, Paul 2026-10-19: « un auditeur peut recevoir une mission à lui, il la
// fait là-bas ») is led by the person who created it while still on its team: they set and validate its programme.
// Read from the mission itself (created_by + origin + current assignment), never from what the browser says.
export async function isDirectMissionLead(orgId, missionId, account, fetchRows = rest) {
  const me = String(account?.email || '').toLowerCase();
  if (!me) return false;
  const m = (await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=created_by,origin&limit=1`).catch(() => null))?.[0];
  if (!m?.origin || String(m.created_by || '').toLowerCase() !== me) return false;
  return (await missionTeam(orgId, missionId, fetchRows)).some(t => String(t.email || '').toLowerCase() === me);
}

// Who may change it: the firm's partners, or a manager / supervisor of THIS mission (or the lead of a direct mission).
async function mayEdit(orgId, missionId, account, fetchRows, roles = EDITORS) {
  if (account && !roles.includes(account.role) && await isDirectMissionLead(orgId, missionId, account, fetchRows)) return;
  if (!account || !roles.includes(account.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  if (['owner', 'partner'].includes(account.role)) return;
  const team = await missionTeam(orgId, missionId, fetchRows);
  const me = String(account.email || '').toLowerCase();
  if (!team.some(t => String(t.email || '').toLowerCase() === me)) throw fail('NOT_ON_THIS_MISSION', 403);
}

// The procedures of a SOP, as programme lines: mandatory ones active, the others to decide.
export function proposeCycle(sop, previous = null) {
  const old = new Map((previous?.procedures || []).map(p => [p.code, p]));
  return {
    sop_file_id: sop.file_id, sop_file_name: sop.file_name, cycle_code: sop.cycle?.code || null, cycle_title: sop.cycle?.title || sop.file_name,
    status: previous?.status || 'IN_SCOPE', justification: previous?.justification || null, preparer: previous?.preparer || null,
    procedures: (sop.procedures || []).map(p => {
      const o = old.get(p.code);
      return { code: p.code, title: p.title, type: p.type, condition: p.condition || null, level: p.level || null, sampling_mode: p.sampling_mode || null,
        active: o ? Boolean(o.active) : p.type === 'CORE', justification: o?.justification || null,
        sample_size: o?.sample_size ?? p.sample_size ?? null, preparer: o?.preparer || null };
    })
  };
}

export async function programmeView(orgId, missionId, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const m = await mission(orgId, missionId, fetchRows);
  const list = await versions(orgId, missionId, fetchRows);
  const team = await missionTeam(orgId, missionId, fetchRows);
  const me = String(account?.email || '').toLowerCase();
  const names = [me, String(account?.display_name || '').toLowerCase()].filter(Boolean);
  const prepares = list.some(p => (p.cycles || []).some(c => names.includes(String(c.preparer || '').toLowerCase()) || (c.procedures || []).some(x => names.includes(String(x.preparer || '').toLowerCase()))));
  if (!account || (!['owner', 'partner'].includes(account.role) && !prepares && !team.some(t => String(t.email || '').toLowerCase() === me && me))) throw fail('NOT_ON_THIS_MISSION', 403);
  const lib = await (d.methodology || methodologyState)({}, orgId);
  const cur = current(list);
  return {
    mission: { id: m.id, name: m.name, client: m.client_name || null },
    programme: cur, validated: list.find(r => r.status === 'validated') || null, history: list.map(r => ({ version: r.version, status: r.status, validated_by: r.validated_by, validated_at: r.validated_at, updated_at: r.updated_at })),
    library: librarySummary(lib).sops.filter(s => s.procedures > 0).map(s => ({ file_id: s.file_id, file_name: s.file_name, family: s.family, cycle: s.cycle, procedures: s.procedures })),
    team: await missionTeam(orgId, missionId, fetchRows),
    ...(await (async () => { const lead = account && !VALIDATORS.includes(account.role) && await isDirectMissionLead(orgId, missionId, account, fetchRows);
      return { may_edit: Boolean(account && (EDITORS.includes(account.role) || lead)), may_validate: Boolean(account && (VALIDATORS.includes(account.role) || lead)), direct_lead: Boolean(lead) }; })())
  };
}

// Clean what the screen sends (never trust the client: codes must exist in the library).
function cleanProgramme(body, lib, account) {
  const sops = new Map((lib.sops || []).map(s => [s.file_id, s]));
  const cycles = [];
  for (const c of Array.isArray(body.cycles) ? body.cycles.slice(0, 40) : []) {
    const sop = sops.get(String(c.sop_file_id || ''));
    if (!sop) throw fail('SOP_NOT_IN_LIBRARY', 400, { detail: c.sop_file_id });
    const base = proposeCycle(sop);
    const sent = new Map((Array.isArray(c.procedures) ? c.procedures : []).map(p => [String(p.code || ''), p]));
    cycles.push({ ...base, planning_questions: (Array.isArray(c.planning_questions) ? c.planning_questions : []).slice(0,30).map(x=>({text:cut(x.text,1000),resolution:cut(x.resolution,1000),resolved_by:x.resolution?account.email:null})), status: CYCLE_STATUS.includes(c.status) ? c.status : 'IN_SCOPE', justification: cut(c.justification, 600), preparer: cut(c.preparer, 200),
      procedures: base.procedures.map(p => {
        const s = sent.get(p.code); if (!s) return p;
        const size = s.sample_size === '' || s.sample_size == null ? null : Math.max(1, Math.min(10000, Math.round(Number(s.sample_size)) || 0)) || null;
        return { ...p, planning: cleanPlanning(s.planning, account), active: Boolean(s.active), justification: cut(s.justification, 600), sample_size: size, preparer: cut(s.preparer, 200) };
      }) });
  }
  const num = v => v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
  const mat = body.materiality || {};
  const materiality = { overall: num(mat.overall), performance: num(mat.performance), trivial: num(mat.trivial), currency: cut(mat.currency, 10) || 'FCFA',
    basis: cut(mat.basis, 300), file: cut(String(mat.file || '').match(/[-\w]{20,}/)?.[0], 120),
    // The mission's working-papers folder, when the application does not find it under the mission.
    workpapers_folder: cut(String(mat.workpapers_folder || '').match(/[-\w]{20,}/)?.[0], 120) };
  const reviews = Object.fromEntries(REVIEW_LEVELS.map(k => [k, Boolean(body.reviews?.[k])]));
  return { cycles, materiality, reviews };
}

// What blocks the validation (a list, so the Manager sees everything at once).
export function validationGaps(p) {
  const gaps = [];
  if (!p.materiality?.overall) gaps.push({ gap: 'MATERIALITY_REQUIRED' });
  if (!(p.cycles || []).length) gaps.push({ gap: 'NO_CYCLE' });
  if (!REVIEW_LEVELS.some(k => p.reviews?.[k])) gaps.push({ gap: 'REVIEW_LEVEL_REQUIRED' });
  for (const c of p.cycles || []) {
    for (const x of c.planning_questions || []) if (!x.resolution) gaps.push({gap:'PLANNING_QUESTION_OPEN',cycle:c.cycle_code});
    if (c.status === 'N/A_JUSTIFIED') { if (!c.justification) gaps.push({ gap: 'CYCLE_NA_NEEDS_REASON', cycle: c.cycle_code }); continue; }
    if (!c.preparer) gaps.push({ gap: 'CYCLE_PREPARER_REQUIRED', cycle: c.cycle_code });
    if (!c.procedures.some(x => x.active)) gaps.push({ gap: 'CYCLE_WITHOUT_PROCEDURE', cycle: c.cycle_code });
    for (const x of c.procedures) {
      if (x.planning && (!x.planning.reviewed || !x.planning.review_note || !x.planning.reviewed_by)) gaps.push({gap:'PLANNING_REVIEW_REQUIRED',cycle:c.cycle_code,code:x.code});
      if (x.type === 'CORE' && !x.active && !x.justification) gaps.push({ gap: 'MANDATORY_OFF_NEEDS_REASON', cycle: c.cycle_code, code: x.code });
      if (x.type === 'RISK_DEPENDENT' && x.active && !x.justification) gaps.push({ gap: 'RISK_DEPENDENT_NEEDS_REASON', cycle: c.cycle_code, code: x.code });
      if (x.active && x.sampling_mode === 'programme_sample' && !x.sample_size) gaps.push({ gap: 'SAMPLE_SIZE_REQUIRED', cycle: c.cycle_code, code: x.code });
    }
  }
  return gaps;
}

export async function saveProgramme(orgId, missionId, body, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  await mission(orgId, missionId, fetchRows);
  await mayEdit(orgId, missionId, account, fetchRows);
  const lib = await (d.methodology || methodologyState)({}, orgId);
  const clean = cleanProgramme(body, lib, account);
  await verifyPlanningSources(clean.cycles, await mission(orgId, missionId, fetchRows), account, d.drive || driveAdapter);
  const list = await versions(orgId, missionId, fetchRows);
  const draft = list.find(r => r.status === 'draft');
  const base = current(list);
  if (Object.hasOwn(body, 'expected_programme_id') && ((base?.id || null) !== body.expected_programme_id || (base?.updated_at || null) !== (body.expected_updated_at || null))) throw fail('PROGRAMME_CHANGED_RELOAD',409);
  const now = new Date().toISOString(), by = account.email || account.display_name || null;
  const row = { ...clean, source: body.source === 'import' ? 'import' : (draft?.source || 'manual'), imported_file_id: cut(body.imported_file_id, 120) || draft?.imported_file_id || null, updated_by: by, updated_at: now };
  let saved;
  if (draft) saved = (await fetchRows(`office_work_programmes?id=eq.${q(draft.id)}&org_id=eq.${q(orgId)}&status=eq.draft${Object.hasOwn(body,'expected_programme_id') && draft.updated_at ? '&updated_at=eq.'+q(draft.updated_at) : ''}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) }))?.[0];
  else saved = (await fetchRows('office_work_programmes', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{ org_id: orgId, office_mission_id: missionId, version: (list[0]?.version || 0) + 1, status: 'draft', created_by: by, ...row }]) }))?.[0];
  if (!saved) throw fail('PROGRAMME_NOT_SAVED', 409);
  return { programme: saved, gaps: validationGaps(saved) };
}

export async function validateProgramme(orgId, missionId, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  await mission(orgId, missionId, fetchRows);
  await mayEdit(orgId, missionId, account, fetchRows, VALIDATORS);
  const list = await versions(orgId, missionId, fetchRows);
  const draft = list.find(r => r.status === 'draft');
  if (!draft) throw fail('NO_DRAFT_TO_VALIDATE', 409);
  if (d.expected && (d.expected.id !== draft.id || d.expected.updated_at !== draft.updated_at)) throw fail('PROGRAMME_CHANGED_RELOAD',409);
  await verifyPlanningSources(draft.cycles, await mission(orgId, missionId, fetchRows), account, d.drive || driveAdapter);
  const gaps = validationGaps(draft);
  if (gaps.length) throw fail('PROGRAMME_INCOMPLETE', 409, { gaps });
  const now = new Date().toISOString(), by = account.email || account.display_name;
  const done = (await fetchRows(`office_work_programmes?id=eq.${q(draft.id)}&org_id=eq.${q(orgId)}&status=eq.draft${d.expected && draft.updated_at ? '&updated_at=eq.'+q(draft.updated_at) : ''}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'validated', validated_by: by, validated_at: now, updated_at: now }) }))?.[0];
  if (!done) throw fail('PROGRAMME_NOT_SAVED', 409);
  for (const old of list.filter(r => r.status === 'validated' && r.id !== done.id)) await fetchRows(`office_work_programmes?id=eq.${q(old.id)}&org_id=eq.${q(orgId)}`, { method: 'PATCH', body: JSON.stringify({ status: 'superseded', updated_at: now }) });

  const active = done.cycles.reduce((n, c) => n + c.procedures.filter(p => p.active).length, 0);
  await (d.audit || audit)(orgId, { agent: 'mission-controller', mission_id: missionId, action_type: 'WORK_PROGRAMME_VALIDATED', approved_by: by, approved_at: now,
    output_ref: `version ${done.version} : ${done.cycles.length} cycle(s), ${active} procédure(s)` }).catch(() => null);
  await (d.emit || emit)(orgId, { type: 'WORK_PROGRAMME_VALIDATED', agent: 'mission-controller', actor: by, engagement_id: missionId, object_type: 'work_programme', object_id: done.id,
    version: done.version, payload: { version: done.version, cycles: done.cycles.map(c => c.cycle_code).join(','), procedures: active } }).catch(() => null);
  let document;
  try { document = await publishProgramme(orgId, missionId, account, d); } catch(e) { document = {status:'pending',error:e.message}; }
  return { programme: done, document };
}

// Import: the Manager's own programme (a file in the Drive). The procedure codes written in it are matched to the
// library by code; the rest is listed, never guessed. Nothing is saved: the screen shows the proposal, he saves it.
export function codesInText(text, lib) {
  const known = new Map();
  for (const s of lib.sops || []) for (const p of s.procedures || []) known.set(p.code, s.file_id);
  const found = new Set(String(text || '').toUpperCase().match(/\b[A-Z][A-Z0-9_]{1,7}-\d{1,3}[A-Z]?\b/g) || []);
  return { matched: [...found].filter(c => known.has(c)).map(c => ({ code: c, sop_file_id: known.get(c) })), unknown: [...found].filter(c => !known.has(c)) };
}
export async function importProgramme(orgId, missionId, body, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  await mission(orgId, missionId, fetchRows);
  await mayEdit(orgId, missionId, account, fetchRows);
  const fileId = String(body.file || '').match(/[-\w]{20,}/)?.[0];
  if (!fileId) throw fail('PROGRAMME_FILE_REQUIRED');
  const read = await (d.drive || driveAdapter).readText(fileId, { maxChars: 200000, structured: true });
  const lib = await (d.methodology || methodologyState)({}, orgId);
  const { matched, unknown } = codesInText(read.text, lib);
  if (!matched.length) throw fail('NO_PROCEDURE_CODE_IN_FILE', 422, { unknown });
  const bySop = new Map();
  for (const m of matched) (bySop.get(m.sop_file_id) || bySop.set(m.sop_file_id, new Set()).get(m.sop_file_id)).add(m.code);
  const cycles = [...bySop.entries()].map(([fid, codes]) => {
    const c = proposeCycle(lib.sops.find(s => s.file_id === fid));
    // What the Manager wrote is what is planned: his codes active, the mandatory ones he left out shown to decide.
    c.procedures = c.procedures.map(p => ({ ...p, active: codes.has(p.code) }));
    return c;
  });
  return { file_id: fileId, file_name: read.file?.name || null, truncated: Boolean(read.truncated), cycles, matched: matched.map(m => m.code), unknown };
}

// The same draft is extended; existing selections, assignments and sampling decisions are preserved.
export async function planProgramme(orgId, missionId, body, account, d={}) {
  const fetchRows=d.fetchRows || rest, drive=d.drive || driveAdapter;
  const m=await mission(orgId,missionId,fetchRows); await mayEdit(orgId,missionId,account,fetchRows);
  const lib=await (d.methodology || methodologyState)({}, orgId);
  const result=await analysePlanning(orgId,m,body,account,lib,drive,d);
  const cycles=cleanProgramme(body,lib,account).cycles;
  for(const item of result.mappings){
    let c=cycles.find(c=>c.sop_file_id===item.sop_file_id);
    if(!c){c=proposeCycle(lib.sops.find(s=>s.file_id===item.sop_file_id));cycles.push(c);}
    const p=c.procedures.find(p=>p.code===item.code);
    p.planning={...item.planning,provider:result.provider,model:result.model,instruction_version:'programme-planning/1'};
    // New suggestions are not silently activated. A sourced decision is proposed active but still needs explicit human review.
    if(!body.cycles?.some(old=>old.sop_file_id===c.sop_file_id && old.procedures?.some(x=>x.code===p.code)))p.active=item.planning.origin==='source';
  }
  if(cycles.length && result.questions.length){
    const c=cycles[0]; c.planning_questions ||= [];
    for(const text of result.questions)if(!c.planning_questions.some(x=>x.text===text))c.planning_questions.push({text,resolution:null});
  }
  await (d.audit || audit)(orgId,{agent:'mission-controller',mission_id:missionId,action_type:'PROGRAMME_PLANNING_PROPOSED',status:'proposed',reviewer:account.email,input_hash:undefined,source_ref:result.sources.map(s=>s.file_id || 'discussion').join(','),output_ref:result.mappings.map(x=>x.code).join(','),decision:cut([result.provider,result.model,'programme-planning/1'].filter(Boolean).join(' / '),60)}).catch(()=>null);
  return {...result,cycles};
}
export async function publishProgramme(orgId,missionId,account,d={}) {
  const fetchRows=d.fetchRows || rest, drive=d.drive || driveAdapter;
  const m=await mission(orgId,missionId,fetchRows); await mayEdit(orgId,missionId,account,fetchRows,VALIDATORS);
  if (!m.drive_folder_id) throw fail('MISSION_FOLDER_NOT_KNOWN',409);
  let lease;
  try { lease=await (d.lease || acquireReaderLease)(orgId,'programme-document:'+missionId,{fetchRows,ttl:240}); }
  catch { throw fail('PROGRAMME_EXPORT_LOCK_UNAVAILABLE',409); }
  if (!lease) throw fail('PROGRAMME_EXPORT_BUSY',409);
  try {
    await lease.assertOwner();
    const p=(await versions(orgId,missionId,fetchRows)).find(p=>p.status==='validated');
    if(!p)throw fail('NO_VALIDATED_PROGRAMME',409);
    await verifyPlanningSources(p.cycles,m,account,drive);
    await lease.assertOwner();
    const doc=await (d.exportProgramme || exportProgramme)(m,p,drive);
    const materiality={...p.materiality,programme_document:doc};
    await lease.assertOwner();
    const saved=await fetchRows(`office_work_programmes?id=eq.${q(p.id)}&org_id=eq.${q(orgId)}&status=eq.validated`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({materiality})});
    if(!saved?.length)throw fail('PROGRAMME_CHANGED_RELOAD',409);
    await (d.audit || audit)(orgId,{agent:'mission-controller',mission_id:missionId,action_type:'WORK_PROGRAMME_EXPORTED',source_ref:p.id,output_ref:doc.id,input_hash:doc.sha256,reviewer:account.email,status:'verified'}).catch(()=>null);
    return {status:'verified',...doc};
  } finally { await lease.release(); }
}
