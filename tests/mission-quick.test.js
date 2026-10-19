import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionQuick, missionFollowups, setFollowup, setMissionFolder, driveFolderId, followupView } from '../lib/mission-quick.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const RID = '22222222-2222-4222-8222-222222222222';
const FOLDER = '1AbCdEfGhIjKlMnOpQrStUv';

// A tiny in-memory PostgREST: enough for missions, profiles and assignments.
function fakeDb({ missions = [], profiles = [], noMigration = false } = {}) {
  const db = { missions: [...missions], profiles: [...profiles], assignments: [], patches: [] };
  const eq = (url, k) => decodeURIComponent((url.match(new RegExp('[?&]' + k + '=eq\\.([^&]+)')) || [])[1] || '');
  db.fetchRows = async (url, o = {}) => {
    const body = o.body ? JSON.parse(o.body) : null;
    if (url.startsWith('office_missions')) {
      if (o.method === 'POST') {
        if (noMigration && ('origin' in body || 'followups' in body)) throw new Error('PGRST204 column "origin" does not exist');
        if (!db.missions.some(m => m.id === body.id)) db.missions.push({ ...body });
        return [body];
      }
      if (o.method === 'PATCH') { const m = db.missions.find(x => x.id === eq(url, 'id')); Object.assign(m, body); db.patches.push(body); return []; }
      if (noMigration && /select=[^&]*(origin|followups)/.test(url)) throw new Error('42703 column does not exist');
      const id = eq(url, 'id');
      return id ? db.missions.filter(m => m.id === id) : db.missions;
    }
    if (url.startsWith('office_staff_profiles')) {
      if (o.method === 'POST') { const r = { id: '33333333-3333-4333-8333-333333333333', ...body[0] }; db.profiles.push(r); return [r]; }
      return db.profiles.filter(p => p.email === eq(url, 'email'));
    }
    if (url.startsWith('office_mission_assignments')) { db.assignments.push(body); return []; }
    throw new Error('unexpected ' + url);
  };
  return db;
}
const auditor = { email: 'awa@cabinet.test', display_name: 'Awa K.', role: 'auditor' };
const partner = { email: 'paul@cabinet.test', display_name: 'Paul', role: 'partner' };
const deps = (db, extra = {}) => ({ fetchRows: db.fetchRows, audit: async () => ({}), announce: async () => ({ announced: 4 }), ...extra });

test('a mission is created straight away: name + client, « En cours », creator on the team, nothing faked', async () => {
  const db = fakeDb();
  const r = await createMissionQuick(ORG, { request_id: RID, name: 'Audit des comptes 2025', client: 'BLE TRANSIT', origin: 'existing_client', period: '2025' }, auditor, deps(db));
  assert.equal(r.created, true);
  assert.equal(r.url, '/mission.html?id=' + RID);
  const m = db.missions[0];
  assert.equal(m.status, 'fieldwork');
  assert.equal(m.origin, 'existing_client');
  assert.equal(m.created_by, 'awa@cabinet.test');
  // The auditor gets a profile of their own and is assigned: they can open their mission.
  assert.equal(db.profiles[0].email, 'awa@cabinet.test');
  assert.equal(db.assignments[0].office_mission_id, RID);
  assert.equal(db.assignments[0].status, 'confirmed');
  // Acceptance, independence, letter stay open — never blocking, never marked done.
  const open = r.followups.items.filter(i => i.status === 'open').map(i => i.key);
  for (const k of ['acceptance', 'independence', 'engagement_letter', 'dates', 'folder']) assert.ok(open.includes(k), k);
  assert.ok(r.followups.items.every(i => i.blocking === false));
});

test('a double click never creates two missions', async () => {
  const db = fakeDb();
  const body = { request_id: RID, name: 'Revue 2025', client: 'Alpha' };
  await createMissionQuick(ORG, body, auditor, deps(db));
  const again = await createMissionQuick(ORG, body, auditor, deps(db));
  assert.equal(again.already, true);
  assert.equal(db.missions.length, 1);
});

test('same client and same name: possible duplicate shown, created only when the person confirms', async () => {
  const db = fakeDb({ missions: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Audit BLE Transit 2025', client_name: 'BLE TRANSIT', status: 'closed' }] });
  await assert.rejects(createMissionQuick(ORG, { name: 'Audit BLE TRANSIT 2025', client: 'Ble Transit' }, auditor, deps(db)),
    e => e.message === 'POSSIBLE_DUPLICATE' && e.statusCode === 409 && e.duplicates[0].status === 'closed');
  const r = await createMissionQuick(ORG, { name: 'Audit BLE TRANSIT 2025', client: 'Ble Transit', confirm_duplicate: true }, auditor, deps(db));
  assert.equal(r.created, true);
  assert.equal(db.missions.length, 2);
});

test('name and client are the only required fields', async () => {
  const db = fakeDb();
  await assert.rejects(createMissionQuick(ORG, { client: 'X' }, auditor, deps(db)), /MISSION_NAME_REQUIRED/);
  await assert.rejects(createMissionQuick(ORG, { name: 'X' }, auditor, deps(db)), /CLIENT_REQUIRED/);
  await assert.rejects(createMissionQuick(ORG, { name: 'X', client: 'Y', planned_start: '2026-11-10', planned_end: '2026-11-01' }, auditor, deps(db)), /END_BEFORE_START/);
});

test('the Drive folder is kept only when Drive confirms it is a folder', async () => {
  assert.equal(driveFolderId('https://drive.google.com/drive/folders/' + FOLDER + '?usp=sharing'), FOLDER);
  const ok = fakeDb();
  const r1 = await createMissionQuick(ORG, { name: 'A', client: 'B', folder: 'https://drive.google.com/drive/folders/' + FOLDER }, auditor,
    deps(ok, { getMeta: async () => ({ mimeType: 'application/vnd.google-apps.folder', name: 'États financiers 2025' }) }));
  assert.equal(ok.missions[0].drive_folder_id, FOLDER);
  assert.equal(r1.folder.verified, true);
  const ko = fakeDb();
  const r2 = await createMissionQuick(ORG, { name: 'A', client: 'B', folder: FOLDER }, auditor, deps(ko, { getMeta: async () => { throw new Error('drive down'); } }));
  assert.equal(ko.missions[0].drive_folder_id, null);
  assert.equal(r2.folder.verified, false);
  assert.ok(r2.followups.items.some(i => i.key === 'folder' && /à vérifier/.test(i.label)));
});

test('without db/mission-quick.sql the mission is still created', async () => {
  const db = fakeDb({ noMigration: true });
  const r = await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Gamma', origin: 'referral' }, auditor, deps(db));
  assert.equal(r.created, true);
  assert.equal(r.migration, false);
  assert.equal(db.missions[0].status, 'fieldwork');
  assert.equal('origin' in db.missions[0], false);
  const f = await missionFollowups(ORG, RID, { fetchRows: db.fetchRows });
  assert.equal(f.migration, false);
});

test('open items: acceptance is decided by a partner, a reason is needed for « sans objet », history kept', async () => {
  const db = fakeDb();
  await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Delta' }, auditor, deps(db));
  await assert.rejects(setFollowup(ORG, { mission_id: RID, key: 'acceptance', status: 'done' }, auditor, deps(db)), e => e.statusCode === 403);
  await assert.rejects(setFollowup(ORG, { mission_id: RID, key: 'engagement_letter', status: 'not_applicable' }, partner, deps(db)), /REASON_REQUIRED/);
  const v = await setFollowup(ORG, { mission_id: RID, key: 'acceptance', status: 'done', note: 'Client connu, maintien confirmé' }, partner, deps(db));
  const acc = v.items.find(i => i.key === 'acceptance');
  assert.equal(acc.status, 'done'); assert.equal(acc.by, 'Paul');
  const back = await setFollowup(ORG, { mission_id: RID, key: 'acceptance', status: 'open' }, partner, deps(db));
  assert.equal(back.items.find(i => i.key === 'acceptance').status, 'open');
  assert.equal(db.missions[0].followups.acceptance.history.length, 1);
});

test('a folder given later is checked in Drive, never replaced silently', async () => {
  const db = fakeDb();
  await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Eps' }, auditor, deps(db));
  const isFolder = { getMeta: async () => ({ mimeType: 'application/vnd.google-apps.folder', name: 'Pièces' }) };
  await assert.rejects(setMissionFolder(ORG, { mission_id: RID, folder: FOLDER }, auditor, deps(db, { getMeta: async () => ({ mimeType: 'application/pdf' }) })), /DRIVE_FOLDER_NOT_VERIFIED/);
  const r = await setMissionFolder(ORG, { mission_id: RID, folder: FOLDER }, auditor, deps(db, isFolder));
  assert.equal(r.folder.verified, true);
  assert.equal(db.missions[0].drive_folder_id, FOLDER);
  await assert.rejects(setMissionFolder(ORG, { mission_id: RID, folder: '9ZzYyXxWwVvUuTtSs' }, auditor, deps(db, isFolder)), /MISSION_ALREADY_HAS_FOLDER/);
  assert.equal(followupView(db.missions[0]).items.some(i => i.key === 'folder'), false);
});

test('dates filled in later: checked, kept when one is missing', async () => {
  const { setMissionDates } = await import('../lib/mission-quick.js');
  const db = fakeDb();
  await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Zeta' }, auditor, deps(db));
  await assert.rejects(setMissionDates(ORG, { mission_id: RID }, auditor, deps(db)), /DATES_REQUIRED/);
  await setMissionDates(ORG, { mission_id: RID, planned_start: '2026-10-20' }, auditor, deps(db));
  await assert.rejects(setMissionDates(ORG, { mission_id: RID, planned_end: '2026-10-01' }, auditor, deps(db)), /END_BEFORE_START/);
  const r = await setMissionDates(ORG, { mission_id: RID, planned_end: '2026-10-31' }, auditor, deps(db));
  assert.deepEqual(r, { planned_start: '2026-10-20', planned_end: '2026-10-31' });
  assert.equal(followupView(db.missions[0]).items.some(i => i.key === 'dates'), false);
});

// ---- The Mission Controller creates the mission folder, its structure, and receives the pieces ----
import { createMissionFolder, directWorkspaceStep, piecesReceived, uploadPiece, missionFolderName, prepareDirectMission } from '../lib/mission-quick.js';
const ROOT = 'RootMissionsFolder01';
function fakeDrive(files = {}) {
  const store = { [ROOT]: { id: ROOT, name: '01_MISSIONS', mimeType: 'application/vnd.google-apps.folder', parents: ['drive'] }, ...files };
  let n = 0;
  return {
    store,
    getMeta: async id => store[id] || null,
    findFilesByExactName: async (name, parent) => Object.values(store).filter(f => f.name === name && (f.parents || []).includes(parent)),
    createBinary: async ({ name, parentId }) => { const id = 'FileCreated' + (++n).toString().padStart(10, '0'); store[id] = { id, name, parents: [parentId], mimeType: 'application/pdf', webViewLink: 'https://drive/' + id }; return store[id]; }
  };
}
const fakeTidy = drive => ({ async findOrCreateFolder(parent, name) {
  const found = Object.values(drive.store).find(f => f.name === name && (f.parents || []).includes(parent) && f.mimeType === 'application/vnd.google-apps.folder');
  if (found) return found;
  const id = 'Folder' + name.replace(/\W/g, '').slice(0, 10).padEnd(10, 'x') + Object.keys(drive.store).length;
  drive.store[id] = { id, name, parents: [parent], mimeType: 'application/vnd.google-apps.folder', webViewLink: 'https://drive/' + id };
  return drive.store[id];
} });
const rootRef = async () => [{ document_type: 'mission_root', document_role: 'firm_reference', file_id: ROOT }];

test('the Mission Controller creates the mission folder under the firm’s missions root', async () => {
  assert.equal(missionFolderName({ name: 'Audit des comptes', client_name: 'BLE TRANSIT', period_label: '2025' }), 'BLE TRANSIT — Audit des comptes — 2025');
  assert.equal(missionFolderName({ name: 'Audit BLE TRANSIT 2025', client_name: 'BLE TRANSIT', period_label: '2025' }), 'Audit BLE TRANSIT 2025');
  const db = fakeDb(), drive = fakeDrive();
  await createMissionQuick(ORG, { request_id: RID, name: 'Audit des comptes', client: 'BLE TRANSIT', period: '2025' }, auditor, deps(db));
  const r = await createMissionFolder(ORG, db.missions[0], { fetchRows: db.fetchRows, drive, tidy: fakeTidy(drive), documentReferences: rootRef });
  assert.equal(r.status, 'created');
  assert.equal(drive.store[r.id].parents[0], ROOT);
  assert.equal(db.missions[0].drive_folder_id, r.id);
  // No root configured: the person is told where to set it, nothing invented.
  const none = await createMissionFolder(ORG, { id: RID, name: 'X' }, { fetchRows: db.fetchRows, drive, tidy: fakeTidy(drive), documentReferences: async () => [] });
  assert.equal(none.status, 'configuration_required');
  assert.match(none.href, /mission_root/);
});

test('a folder already used by another mission is never taken', async () => {
  const drive = fakeDrive();
  const taken = await fakeTidy(drive).findOrCreateFolder(ROOT, 'Alpha — Revue 2025');
  const db = fakeDb({ missions: [{ id: '55555555-5555-4555-8555-555555555555', name: 'Revue 2025 (ancienne)', client_name: 'Alpha', status: 'closed', drive_folder_id: taken.id }] });
  const r = await createMissionFolder(ORG, { id: RID, name: 'Revue 2025', client_name: 'Alpha' }, { fetchRows: db.fetchRows, drive, tidy: fakeTidy(drive), documentReferences: rootRef });
  assert.equal(r.status, 'review_required');
});

test('creation runs the Mission Controller: folder made; without a structure model it says so (2026-10-19: by code, not by AI)', async () => {
  const db = fakeDb(), drive = fakeDrive();
  const r = await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Kappa' }, auditor,
    deps(db, { req: { headers: { host: 'x' } }, drive, tidy: fakeTidy(drive), documentReferences: rootRef, fire: async () => true }));
  assert.equal(r.prepared.folder.status, 'created');
  assert.ok(db.missions[0].drive_folder_id);
  assert.equal(db.missions[0].followups.workspace.status, 'template_required');
  assert.match(db.missions[0].followups.workspace.href, /mission_structure/);
  assert.equal(r.followups.items.some(i => i.key === 'folder'), false);
});

test('with the firm’s structure model given, the folders are copied by code into the mission folder (no AI, PIECES_RECUES untouched)', async () => {
  const db = fakeDb(), drive = fakeDrive(); let synced = null;
  drive.store.TPL = { id: 'TPL', name: 'MODELE MISSION', parents: [ROOT], mimeType: 'application/vnd.google-apps.folder' };
  const refs = async () => [{ document_type: 'mission_root', document_role: 'firm_reference', file_id: ROOT }, { document_type: 'mission_structure', document_role: 'template', file_id: 'TPL', name: 'MODELE MISSION' }];
  const r = await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Kappa' }, auditor,
    deps(db, { req: { headers: { host: 'x' } }, drive, tidy: fakeTidy(drive), documentReferences: refs, fire: async () => true,
      syncFolderFromTemplate: async a => { synced = a; return { root: { id: db.missions[0].drive_folder_id }, foldersCreated: 6, skippedExisting: 0 }; } }));
  assert.equal(r.prepared.workspace.status, 'structured');
  assert.equal(synced.foldersOnly, true); assert.equal(synced.templateFolderId, 'TPL');
  assert.equal(synced.destinationName, drive.store[db.missions[0].drive_folder_id].name);
  assert.equal(db.missions[0].followups.workspace.folders_created, 6);
});

test('the structure step runs once, and waits honestly when the agents are not authorised', async () => {
  const db = fakeDb(), drive = fakeDrive();
  await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Lambda', engagement_type: 'statutory' }, auditor,
    deps(db, { req: { headers: { host: 'x' } }, drive, tidy: fakeTidy(drive), documentReferences: rootRef, fire: async () => true }));
  db.missions[0].followups.workspace.status = 'queued';
  const no = await directWorkspaceStep(ORG, { mission_id: RID }, { fetchRows: db.fetchRows, permissions: async () => ({ granted: false }) });
  assert.equal(no.status, 'agents_not_authorized');
  db.missions[0].followups.workspace.status = 'queued';
  let ctx = null;
  const ok = await directWorkspaceStep(ORG, { mission_id: RID }, { fetchRows: db.fetchRows, permissions: async () => ({ granted: true }), run: async a => { ctx = a.contexts['mission-controller']; return { text: 'Structure reprise du modèle', toolsUsed: ['initialize_mission_from_template'] }; } });
  assert.equal(ok.status, 'reported');
  assert.equal(ctx.engagement_type, 'Audit légal / commissariat aux comptes');
  assert.equal(ctx.destination.folder_id, db.missions[0].drive_folder_id);
  assert.equal((await directWorkspaceStep(ORG, { mission_id: RID }, { fetchRows: db.fetchRows, run: async () => { throw new Error('twice'); } })).status, 'not_queued');
});

test('pieces received go straight into the mission folder, never overwrite, then the agents read them', async () => {
  const db = fakeDb(), drive = fakeDrive();
  const d0 = deps(db, { req: { headers: { host: 'x' } }, drive, tidy: fakeTidy(drive), documentReferences: rootRef, fire: async () => true });
  await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Mu' }, auditor, d0);
  const b64 = Buffer.from('%PDF états financiers').toString('base64');
  const a = await uploadPiece(ORG, { mission_id: RID, name: 'Etats financiers 2025.pdf', base64: b64 }, auditor, d0);
  const b = await uploadPiece(ORG, { mission_id: RID, name: 'Etats financiers 2025.pdf', base64: b64 }, auditor, d0);
  assert.equal(a.name, 'Etats financiers 2025.pdf');
  assert.notEqual(b.name, a.name);   // same name: a dated name, the first file is untouched
  const received = drive.store[drive.store[a.file_id].parents[0]];
  assert.equal(received.name, 'PIECES_RECUES');
  assert.equal(received.parents[0], db.missions[0].drive_folder_id);
  let started = null, indexed = null, recorded = null;
  const r = await piecesReceived(ORG, {}, { mission_id: RID, files: [{ id: a.file_id }, { id: b.file_id }, { id: 'SomeOtherFile123' }] }, auditor,
    { ...d0, startDeposit: async (o, req, body) => { started = body; return { started: true, id: 'dep-1' }; }, recordFiles: async e => { indexed = e; }, recordMissionDocuments: async (m, docs) => { recorded = docs; } });
  assert.equal(r.received, 2);   // a file outside the mission folder is ignored
  assert.equal(started.mission_id, RID);
  assert.equal(started.files.length, 2);
  assert.ok(indexed.every(x => x.protected && x.placed_by === 'mission-controller' && x.mission_id === RID));
  assert.ok(recorded.every(x => x.role === 'piece_recue'));
});

test('no mission folder yet: the deposit says so instead of putting the pieces elsewhere', async () => {
  const db = fakeDb();
  await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Nu' }, auditor, deps(db));
  await assert.rejects(uploadPiece(ORG, { mission_id: RID, name: 'a.pdf', base64: 'QQ==' }, auditor, deps(db, { drive: fakeDrive() })), /MISSION_FOLDER_REQUIRED/);
  const p = await prepareDirectMission(ORG, null, RID, auditor, { fetchRows: db.fetchRows, drive: fakeDrive(), tidy: fakeTidy(fakeDrive()), documentReferences: async () => [], audit: async () => ({}) });
  assert.equal(p.folder.status, 'configuration_required');
  assert.equal(followupView(db.missions[0]).items.find(i => i.key === 'folder').href.includes('mission_root'), true);
});

test('a TDR among the pieces received goes to the Mission Controller, read from its content', async () => {
  const { startDepositAnalysis, depositStep } = await import('../lib/deposit-analysis.js');
  const mem = { state: null }; let prep = null;
  const d = {
    drive: {}, folder: 'mem', fire: async () => true, budgetMs: 5000,
    loadJsonFile: async () => ({ state: mem.state && JSON.parse(JSON.stringify(mem.state)), fileId: 'x' }),
    saveJsonFile: async (n, dr, f, id, st) => { mem.state = JSON.parse(JSON.stringify(st)); },
    // The name says « balance » for the TDR: only the content decides.
    fileForAI: async id => ({ text: id === 'F1' ? 'TERMES DE REFERENCE — audit des comptes 2025' : 'Balance générale' }),
    ai: async () => ({ provider: 'test', text: JSON.stringify({ documents: [{ file_id: 'F1', role: 'tdr', type: 'TDR' }, { file_id: 'F2', role: 'etat_financier', type: 'Balance' }] }) }),
    engagementMissions: async () => [{ id: RID, name: 'Audit 2025', phase: 'active' }],
    linkToMissions: async (o, docs) => ({ linked: docs.map(doc => ({ doc, mission: { id: RID, name: 'Audit 2025' }, dates: {} })), to_attach: [] }),
    applyMissionUpdates: async () => ({ attached: 2, proposals: [] }),
    startEngagementPrep: async (o, req, body) => { prep = body; return { started: true }; }
  };
  const r = await startDepositAnalysis(ORG, {}, { purpose: 'pieces', mission_id: RID, files: [{ id: 'F1', name: 'balance_scan.pdf' }, { id: 'F2', name: 'tdr.xlsx' }], by: 'Awa' }, d);
  let st = await depositStep(ORG, {}, { id: r.id }, d);
  for (let i = 0; i < 4 && st.status === 'running'; i++) st = await depositStep(ORG, {}, { id: r.id }, d);
  assert.equal(st.status, 'done');
  assert.deepEqual(prep.tdr_file_ids, ['F1']);
  assert.equal(prep.mission_id, RID);
  assert.equal(st.handed_to.agent, 'Mission Controller');
  // Without a TDR / contract / letter: the pieces are only attached, nobody pretends the mission was prepared.
  prep = null; mem.state = null;
  d.ai = async () => ({ provider: 'test', text: JSON.stringify({ documents: [{ file_id: 'F2', role: 'etat_financier' }] }) });
  const r2 = await startDepositAnalysis(ORG, {}, { purpose: 'pieces', mission_id: RID, files: [{ id: 'F2', name: 'b.xlsx' }] }, d);
  let st2 = await depositStep(ORG, {}, { id: r2.id }, d);
  for (let i = 0; i < 4 && st2.status === 'running'; i++) st2 = await depositStep(ORG, {}, { id: r2.id }, d);
  assert.equal(st2.status, 'done'); assert.equal(prep, null); assert.equal(st2.handed_to, undefined);
});

test('without db/mission-quick.sql the model structure is still launched (never silently dropped)', async () => {
  const { requestDirectWorkspace, directWorkspaceStep } = await import('../lib/mission-quick.js');
  const db = fakeDb({ noMigration: true }); const fired = [];
  await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Xi' }, auditor, deps(db));
  db.missions[0].drive_folder_id = 'FolderAlready0001';
  const r = await requestDirectWorkspace(ORG, { headers: { host: 'x' } }, RID, auditor, { fetchRows: db.fetchRows, fire: async (req, path, body) => { fired.push(body); return true; } });
  assert.equal(r.status, 'queued');
  assert.equal(fired[0].no_record, true);
  let ran = false;
  const out = await directWorkspaceStep(ORG, fired[0], { fetchRows: db.fetchRows, permissions: async () => ({ granted: true }), run: async () => { ran = true; return { text: 'ok' }; } });
  assert.equal(ran, true); assert.equal(out.status, 'reported');
  // With the column present, « no_record » never bypasses the claim.
  const db2 = fakeDb();
  await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Xi' }, auditor, deps(db2));
  assert.equal((await directWorkspaceStep(ORG, { mission_id: RID, no_record: true }, { fetchRows: db2.fetchRows, run: async () => { throw new Error('must not run'); } })).status, 'not_queued');
});

test('go straight to the tests: cycles from the SOP library, CORE on, the person types materiality and sample size', async () => {
  const { quickStartTests } = await import('../lib/mission-quick.js');
  const w = await import('../lib/work-programme.js');
  const db = fakeDb();
  await createMissionQuick(ORG, { request_id: RID, name: 'Audit 2025', client: 'Omicron', origin: 'direct' }, auditor, deps(db));
  db.missions[0].drive_folder_id = null;
  const lib = { sops: [{ file_id: 'SOP_ACH', file_name: 'C02_ACH.docx', cycle: { code: 'ACH', title: 'Achats' }, procedures: [
    { code: 'ACH-01', title: 'Rapprochement', type: 'CORE', sampling_mode: 'programme_sample' }, { code: 'ACH-02', title: 'Option', type: 'OPTIONAL' }] }] };
  const programmes = [];
  const base = db.fetchRows;
  db.fetchRows = async (url, o = {}) => {
    if (url.startsWith('office_work_programmes')) {
      if (o.method === 'POST') { const r = { id: 'P1', updated_at: 't1', ...JSON.parse(o.body)[0] }; programmes.push(r); return [r]; }
      if (o.method === 'PATCH') { const r = programmes.find(x => url.includes('id=eq.' + x.id)); if (!r) return []; Object.assign(r, JSON.parse(o.body)); return [r]; }
      return url.includes('status=eq.validated') ? programmes.filter(x => x.status === 'validated') : [...programmes].reverse();
    }
    if (url.startsWith('office_staff_profiles?') && url.includes('id=in.')) return db.profiles;
    if (url.startsWith('office_mission_assignments?') && !o.method) return db.assignments.map(a => ({ staff_profile_id: a.staff_profile_id, mission_role: a.mission_role, status: a.status }));
    return base(url, o);
  };
  const dd = { fetchRows: db.fetchRows, methodology: async () => lib, audit: async () => ({}), emit: async () => ({}), drive: {} };
  await assert.rejects(quickStartTests(ORG, RID, { sop_file_ids: ['SOP_ACH'], review_level: 'manager' }, auditor, dd), /MATERIALITY_REQUIRED/);
  await assert.rejects(quickStartTests(ORG, RID, { sop_file_ids: ['SOP_ACH'], materiality: 5000000, review_level: 'manager' }, auditor, dd), e => e.message === 'PROGRAMME_INCOMPLETE' && e.gaps.some(g => g.gap === 'SAMPLE_SIZE_REQUIRED'));
  // The auditor who created this direct mission leads it: prepares and validates its programme, then works the tests.
  const r = await quickStartTests(ORG, RID, { sop_file_ids: ['SOP_ACH'], materiality: 5000000, sample_size: 25, review_level: 'manager' }, auditor, dd);
  assert.equal(r.validated, true);
  assert.deepEqual(r.procedures.map(p => [p.code, p.mine]), [['ACH-01', true]]);
  assert.match(r.procedures[0].url, /procedure\.html\?mission_id=/);
  // Anyone else's mission: an auditor is not its lead.
  const other = { email: 'kofi@cabinet.test', display_name: 'Kofi', role: 'auditor' };
  assert.equal(await w.isDirectMissionLead(ORG, RID, other, db.fetchRows), false);
});
