import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { rest } from './supabase.js';
import { getProgramme } from './mission-programmes.js';
import { MISSION_ID } from './mission-dossier.js';
import { getDriveFileMetadata, configuredDriveId, createMissionBudgetFile } from './google-drive.js';
import { mappingGate } from './memory-runtime.js';

const q = encodeURIComponent;
const fail = (code, statusCode = 409) => { throw Object.assign(new Error(code), { statusCode }); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const number = (v, max) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max;

// Names are resolved from the internal directory, never supplied by the model.
// Hours and rates are explicit proposed inputs, not inferred from allocation_pct.
export async function prepareMissionBudget(orgId, body, deps = {}) {
  if (!body || typeof body !== "object") fail("INVALID_BUDGET_INPUT", 400);
  const fetchRows = deps.fetchRows || rest;
  if (!MISSION_ID.test(body.mission_id || '') || !MISSION_ID.test(body.programme_id || '') ||
      !Array.isArray(body.tasks) || !body.tasks.length || body.tasks.length > 100) fail('INVALID_BUDGET_INPUT', 400);
  const source = await (deps.getProgramme || getProgramme)(orgId, body.mission_id, fetchRows);
  const programme = source.programmes[0];
  if (!source.plan_approved) fail('PLAN_APPROVAL_REQUIRED');
  if (!programme || programme.id !== body.programme_id || programme.plan_id !== source.plan.id) fail('BUDGET_SOURCE_SUPERSEDED');
  const scope = 'org_id=eq.' + q(orgId);
  const assignments = await fetchRows('office_mission_assignments?' + scope + '&office_mission_id=eq.' + q(body.mission_id) + '&select=id,staff_profile_id,mission_role,status&limit=101');
  if (assignments.length > 100) fail('BUDGET_TEAM_TOO_LARGE');
  const confirmed = assignments.filter(a => ['confirmed', 'approved', 'validated'].includes(a.status));
  const ids = [...new Set(confirmed.map(a => a.staff_profile_id))];
  if (!ids.length) fail('CONFIRMED_TEAM_REQUIRED');
  if (ids.some(id => !MISSION_ID.test(id || ''))) fail('INVALID_STAFF_REFERENCE');
  const staff = await fetchRows('office_staff_profiles?' + scope + '&id=in.(' + ids.join(',') + ')&select=id,full_name&limit=100');
  const names = new Map(staff.map(s => [s.id, s.full_name]));
  const byAssignment = new Map(confirmed.map(a => [a.id, a]));
  const wanted = programme.phases.flatMap(p => p.tasks.map((t, i) => ({ phase_index: p.phase_index, task_index: i, title: t.title, procedure: t.procedure, due_on: t.due_on })));
  if (body.tasks.length !== wanted.length) fail('BUDGET_TASK_COVERAGE_REQUIRED');
  const seen = new Set();
  const team = new Map();
  const tasks = body.tasks.map(input => {
    const key = input.phase_index + ':' + input.task_index;
    const task = wanted.find(t => t.phase_index === input.phase_index && t.task_index === input.task_index);
    if (!task || seen.has(key) || !Array.isArray(input.allocations) || !input.allocations.length || input.allocations.length > 100) fail('INVALID_BUDGET_TASK', 400);
    seen.add(key);
    const members = new Set();
    const allocations = input.allocations.map(a => {
      const assignment = byAssignment.get(a.assignment_id);
      if (!assignment || members.has(a.assignment_id) || !number(a.hours, 10000) ||
          !(a.hourly_rate === null || (typeof a.hourly_rate === 'number' && Number.isFinite(a.hourly_rate) && a.hourly_rate >= 0 && a.hourly_rate <= 100000000)) ||
          typeof a.rate_source !== 'string' || a.rate_source.length > 500 || (a.hourly_rate !== null && !a.rate_source.trim())) fail('INVALID_BUDGET_ALLOCATION', 400);
      const name = names.get(assignment.staff_profile_id);
      if (!name) fail('STAFF_NAME_UNAVAILABLE');
      members.add(a.assignment_id);
      const member = { assignment_id: assignment.id, staff_profile_id: assignment.staff_profile_id, name, role: assignment.mission_role, hourly_rate: a.hourly_rate, rate_source: a.rate_source };
      const prior = team.get(assignment.id);
      if (prior && (prior.hourly_rate !== member.hourly_rate || prior.rate_source !== member.rate_source)) fail('INCONSISTENT_STAFF_RATE');
      team.set(assignment.id, member);
      return { assignment_id: assignment.id, hours: a.hours };
    });
    return { ...task, allocations };
  }).sort((a, b) => a.phase_index - b.phase_index || a.task_index - b.task_index);
  const data = {
    mission: source.mission, plan_id: source.plan.id, plan_hash: source.plan.content_hash,
    programme_id: programme.id, programme_hash: programme.content_hash,
    currency: String(body.currency || '').trim(), template_file_id: String(body.template_file_id || '').trim(),
    destination_parent_id: String(body.destination_parent_id || '').trim(),
    team: [...team.values()].sort((a, b) => a.assignment_id.localeCompare(b.assignment_id)), tasks
  };
  if (!/^[A-Z]{3}$/.test(data.currency) || !/^[A-Za-z0-9_-]{10,200}$/.test(data.template_file_id)) fail('BUDGET_CURRENCY_AND_TEMPLATE_REQUIRED', 400);
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(data.destination_parent_id)) fail('MISSION_BUDGET_FOLDER_REQUIRED', 400);
  const folders = await fetchRows('orpailleur_inventory?' + scope + '&office_mission_id=eq.' + q(body.mission_id) + '&file_id=eq.' + q(data.destination_parent_id) + '&is_folder=eq.true&select=file_id&limit=1');
  if (!folders[0]) fail('BUDGET_FOLDER_NOT_LINKED_TO_MISSION');
  return { data, content_hash: hash(data), status: 'proposed', missing_rates: data.team.filter(m => m.hourly_rate === null).map(m => m.assignment_id) };
}

export async function listMissionBudgets(orgId, missionId, fetchRows = rest) {
  if (!MISSION_ID.test(missionId || '')) fail('VALID_MISSION_ID_REQUIRED', 400);
  const [source, assignments, budgets] = await Promise.all([
    getProgramme(orgId, missionId, fetchRows),
    fetchRows('office_mission_assignments?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(missionId) + '&status=in.(confirmed,approved,validated)&select=id,staff_profile_id,mission_role,status&limit=101'),
    fetchRows('office_mission_budget_versions?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(missionId) + '&select=id,content_hash,data,created_at&order=created_at.desc&limit=20')
  ]);
  if (assignments.length > 100) fail('BUDGET_TEAM_TOO_LARGE');
  const ids = [...new Set(assignments.map(a => a.staff_profile_id))];
  if (ids.some(id => !MISSION_ID.test(id || ''))) fail('INVALID_STAFF_REFERENCE');
  const staff = ids.length ? await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=in.(' + ids.join(',') + ')&select=id,full_name&limit=100') : [];
  return { budgets, source, team: assignments.map(a => ({ ...a, name: staff.find(s => s.id === a.staff_profile_id)?.full_name || null })) };
}

async function loadBudget(orgId, id, fetchRows) {
  if (!MISSION_ID.test(id || '')) fail('VALID_BUDGET_ID_REQUIRED', 400);
  const rows = await fetchRows('office_mission_budget_versions?org_id=eq.' + q(orgId) + '&id=eq.' + q(id) + '&select=*&limit=1');
  if (!rows[0] || hash(rows[0].data) !== rows[0].content_hash) fail('BUDGET_NOT_FOUND_OR_CHANGED');
  return rows[0];
}

async function recheck(orgId, budget, deps) {
  const data = budget.data;
  const fresh = await prepareMissionBudget(orgId, { mission_id: budget.office_mission_id, programme_id: data.programme_id, currency: data.currency, template_file_id: data.template_file_id, destination_parent_id: data.destination_parent_id, tasks: data.tasks.map(t => ({ phase_index: t.phase_index, task_index: t.task_index, allocations: t.allocations.map(a => ({ ...a, hourly_rate: data.team.find(m => m.assignment_id === a.assignment_id).hourly_rate, rate_source: data.team.find(m => m.assignment_id === a.assignment_id).rate_source })) })) }, deps);
  if (fresh.content_hash !== budget.content_hash) fail('BUDGET_SOURCE_CHANGED');
  if (fresh.missing_rates.length) fail('CONFIRMED_RATES_REQUIRED');
}

export async function missionBudgetAction(orgId, body, deps = {}) {
  if (!body || typeof body !== "object") fail("INVALID_BUDGET_INPUT", 400);
  const fetchRows = deps.fetchRows || rest;
  if (body.action === 'prepare') {
    const draft = await prepareMissionBudget(orgId, body, deps);
    const rows = await fetchRows('office_mission_budget_versions?on_conflict=org_id,office_mission_id,content_hash', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([{ org_id: orgId, office_mission_id: body.mission_id, data: draft.data, content_hash: draft.content_hash }]) });
    const existing = rows[0] || (await fetchRows('office_mission_budget_versions?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(body.mission_id) + '&content_hash=eq.' + draft.content_hash + '&select=id&limit=1'))[0];
    if (!existing) fail('BUDGET_SAVE_FAILED');
    return { ...draft, budget_id: existing.id, written_to_drive: false };
  }
  const budget = await loadBudget(orgId, body.budget_id, fetchRows);
  if (body.content_hash !== budget.content_hash) fail('BUDGET_REVIEW_CHANGED');
  if (body.action !== 'reject') await recheck(orgId, budget, deps);
  if (body.action === 'approve' || body.action === 'reject') {
    await fetchRows('office_mission_budget_decisions', { method: 'POST', body: JSON.stringify([{ org_id: orgId, budget_id: budget.id, content_hash: budget.content_hash, decision: body.action }]) });
    return { budget_id: budget.id, decision: body.action, written_to_drive: false };
  }
  if (!['download','publish'].includes(body.action)) fail('UNKNOWN_BUDGET_ACTION', 400);
  const decisions = await fetchRows('office_mission_budget_decisions?org_id=eq.' + q(orgId) + '&budget_id=eq.' + q(budget.id) + '&select=decision,content_hash&order=sequence.desc&limit=1');
  if (decisions[0]?.decision !== 'approve' || decisions[0].content_hash !== budget.content_hash) fail('BUDGET_APPROVAL_REQUIRED');
  const buffer = await buildMissionBudgetWorkbook(budget.data);
  if (body.action === 'publish') {
    const gate = await (deps.mappingGate || mappingGate)();
    if (!gate.allowed) fail('MAPPING_REVIEW_REQUIRED');
    const meta = await (deps.getMeta || getDriveFileMetadata)(budget.data.destination_parent_id);
    if (meta.mimeType !== 'application/vnd.google-apps.folder' || meta.driveId !== (deps.driveId || configuredDriveId())) fail('OUTSIDE_FIRM_DRIVE');
    await recheck(orgId, budget, deps);
    const file = await (deps.createFile || createMissionBudgetFile)({ org_id: orgId, budget_id: budget.id, content_hash: budget.content_hash, buffer });
    return { budget_id: budget.id, file_id: file.id, filename: file.name, parent_id: budget.data.destination_parent_id, written_to_drive: true };
  }
  return { budget_id: budget.id, filename: 'MISSION_BUDGET_' + budget.id + '.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: buffer.toString('base64'), written_to_drive: false };
}

// A blank technical derivative of the example: no example client, personnel,
// hours, actuals or rates are copied into the mission. Inputs come from the reviewed snapshot.
export async function buildMissionBudgetWorkbook(data) {
  const book = new ExcelJS.Workbook();
  book.calcProperties.fullCalcOnLoad = true;
  const info = book.addWorksheet('Mission');
  info.addRows([['Budget de mission', data.mission.name], ['Devise', data.currency], ['Plan validé', data.plan_id], ['Empreinte plan', data.plan_hash], ['Programme', data.programme_id], ['Empreinte programme', data.programme_hash], ['Modèle de référence', data.template_file_id], ['Statut', 'Budget validé — heures réelles à renseigner']]);
  const team = book.addWorksheet('Équipe');
  team.addRow(['Affectation', 'Collaborateur', 'Rôle', 'Taux horaire', 'Source du taux']);
  data.team.forEach(m => team.addRow([m.assignment_id, m.name, m.role, m.hourly_rate, m.rate_source]));
  const plan = book.addWorksheet('Plan de travail');
  plan.addRow(['Phase', 'Tâche', 'Procédure', 'Échéance']);
  data.tasks.forEach(t => plan.addRow([t.phase_index + 1, t.title, t.procedure, t.due_on]));
  const detail = book.addWorksheet('Budget Audit');
  detail.addRow(['Phase', 'Tâche', 'Collaborateur', 'Rôle', 'Heures budgétées', 'Taux horaire', 'Budget', 'Heures réelles', 'Écart heures', 'Valeur réelle']);
  for (const t of data.tasks) for (const a of t.allocations) {
    const index = data.team.findIndex(m => m.assignment_id === a.assignment_id), m = data.team[index], r = detail.rowCount + 1;
    detail.addRow([t.phase_index + 1, t.title, m.name, m.role, a.hours,
      { formula: "'Équipe'!D" + (index + 2), result: m.hourly_rate },
      { formula: `E${r}*F${r}`, result: a.hours * m.hourly_rate }, null,
      { formula: `IF(H${r}="","",H${r}-E${r})` }, { formula: `IF(H${r}="","",H${r}*F${r})` }]);
  }
  const last = detail.rowCount, r = last + 1;
  detail.addRow(['TOTAL', '', '', '', { formula: `SUM(E2:E${last})`, result: data.tasks.reduce((s,t) => s + t.allocations.reduce((n,a) => n + a.hours, 0), 0) }, '', { formula: `SUM(G2:G${last})`, result: data.tasks.reduce((s,t) => s + t.allocations.reduce((n,a) => n + a.hours * data.team.find(m => m.assignment_id === a.assignment_id).hourly_rate, 0), 0) }, { formula: `IF(COUNT(H2:H${last})=0,"",SUM(H2:H${last}))` }, { formula: `IF(COUNT(H2:H${last})<>${last - 1},"",SUM(I2:I${last}))` }, { formula: `IF(COUNT(H2:H${last})<>${last - 1},"",SUM(J2:J${last}))` }]);
  detail.getRow(r).font = { bold: true };
  for (const sheet of book.worksheets) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } };
    sheet.columns.forEach(column => { column.width = 24; });
  }
  detail.getColumn(2).width = 42;
  for (const c of [5,6,7,8,9,10]) detail.getColumn(c).numFmt = '#,##0.00';
  return Buffer.from(await book.xlsx.writeBuffer());
}
