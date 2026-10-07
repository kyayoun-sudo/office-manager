import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { testEnvironment, startCopy, copyTick, seed, getTestRun } from '../lib/test-run.js';
import { MISSIONS, programmeText, checkEmails, weekDate } from '../lib/test-run-scenario.js';
import { ROUTES } from '../api/app.js';

const FOLDER = 'application/vnd.google-apps.folder';
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
const SA = JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const EMAILS = { associe: 'p.associe@gmail.com', manager: 'p.manager@gmail.com', chef_mission: 'kpaulyann@yahoo.fr', assistant1: 'p.assist1@gmail.com', assistant2: 'p.assist1@gmail.com', cfo: 'p.cfo@gmail.com' };
const ENV = { VERCEL_ENV: 'preview', TEST_SOURCE_DRIVE_ID: 'REAL', TATY_SHARED_DRIVE_ID: 'TEST', TEST_RUN_FORBIDDEN_ORG_IDS: 'real-org',
  TATY_MASTER_SHEET_ID: 'COPY-MASTER', PBC_MASTER_FILE_ID: 'COPY-PBC', MISSION_CONTROL_REGISTRY_ID: 'COPY-REG',
  AGENT_MAIL_SANDBOX_COLLEAGUES: 'p.associe@gmail.com p.manager@gmail.com kpaulyann@yahoo.fr p.assist1@gmail.com', AGENT_MAIL_SANDBOX_CLIENTS: 'p.cfo@gmail.com' };

// Drive metadata: copies (and files created in the test) live in the test Drive.
const META = async id => ({ id, driveId: /^(COPY-|N)/.test(id) ? 'TEST' : 'REAL' });

function world() {
  let n = 0;
  const nodes = [
    { id: 'c', name: '01_CLIENTS_ET_MISSIONS', mimeType: FOLDER, parent: 'REAL' },
    { id: 'a', name: '01_AUDIT', mimeType: FOLDER, parent: 'c' }, { id: 'y', name: '2026', mimeType: FOLDER, parent: 'a' },
    { id: 'mo', name: '00_MODELE_AUDIT_VALIDE_A_DUPLIQUER', mimeType: FOLDER, parent: 'y' },
    ...['01_ADMINISTRATION_KYC_INDEPENDANCE', '02_DOSSIER_PERMANENT', '03_PLANIFICATION_AUDIT', '04_PBC_MASTER_ET_DOCUMENTS_CLIENT'].map((name, i) => ({ id: 'ms' + i, name, mimeType: FOLDER, parent: 'mo' })),
    { id: 'ble', name: 'BLE_TRANSIT_AUDIT_2025', mimeType: FOLDER, parent: 'c' }, { id: 'f', name: 'Releve.pdf', mimeType: 'application/pdf', parent: 'ble' },
    { id: 'map', name: 'OFFICE_MANAGER_MAP.xlsx', mimeType: 'x', parent: 'REAL' }
  ];
  const writes = [];
  const add = (parent, name, mimeType, text) => { const id = 'N' + (++n); nodes.push({ id, name, mimeType, parent, text }); writes.push({ parent, name }); return { id, name }; };
  const api = {
    drive: async id => { if (id !== 'TEST') throw new Error('GOOGLE_API_404'); return { id, name: 'TATY TEST' }; },
    children: async id => nodes.filter(x => x.parent === id).map(({ id, name, mimeType }) => ({ id, name, mimeType })),
    createFolder: async (p, name) => add(p, name, FOLDER),
    copyFile: async (fid, p, name) => add(p, name, nodes.find(x => x.id === fid).mimeType),
    createDoc: async (p, name, text) => add(p, name, 'application/vnd.google-apps.document', text)
  };
  const tables = { office_test_runs: [], office_organizations: [], office_org_branding: [], office_agent_persona: [], office_agent_schedule: [],
    office_staff_profiles: [], office_missions: [], office_mission_assignments: [], office_mission_people_requirements: [] };
  const fetchRows = async (path, o = {}) => {
    const [t, qs] = path.split('?'); const p = new URLSearchParams(qs || '');
    const eq = [...p].filter(([k, v]) => !['select', 'limit', 'on_conflict', 'order'].includes(k) && v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
    const match = r => eq.every(([k, v]) => String(r[k]) === v);
    if ((o.method || 'GET') === 'GET') return tables[t].filter(match);
    if (o.method === 'PATCH') { const rs = tables[t].filter(match); rs.forEach(r => Object.assign(r, JSON.parse(o.body))); return rs; }
    const rows = JSON.parse(o.body); const out = [];
    for (const row of rows) {
      const key = p.get('on_conflict');
      const old = key && tables[t].find(r => r[key] === row[key]);
      if (old) { Object.assign(old, row); out.push(old); } else { const r = { id: row.id || 'id' + (++n), ...row }; tables[t].push(r); out.push(r); }
    }
    return out;
  };
  return { api, fetchRows, tables, nodes, writes };
}

test('environment: refused outside a preview, on the real firm, on the real Drive, without the mail sandbox', () => {
  const saved = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; process.env.GOOGLE_SERVICE_ACCOUNT_JSON = SA;
  try {
    assert.equal(testEnvironment('test-org', ENV).ok, true);
    assert.ok(testEnvironment('test-org', { ...ENV, VERCEL_ENV: 'production' }).problems.includes('NOT_A_PREVIEW'));
    assert.ok(testEnvironment('real-org', ENV).problems.includes('REAL_FIRM_ORG_ID'));
    assert.ok(testEnvironment('test-org', { ...ENV, TATY_SHARED_DRIVE_ID: 'REAL' }).problems.includes('TEST_DRIVE_IS_THE_REAL_DRIVE'));
    assert.ok(testEnvironment('test-org', { ...ENV, AGENT_MAIL_SANDBOX_COLLEAGUES: '', AGENT_MAIL_SANDBOX_CLIENTS: '' }).problems.includes('MAIL_SANDBOX_EMPTY'));
    assert.ok(testEnvironment('test-org', { ...ENV, OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY: 'true' }).problems.includes('REQUIRE_EXISTING_MEMORY_MUST_BE_FALSE_IN_PREVIEW'));
  } finally { if (saved === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = saved; }
});

test('copy then seed: Drive copied, test firm + team + 5 missions created from the firm template, nothing written in the real Drive', async () => {
  const saved = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; process.env.GOOGLE_SERVICE_ACCOUNT_JSON = SA;
  try {
    const w = world();
    const d = { fetchRows: w.fetchRows, api: w.api, env: ENV, fire: async () => true, meta: META };
    await assert.rejects(seed('test-org', { body: { emails: EMAILS } }, d), /COPY_NOT_FINISHED/);
    await startCopy('test-org', { body: {} }, d);
    assert.deepEqual(await startCopy('test-org', { body: {} }, d), { resumed: true }, 'a second start resumes the copy');
    for (let i = 0; i < 5; i++) await copyTick('test-org', null, d);
    assert.equal(w.tables.office_test_runs[0].status, 'copied');
    assert.ok(!w.writes.some(x => x.name === 'OFFICE_MANAGER_MAP.xlsx'));

    await assert.rejects(seed('test-org', { body: { emails: { ...EMAILS, cfo: 'cfo@real-client.ci' } } }, d), /MAILBOX_NOT_IN_SANDBOX/);
    const r = await seed('test-org', { body: { emails: EMAILS, start_date: '2026-10-08' }, account: { display_name: 'Paul' } }, d);
    assert.equal(r.missions.length, 5);
    assert.equal(r.end_date, '2026-10-20', '13 weeks = 13 days');
    assert.equal(w.tables.office_organizations[0].name.includes('TEST'), true);
    assert.equal(w.tables.office_missions.length, 5);
    assert.equal(w.tables.office_staff_profiles.length, 5);
    assert.ok(w.tables.office_staff_profiles.every(s => Object.values(EMAILS).includes(s.email)), 'only Paul’s mailboxes');
    assert.equal(w.tables.office_mission_assignments.length, MISSIONS.reduce((a, m) => a + m.roles.length, 0));
    const cac = w.nodes.find(x => x.name.startsWith('TEST-CAC-ILS-2025_'));
    const sub = w.nodes.filter(x => x.parent === cac.id).map(x => x.name);
    assert.ok(sub.includes('03_PLANIFICATION_AUDIT') && sub.includes('04_PBC_MASTER_ET_DOCUMENTS_CLIENT'), 'structure of the firm template');
    const prog = w.nodes.find(x => x.name === 'TEST-CAC-ILS-2025_PROGRAMME_TRAVAIL_GENERAL_VALIDE');
    assert.match(prog.text, /PBC-03-02[\s\S]*responsable : Koffi/);
    assert.ok(w.writes.every(x => x.parent !== 'REAL' && !['c', 'a', 'y', 'mo', 'ble'].includes(x.parent)), 'never in the real Drive');
    // Seeding twice does not duplicate.
    await seed('test-org', { body: { emails: EMAILS, start_date: '2026-10-08' } }, d);
    assert.equal(w.tables.office_missions.length, 5);
    assert.equal(w.nodes.filter(x => x.name === 'TEST-CAC-ILS-2025_PROGRAMME_TRAVAIL_GENERAL_VALIDE').length, 1);
    const view = await getTestRun('test-org', d);
    assert.equal(view.status, 'seeded');
    assert.equal(view.missions.length, 5);
  } finally { if (saved === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = saved; }
});

test('a real firm (name without TEST) is never seeded; scenario and routes', async () => {
  const saved = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; process.env.GOOGLE_SERVICE_ACCOUNT_JSON = SA;
  try {
    const w = world();
    w.tables.office_organizations.push({ id: 'test-org', name: 'TATY & Associés' });
    w.tables.office_test_runs.push({ org_id: 'test-org', status: 'copied', copy_state: { done: true } });
    w.nodes.push({ id: 'cc', name: '01_CLIENTS_ET_MISSIONS', mimeType: FOLDER, parent: 'TEST' });
    await assert.rejects(seed('test-org', { body: { emails: EMAILS } }, { fetchRows: w.fetchRows, api: w.api, env: ENV, meta: META }), /ORG_IS_NOT_A_TEST_FIRM/);
  } finally { if (saved === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = saved; }
  assert.equal(new Set(MISSIONS.map(m => m.type)).size, 5, '5 different missions');
  assert.ok(MISSIONS.every(m => m.end <= 12), 'within 3 months');
  assert.equal(weekDate('2026-10-08', 7), '2026-10-15');
  assert.match(programmeText(MISSIONS[0], EMAILS, '2026-10-08'), /brouillon par l’agent et validée par le manager/);
  assert.equal(checkEmails({}, null).error, 'MAILBOX_MISSING');
  assert.ok(ROUTES['test-run'].GET.ownerOnly && ROUTES['test-run'].POST.ownerOnly);
});

test('review fixes: Drive IDs must point to the copy (copy ID suggested), real firm must be declared, PBC label is a test label, lease, target checks', async () => {
  const saved = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; process.env.GOOGLE_SERVICE_ACCOUNT_JSON = SA;
  try {
    assert.ok(testEnvironment('test-org', { ...ENV, TEST_RUN_FORBIDDEN_ORG_IDS: '' }).problems.includes('REAL_FIRM_ORG_NOT_DECLARED'));
    assert.ok(testEnvironment('test-org', { ...ENV, AGENT_MAIL_INBOX_LABEL: 'PBC' }).problems.includes('INBOX_LABEL_NOT_A_TEST_LABEL'));
    assert.equal(testEnvironment('test-org', { ...ENV, AGENT_MAIL_INBOX_LABEL: 'PBC-TEST' }).ok, true);
    assert.ok(testEnvironment('test-org', { ...ENV, VERCEL_ENV: 'production', OFFICE_MANAGER_TEST_RUN: 'on' }).problems.includes('NOT_A_PREVIEW'), 'production never in test mode');

    const w = world();
    const legacyEnv = { ...ENV, TATY_MASTER_SHEET_ID: '', PBC_MASTER_FILE_ID: '', MISSION_CONTROL_REGISTRY_ID: '' };
    const d = { fetchRows: w.fetchRows, api: w.api, env: legacyEnv, fire: async () => true, meta: META };
    await startCopy('test-org', { body: {} }, d);
    // A second tick while the first holds the lease does nothing.
    const run = w.tables.office_test_runs[0];
    run.copy_state = { ...run.copy_state, lease_until: new Date(Date.now() + 60000).toISOString() };
    assert.deepEqual(await copyTick('test-org', null, d), { busy: true });
    run.copy_state.lease_until = null;
    for (let i = 0; i < 5; i++) await copyTick('test-org', null, d);
    assert.equal(run.status, 'copied');
    assert.equal(run.copy_state.lease_until, null);
    await assert.rejects(seed('test-org', { body: { emails: EMAILS } }, d), e => {
      assert.equal(e.message, 'TEST_DRIVE_IDS_NOT_ON_COPY');
      assert.deepEqual(e.settings.map(s => s.key), ['TATY_MASTER_SHEET_ID', 'PBC_MASTER_FILE_ID', 'MISSION_CONTROL_REGISTRY_ID']);
      return true;
    });
    // An inherited folder ID pointing to the real Drive is refused too.
    await assert.rejects(seed('test-org', { body: { emails: EMAILS } }, { ...d, env: { ...ENV, OFFICE_MANAGER_MEMORY_FOLDER_ID: 'REAL-FOLDER' } }), /TEST_DRIVE_IDS_NOT_ON_COPY/);
    const view = await getTestRun('test-org', d);
    assert.equal(view.drive_ids.find(s => s.key === 'TATY_MASTER_SHEET_ID').ok, false);

    // Target checks: the test Drive must be empty and named TEST.
    const w2 = world();
    w2.nodes.push({ id: 'x', name: 'déjà là', mimeType: 'x', parent: 'TEST' });
    await assert.rejects(startCopy('test-org', { body: {} }, { ...d, fetchRows: w2.fetchRows, api: w2.api }), /TEST_DRIVE_NOT_EMPTY/);
    const w3 = world(); w3.api.drive = async id => ({ id, name: 'TATY ET ASSOCIES PERSONNEL' });
    await assert.rejects(startCopy('test-org', { body: {} }, { ...d, fetchRows: w3.fetchRows, api: w3.api }), /TEST_DRIVE_NAME_MUST_CONTAIN_TEST/);
  } finally { if (saved === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = saved; }
});
