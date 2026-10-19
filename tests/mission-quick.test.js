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
