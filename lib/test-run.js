import { rest } from './supabase.js';
import { directGoogleAccess, getDriveFileMetadata } from './google-drive.js';
import { mailSandbox } from './agent-mail.js';
import { fireInternal } from './agent-passes.js';
import { isTestMode, forbiddenOrgIds } from './test-mode.js';
import { newCopyState, copyStep, summary, googleDriveApi } from './drive-copy.js';
import { MISSIONS, ROLES, PEOPLE, ROLE_LABELS, weekDate, letterText, programmeText, clientSheetText, checkEmails } from './test-run-scenario.js';

// Test of the whole application on a COPY of the firm (test run "TATY TEST", 2026-10-07,
// hardened after an independent review). Works only in test mode (Vercel preview) with:
//   - DEFAULT_ORG_ID = a separate test firm, the real firm declared in TEST_RUN_FORBIDDEN_ORG_IDS;
//   - TATY_SHARED_DRIVE_ID = the test Shared Drive (empty at start, name containing "TEST"),
//     TEST_SOURCE_DRIVE_ID = the real Drive, only READ to copy it;
//   - every Drive ID the agents use pointing to the COPY (checked here, and every write is
//     also refused outside the test Drive by lib/google-drive.js);
//   - e-mails only to Paul's mailboxes (AGENT_MAIL_SANDBOX_*), PBC label containing "TEST".
// Steps: 1. copy the Drive  2. create the test firm, its team and the 5 missions  3. agents run.

const q = v => encodeURIComponent(v);
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const nowIso = () => new Date().toISOString();
const LEASE_MS = 90000;

// Drive IDs read from the environment by the agents. The three legacy ones fall back to
// REAL firm files when not set: in test mode they must be set to their copies.
export const DRIVE_ID_SETTINGS = [
  { key: 'TATY_MASTER_SHEET_ID', label: 'Fichier maître (planning, capacité, missions)', envs: ['TATY_MASTER_SHEET_ID'], legacy: '1UBKNbaYWI9MkkXR5NF1XDHGSmExOKIB_QeLUryxa-rc', required: true },
  { key: 'PBC_MASTER_FILE_ID', label: 'Liste PBC de référence', envs: ['PBC_MASTER_FILE_ID', 'TATY_PBC_MASTER_FILE_ID'], legacy: '1Pg8txPcg_91XzwKXMYBRib-nr3tfP4-aeZwMAzCauBs', required: true },
  { key: 'MISSION_CONTROL_REGISTRY_ID', label: 'Registre Mission Control', envs: ['MISSION_CONTROL_REGISTRY_ID', 'TATY_MISSION_CONTROL_REGISTRY_ID'], legacy: '1e-SikU0wzkVoAzI64LyiWJydo8rM3AQ0C0nKmOOWGQQ', required: true },
  { key: 'OFFICE_MANAGER_MEMORY_FOLDER_ID', label: 'Dossier de la mémoire de l’Orpailleur', envs: ['OFFICE_MANAGER_MEMORY_FOLDER_ID'] },
  { key: 'OFFICE_MANAGER_SCAN_ROOT_ID', label: 'Racine de parcours du Drive', envs: ['OFFICE_MANAGER_SCAN_ROOT_ID'] },
  { key: 'WP_TEMPLATE_LIBRARY_FOLDER_ID', label: 'Bibliothèque des modèles de feuilles de travail', envs: ['WP_TEMPLATE_LIBRARY_FOLDER_ID'] },
  { key: 'PBC_INBOX_FOLDER_ID', label: 'Dossier de dépôt des pièces reçues par e-mail', envs: ['PBC_INBOX_FOLDER_ID'] }
];

export function testEnvironment(orgId, env = process.env) {
  const source = env.TEST_SOURCE_DRIVE_ID || '';
  const target = env.TATY_SHARED_DRIVE_ID || '';
  const problems = [];
  if (!isTestMode(env)) problems.push('NOT_A_PREVIEW');
  if (!orgId) problems.push('DEFAULT_ORG_ID_MISSING');
  if (!forbiddenOrgIds(env).length) problems.push('REAL_FIRM_ORG_NOT_DECLARED');
  else if (forbiddenOrgIds(env).includes(orgId)) problems.push('REAL_FIRM_ORG_ID');
  if (!source) problems.push('TEST_SOURCE_DRIVE_ID_MISSING');
  if (!target) problems.push('TATY_SHARED_DRIVE_ID_MISSING');
  if (source && target && source === target) problems.push('TEST_DRIVE_IS_THE_REAL_DRIVE');
  if (!directGoogleAccess()) problems.push('GOOGLE_SERVICE_ACCOUNT_JSON_MISSING');
  if (!mailSandbox(env)?.all.size) problems.push('MAIL_SANDBOX_EMPTY');
  if (env.AGENT_MAIL_INBOX_LABEL && !/TEST/i.test(env.AGENT_MAIL_INBOX_LABEL)) problems.push('INBOX_LABEL_NOT_A_TEST_LABEL');
  if (String(env.OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY || '').toLowerCase() === 'true') problems.push('REQUIRE_EXISTING_MEMORY_MUST_BE_FALSE_IN_PREVIEW');
  return { ok: problems.length === 0, problems, source, target };
}

// Every Drive ID the agents read must be in the test Drive. Suggests the copy's ID.
export async function checkDriveIds(env = process.env, { meta = getDriveFileMetadata, map = {} } = {}) {
  const target = env.TATY_SHARED_DRIVE_ID || '';
  const out = [];
  for (const s of DRIVE_ID_SETTINGS) {
    const set = s.envs.map(e => env[e]).find(Boolean) || '';
    const effective = set || s.legacy || '';
    const copyId = (effective && map[effective] && !['SKIPPED', 'FAILED'].includes(map[effective])) ? map[effective] : null;
    if (!effective) { out.push({ key: s.key, label: s.label, ok: true, state: 'non utilisé' }); continue; }
    let driveId = null;
    try { driveId = (await meta(effective))?.driveId || null; } catch { driveId = null; }
    const ok = Boolean(target) && driveId === target;
    out.push({ key: s.key, label: s.label, ok, state: ok ? 'copie ✓' : (set ? 'pointe hors du Drive de test' : 'non réglé : utiliserait le fichier réel'),
      env_to_set: s.envs[0], suggested_copy_id: ok ? null : copyId });
  }
  return out;
}

async function assertReady(orgId, x, { ids = false, map = {} } = {}) {
  const t = testEnvironment(orgId, x.env);
  if (!t.ok) throw fail('TEST_ENVIRONMENT_NOT_READY', 409, { problems: t.problems });
  if (ids) {
    const bad = (await checkDriveIds(x.env, { meta: x.meta, map })).filter(c => !c.ok);
    if (bad.length) throw fail('TEST_DRIVE_IDS_NOT_ON_COPY', 409, { settings: bad });
  }
  return t;
}

function defaults(d = {}) {
  return { fetchRows: d.fetchRows || rest, api: d.api || googleDriveApi(), fire: d.fire || fireInternal, env: d.env || process.env,
    meta: d.meta || getDriveFileMetadata, now: d.now || (() => Date.now()) };
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
  const map = run?.copy_state?.map || {};
  const ids = env.ok ? await checkDriveIds(x.env, { meta: x.meta, map }) : [];
  return {
    environment: env, drive_ids: ids, status: run?.status || 'new',
    copy: run?.copy_state?.source ? { ...summary(run.copy_state), failed_items: (run.copy_state.failed || []).slice(0, 30), skipped_items: (run.copy_state.skipped || []).slice(0, 30),
      busy: Boolean(run.copy_state.lease_until && Date.parse(run.copy_state.lease_until) > x.now()) } : null,
    config: run?.config || {}, seed: run?.seed_result || {}, last_error: run?.last_error || null,
    sandbox: box ? { colleagues: box.colleagues, clients: box.clients } : null,
    missions: MISSIONS.map(m => ({ code: m.code, client: m.client, type: m.type, weeks: [m.start + 1, m.end + 1], roles: m.roles.map(r => ROLE_LABELS[r]) })),
    roles: [...ROLES, 'cfo'].map(r => ({ key: r, label: ROLE_LABELS[r], person: PEOPLE[r] || 'joué par Paul' })),
    limits: ['Le rangement automatique s’appuie sur l’inventaire du scanner Supabase, qui ne parcourt que le vrai Drive : dans le test, l’Orpailleur cartographie la copie par parcours direct, mais le Rangement n’a pas d’inventaire.']
  };
}

// ---------- 1. copy ----------

export async function startCopy(orgId, req, d = {}) {
  const x = defaults(d);
  const t = await assertReady(orgId, x);
  const run = await load(orgId, x.fetchRows);
  if (run?.copy_state?.done) throw fail('COPY_ALREADY_DONE', 409);
  if (run?.copy_state?.source) { // already started: resume (the "Reprendre" button)
    if (req) await x.fire(req, '/api/app?route=test-run-step', {});
    return { resumed: true };
  }
  const drive = await x.api.drive(t.target);
  if (!/TEST/i.test(drive?.name || '')) throw fail('TEST_DRIVE_NAME_MUST_CONTAIN_TEST', 409, { name: drive?.name || null });
  if ((await x.api.children(t.target)).length) throw fail('TEST_DRIVE_NOT_EMPTY', 409);
  const state = newCopyState(t.source, t.target);
  await save(orgId, { status: 'copying', copy_state: state, last_error: null, updated_by: who(req) }, x.fetchRows);
  if (req) await x.fire(req, '/api/app?route=test-run-step', {});
  return { started: true };
}

// One chunk of the copy, under a lease: two runs never work on the copy at the same time.
export async function copyTick(orgId, req, d = {}) {
  const x = defaults(d);
  await assertReady(orgId, x);
  const run = await load(orgId, x.fetchRows);
  if (!run?.copy_state?.source || run.copy_state.done) return { idle: true };
  if (run.copy_state.lease_until && Date.parse(run.copy_state.lease_until) > x.now()) return { busy: true };
  const lease = Math.random().toString(36).slice(2);
  const state = { ...run.copy_state, lease_id: lease, lease_until: new Date(x.now() + LEASE_MS).toISOString() };
  const claimed = await x.fetchRows('office_test_runs?org_id=eq.' + q(orgId) + '&updated_at=eq.' + q(run.updated_at), {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ copy_state: state, updated_at: nowIso() })
  });
  if (!claimed?.length) return { busy: true };
  try {
    const r = await copyStep(state, { api: x.api, save: s => save(orgId, { copy_state: s }, x.fetchRows), budgetMs: d.budgetMs || 25000 });
    state.lease_until = null; state.lease_id = null;
    await save(orgId, { copy_state: state, ...(r.done ? { status: 'copied' } : {}) }, x.fetchRows);
    if (!r.done && req) await x.fire(req, '/api/app?route=test-run-step', {});
    return r;
  } catch (e) {
    state.lease_until = null; state.lease_id = null;
    await save(orgId, { copy_state: state, last_error: String(e.message || e).slice(0, 900) }, x.fetchRows);
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

// The test firm gets the same AI permissions and agent settings as the real firm
// (read from the real firm, written for the test firm only).
async function cloneConfig(table, fromOrg, toOrg, fetchRows) {
  const mine = await fetchRows(table + '?org_id=eq.' + q(toOrg) + '&select=org_id&limit=1') || [];
  if (mine.length) return 0;
  const rows = await fetchRows(table + '?org_id=eq.' + q(fromOrg) + '&select=*&limit=50') || [];
  if (!rows.length) return 0;
  const copies = rows.map(r => { const c = { ...r, org_id: toOrg }; delete c.id; delete c.created_at; delete c.updated_at; return c; });
  await fetchRows(table, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(copies) });
  return copies.length;
}

export async function seed(orgId, req, d = {}) {
  const x = defaults(d);
  const run = await load(orgId, x.fetchRows);
  if (run?.status !== 'copied' && run?.status !== 'seeded') throw fail('COPY_NOT_FINISHED', 409);
  const t = await assertReady(orgId, x, { ids: true, map: run.copy_state?.map || {} });
  const body = req.body || {};
  const emails = Object.fromEntries([...ROLES, 'cfo'].map(r => [r, String(body.emails?.[r] || '').trim().toLowerCase()]));
  const check = checkEmails(emails, mailSandbox(x.env));
  if (!check.ok) throw fail(check.error, 400, check);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(body.start_date || '') ? body.start_date : nowIso().slice(0, 10);
  const by = who(req);
  const P = (path, rows, prefer = 'return=representation') => x.fetchRows(path, { method: 'POST', headers: { Prefer: prefer }, body: JSON.stringify(rows) });
  const PATCH = (path, fields) => x.fetchRows(path, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fields) });

  // The firm (a separate organisation, never the real one).
  const org = (await x.fetchRows('office_organizations?id=eq.' + q(orgId) + '&select=id,name&limit=1'))?.[0];
  if (org && !/TEST/i.test(org.name)) throw fail('ORG_IS_NOT_A_TEST_FIRM', 409);
  if (!org) await P('office_organizations', [{ id: orgId, slug: 'taty-test-' + orgId.slice(0, 8), name: 'TATY & Associés — TEST (copie)', timezone: 'Africa/Abidjan', account_kind: 'test' }], 'return=minimal');
  const realOrg = forbiddenOrgIds(x.env)[0];
  const cloned = {};
  for (const table of ['office_processing_permissions', 'office_agent_settings']) {
    try { cloned[table] = await cloneConfig(table, realOrg, orgId, x.fetchRows); } catch (e) { cloned[table] = 'échec : ' + String(e.message || e).slice(0, 120); }
  }
  await P('office_org_branding?on_conflict=org_id', [{ org_id: orgId, firm_name: 'TATY TEST', primary_color: '#8A4B08', updated_by: by }], 'resolution=merge-duplicates,return=minimal');
  await P('office_agent_persona?on_conflict=org_id', [{ org_id: orgId, agent_display_name: 'Office Manager TATY (TEST)', sender_email: x.env.TEST_AGENT_SENDER || 'paulkomenan@taty.info',
    internal_domains: ['taty.info'], internal_tone: 'nouchi_fun', humor_level: 2, internal_frequency: 'few_per_week', signature: 'Ton collègue Office Manager (test) 😉', updated_by: by }], 'resolution=merge-duplicates,return=minimal');
  // The schedule is created once (enabled); a later re-seed never re-enables a paused schedule.
  await P('office_agent_schedule?on_conflict=org_id', [{ org_id: orgId, enabled: true, timezone: 'Africa/Abidjan', controller_times: ['09:00', '16:00'], sika_weekday: 5, sika_time: '09:00', updated_by: by }], 'resolution=ignore-duplicates,return=minimal');

  // The team: fictitious names, Paul's mailboxes (e-mails updated on a re-seed).
  const existingStaff = await x.fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&select=id,full_name,email&limit=50') || [];
  const staff = {};
  for (const r of ROLES) {
    const found = existingStaff.find(s => s.full_name === PEOPLE[r]);
    if (found) {
      staff[r] = found.id;
      if (found.email !== emails[r]) await PATCH('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=eq.' + q(found.id), { email: emails[r] });
    } else {
      staff[r] = (await P('office_staff_profiles', [{ org_id: orgId, full_name: PEOPLE[r], email: emails[r], role_title: ROLE_LABELS[r], weekly_capacity_hours: 40, active: true, can_receive_internal_reminders: true }]))[0].id;
    }
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
    if (!folder) folder = await x.api.createFolder(yearFolder.id, folderName);
    // Sub-folders of the firm template (re-run safe: only the missing ones are created).
    const have = new Set((await x.api.children(folder.id)).map(f => f.name));
    for (const sub of (model ? await x.api.children(model.id) : []).filter(f => f.mimeType === 'application/vnd.google-apps.folder')) {
      const name = sub.name.replace(/ \(\d+\)$/, '');
      if (!have.has(name)) { await x.api.createFolder(folder.id, name); have.add(name); }
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
    }
    // Assignments: the missing ones only (a failed earlier run is completed, never duplicated).
    const assigned = new Set((await x.fetchRows('office_mission_assignments?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(missionId) + '&select=staff_profile_id&limit=50') || []).map(a => a.staff_profile_id));
    const missing = m.roles.filter(r => !assigned.has(staff[r]));
    if (missing.length) {
      await P('office_mission_assignments', missing.map(r => ({ org_id: orgId, office_mission_id: missionId, staff_profile_id: staff[r], mission_role: ROLE_LABELS[r],
        cycle_codes: m.cycles, planned_start: weekDate(start, m.start), planned_end: weekDate(start, m.end), allocation_pct: r === 'associe' ? 10 : r === 'manager' ? 30 : 60, status: 'planned' })), 'return=minimal');
    }
    const req0 = await x.fetchRows('office_mission_people_requirements?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(missionId) + '&select=office_mission_id&limit=1').catch(() => []);
    if (!req0?.length) {
      await P('office_mission_people_requirements', [{ org_id: orgId, office_mission_id: missionId,
        mission_context: m.type + ' — ' + m.client + ' — exercice ' + m.exercise + '. Test accéléré : 1 semaine = 1 jour. CFO : ' + emails.cfo + '.' }], 'return=minimal').catch(() => null);
    }
    result.push({ code: m.code, mission_id: missionId, folder_id: folder.id, start: weekDate(start, m.start), end: weekDate(start, m.end) });
  }
  const seedResult = { start_date: start, end_date: weekDate(start, 12), missions: result, config_cloned: cloned, at: nowIso() };
  await save(orgId, { status: 'seeded', config: { emails, start_date: start }, seed_result: seedResult, last_error: null, updated_by: by }, x.fetchRows);
  return seedResult;
}

const who = req => String(req?.account?.display_name || req?.account?.email || req?.body?.by || '').slice(0, 120) || null;
