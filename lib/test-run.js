import { rest } from './supabase.js';
import { configuredDriveId, directGoogleAccess } from './google-drive.js';
import { mailSandbox } from './agent-mail.js';
import { fireInternal } from './agent-passes.js';
import { newCopyState, copyStep, summary, googleDriveApi } from './drive-copy.js';
import { MISSIONS, ROLES, PEOPLE, ROLE_LABELS, weekDate, letterText, programmeText, clientSheetText, checkEmails } from './test-run-scenario.js';

// Test of the whole application on a COPY of the firm (test run "TATY TEST", 2026-10-07).
// Works only in a Vercel preview whose DEFAULT_ORG_ID is a separate test firm and whose
// TATY_SHARED_DRIVE_ID is the test Shared Drive; the real firm is never touched:
//   - the real Drive (TEST_SOURCE_DRIVE_ID) is only READ, to copy it;
//   - the bridge and the scan worker (bound to the real Drive) are forbidden in preview;
//   - e-mails can only reach Paul's mailboxes (AGENT_MAIL_SANDBOX_*).
// Steps: 1. copy the Drive  2. create the test firm, its team and the 5 missions  3. agents run.

const q = v => encodeURIComponent(v);
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const nowIso = () => new Date().toISOString();
const listFrom = v => String(v || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);

export function testEnvironment(orgId, env = process.env) {
  const preview = env.VERCEL_ENV === 'preview' || String(env.OFFICE_MANAGER_TEST_RUN || '').toLowerCase() === 'on';
  const source = env.TEST_SOURCE_DRIVE_ID || '';
  const target = env.TATY_SHARED_DRIVE_ID || '';
  const problems = [];
  if (!preview) problems.push('NOT_A_PREVIEW');
  if (!orgId) problems.push('DEFAULT_ORG_ID_MISSING');
  if (listFrom(env.TEST_RUN_FORBIDDEN_ORG_IDS).includes(orgId)) problems.push('REAL_FIRM_ORG_ID');
  if (!source) problems.push('TEST_SOURCE_DRIVE_ID_MISSING');
  if (!target) problems.push('TATY_SHARED_DRIVE_ID_MISSING');
  if (source && target && source === target) problems.push('TEST_DRIVE_IS_THE_REAL_DRIVE');
  if (!directGoogleAccess()) problems.push('GOOGLE_SERVICE_ACCOUNT_JSON_MISSING');
  if (!mailSandbox(env)?.all.size) problems.push('MAIL_SANDBOX_EMPTY');
  if (String(env.OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY || '').toLowerCase() === 'true') problems.push('REQUIRE_EXISTING_MEMORY_MUST_BE_FALSE_IN_PREVIEW');
  return { ok: problems.length === 0, problems, source, target };
}

function assertTestEnvironment(orgId, env) {
  const t = testEnvironment(orgId, env);
  if (!t.ok) throw fail('TEST_ENVIRONMENT_NOT_READY', 409, { problems: t.problems });
  return t;
}

function defaults(d = {}) {
  return { fetchRows: d.fetchRows || rest, api: d.api || googleDriveApi(), fire: d.fire || fireInternal, env: d.env || process.env };
}

async function load(orgId, fetchRows) {
  return (await fetchRows('office_test_runs?org_id=eq.' + q(orgId) + '&select=*&limit=1'))?.[0] || null;
}
async function save(orgId, fields, fetchRows) {
  await fetchRows('office_test_runs?on_conflict=org_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: orgId, ...fields, updated_at: nowIso() }])
  });
}

export async function getTestRun(orgId, d = {}) {
  const x = defaults(d);
  const env = testEnvironment(orgId, x.env);
  const run = await load(orgId, x.fetchRows);
  const box = mailSandbox(x.env);
  return {
    environment: env, status: run?.status || 'new',
    copy: run?.copy_state?.source ? { ...summary(run.copy_state), failed_items: (run.copy_state.failed || []).slice(0, 30), skipped_items: (run.copy_state.skipped || []).slice(0, 30) } : null,
    config: run?.config || {}, seed: run?.seed_result || {}, last_error: run?.last_error || null,
    sandbox: box ? { colleagues: box.colleagues, clients: box.clients } : null,
    missions: MISSIONS.map(m => ({ code: m.code, client: m.client, type: m.type, weeks: [m.start + 1, m.end + 1], roles: m.roles.map(r => ROLE_LABELS[r]) })),
    roles: [...ROLES, 'cfo'].map(r => ({ key: r, label: ROLE_LABELS[r], person: PEOPLE[r] || 'joué par Paul' }))
  };
}

// ---------- 1. copy ----------

export async function startCopy(orgId, req, d = {}) {
  const x = defaults(d);
  const t = assertTestEnvironment(orgId, x.env);
  const run = await load(orgId, x.fetchRows);
  if (run?.copy_state?.source && !run.copy_state.done) throw fail('COPY_ALREADY_RUNNING', 409);
  if (run?.copy_state?.done) throw fail('COPY_ALREADY_DONE', 409);
  await x.api.drive(t.target); // the test Shared Drive must be reachable by the service account
  const state = newCopyState(t.source, t.target);
  await save(orgId, { status: 'copying', copy_state: state, last_error: null, updated_by: who(req) }, x.fetchRows);
  if (req) await x.fire(req, '/api/app?route=test-run-step', {});
  return { started: true };
}

export async function copyTick(orgId, req, d = {}) {
  const x = defaults(d);
  assertTestEnvironment(orgId, x.env);
  const run = await load(orgId, x.fetchRows);
  if (!run?.copy_state?.source || run.copy_state.done) return { idle: true };
  const state = run.copy_state;
  try {
    const r = await copyStep(state, { api: x.api, save: s => save(orgId, { copy_state: s }, x.fetchRows), budgetMs: d.budgetMs || 40000 });
    if (r.done) await save(orgId, { status: 'copied' }, x.fetchRows);
    else if (req) await x.fire(req, '/api/app?route=test-run-step', {});
    return r;
  } catch (e) {
    await save(orgId, { last_error: String(e.message || e).slice(0, 900) }, x.fetchRows);
    throw e;
  }
}

// ---------- 2. test firm, team and the 5 missions ----------

async function childByName(api, parentId, name) {
  return (await api.children(parentId)).find(f => f.name === name) || null;
}
async function folderPath(api, rootId, names) {
  let id = rootId;
  for (const n of names) { const f = await childByName(api, id, n); if (!f) return null; id = f.id; }
  return id;
}
async function ensureFolder(api, parentId, name) {
  return (await childByName(api, parentId, name)) || api.createFolder(parentId, name);
}

export async function seed(orgId, req, d = {}) {
  const x = defaults(d);
  const t = assertTestEnvironment(orgId, x.env);
  const run = await load(orgId, x.fetchRows);
  if (run?.status !== 'copied' && run?.status !== 'seeded') throw fail('COPY_NOT_FINISHED', 409);
  const body = req.body || {};
  const emails = Object.fromEntries([...ROLES, 'cfo'].map(r => [r, String(body.emails?.[r] || '').trim().toLowerCase()]));
  const check = checkEmails(emails, mailSandbox(x.env));
  if (!check.ok) throw fail(check.error, 400, check);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(body.start_date || '') ? body.start_date : nowIso().slice(0, 10);
  const by = who(req);
  const P = (path, rows, prefer = 'return=representation') => x.fetchRows(path, { method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(rows) });

  // The firm (a separate organisation, never the real one).
  const org = (await x.fetchRows('office_organizations?id=eq.' + q(orgId) + '&select=id,name&limit=1'))?.[0];
  if (org && !/TEST/i.test(org.name)) throw fail('ORG_IS_NOT_A_TEST_FIRM', 409);
  if (!org) await P('office_organizations', [{ id: orgId, slug: 'taty-test-' + orgId.slice(0, 8), name: 'TATY & Associés — TEST (copie)', timezone: 'Africa/Abidjan', account_kind: 'test' }], 'return=minimal');
  await P('office_org_branding?on_conflict=org_id', [{ org_id: orgId, firm_name: 'TATY TEST', primary_color: '#8A4B08', updated_by: by }], 'resolution=merge-duplicates,return=minimal');
  await P('office_agent_persona?on_conflict=org_id', [{ org_id: orgId, agent_display_name: 'Office Manager TATY (TEST)', sender_email: x.env.TEST_AGENT_SENDER || 'paulkomenan@taty.info',
    internal_domains: ['taty.info'], internal_tone: 'nouchi_fun', humor_level: 2, internal_frequency: 'few_per_week', signature: 'Ton collègue Office Manager (test) 😉', updated_by: by }], 'resolution=merge-duplicates,return=minimal');
  await P('office_agent_schedule?on_conflict=org_id', [{ org_id: orgId, enabled: true, timezone: 'Africa/Abidjan', controller_times: ['09:00', '16:00'], sika_weekday: 5, sika_time: '09:00', updated_by: by }], 'resolution=merge-duplicates,return=minimal');

  // The team: fictitious names, Paul's mailboxes.
  const existingStaff = await x.fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&select=id,full_name&limit=50') || [];
  const staff = {};
  for (const r of ROLES) {
    const found = existingStaff.find(s => s.full_name === PEOPLE[r]);
    staff[r] = found?.id || (await P('office_staff_profiles', [{ org_id: orgId, full_name: PEOPLE[r], email: emails[r], role_title: ROLE_LABELS[r], weekly_capacity_hours: 40, active: true, can_receive_internal_reminders: true }]))[0].id;
  }

  // The missions: folders copied from the firm's template, letter, validated programme, client sheet.
  const clients = await folderPath(x.api, t.target, ['01_CLIENTS_ET_MISSIONS']);
  if (!clients) throw fail('COPIED_DRIVE_STRUCTURE_NOT_FOUND', 409);
  const existingMissions = await x.fetchRows('office_missions?org_id=eq.' + q(orgId) + '&select=id,mission_code&limit=50') || [];
  const result = [];
  for (const m of MISSIONS) {
    const yearFolder = await ensureFolder(x.api, (await ensureFolder(x.api, clients, m.area)).id, '2026');
    const modelName = m.area === '01_AUDIT' ? '00_MODELE_AUDIT_VALIDE_A_DUPLIQUER' : '00_MODELE_CLIENT_A_DUPLIQUER';
    const model = await childByName(x.api, yearFolder.id, modelName);
    const folderName = m.code + '_' + m.client.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/_+$/, '').toUpperCase();
    let folder = await childByName(x.api, yearFolder.id, folderName);
    if (!folder) {
      folder = await x.api.createFolder(yearFolder.id, folderName);
      for (const sub of (model ? await x.api.children(model.id) : []).filter(f => f.mimeType === 'application/vnd.google-apps.folder')) {
        await x.api.createFolder(folder.id, sub.name.replace(/ \(\d+\)$/, ''));
      }
    }
    const subs = await x.api.children(folder.id);
    const sub = prefix => subs.find(f => f.name.startsWith(prefix)) || folder;
    const plan = await ensureFolder(x.api, sub('03_PLANIFICATION').id, '01_WORD_PLANIFICATION_VALIDE');
    const docs = [[sub('01_ADMINISTRATION').id, m.code + '_LETTRE_DE_MISSION_SIGNEE', letterText(m, emails, start)],
      [plan.id, m.code + '_PROGRAMME_TRAVAIL_GENERAL_VALIDE', programmeText(m, emails, start)],
      [sub('02_DOSSIER_PERMANENT').id, m.code + '_FICHE_CLIENT', clientSheetText(m, emails)]];
    for (const [parent, name, text] of docs) if (!await childByName(x.api, parent, name)) await x.api.createDoc(parent, name, text);

    let missionId = existingMissions.find(e => e.mission_code === m.code)?.id;
    if (!missionId) {
      missionId = (await P('office_missions', [{ org_id: orgId, mission_code: m.code, name: m.type + ' ' + m.exercise + ' — ' + m.client,
        planned_start: weekDate(start, m.start), planned_end: weekDate(start, m.end), status: 'active' }]))[0].id;
      await P('office_mission_assignments', m.roles.map(r => ({ org_id: orgId, office_mission_id: missionId, staff_profile_id: staff[r], mission_role: ROLE_LABELS[r],
        cycle_codes: m.cycles, planned_start: weekDate(start, m.start), planned_end: weekDate(start, m.end), allocation_pct: r === 'associe' ? 10 : r === 'manager' ? 30 : 60, status: 'planned' })), 'return=minimal');
      await P('office_mission_people_requirements', [{ org_id: orgId, office_mission_id: missionId,
        mission_context: m.type + ' — ' + m.client + ' — exercice ' + m.exercise + '. Test accéléré : 1 semaine = 1 jour. CFO : ' + emails.cfo + '.' }], 'return=minimal').catch(() => null);
    }
    result.push({ code: m.code, mission_id: missionId, folder_id: folder.id, start: weekDate(start, m.start), end: weekDate(start, m.end) });
  }
  const seedResult = { start_date: start, end_date: weekDate(start, 12), missions: result, at: nowIso() };
  await save(orgId, { status: 'seeded', config: { emails, start_date: start }, seed_result: seedResult, last_error: null, updated_by: by }, x.fetchRows);
  return seedResult;
}

const who = req => String(req?.account?.display_name || req?.account?.email || req?.body?.by || '').slice(0, 120) || null;
