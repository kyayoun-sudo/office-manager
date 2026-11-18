import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, listSimulations, archiveSimulation } from '../lib/simulation.js';

const PARENT = '11111111-1111-4111-8111-111111111111', SIM = '22222222-2222-4222-8222-222222222222';
const user = { id: 'u1', email: 'junior@cabinet.test', email_confirmed_at: '2026-11-01', user_metadata: { display_name: 'Junior' } };
const audit = async () => {};

function world() {
  const calls = { rpc: [], drive: [], put: [] };
  const fetchRows = async (path, o = {}) => {
    if (path === 'rpc/office_create_simulation') { calls.rpc.push(JSON.parse(o.body)); return { org_id: SIM, created: true }; }
    if (path.startsWith('office_firm_drive')) { calls.put.push({ path, body: o.body && JSON.parse(o.body) }); return null; }
    throw new Error('unexpected ' + path);
  };
  const drive = { defaultParent: () => 'ENTRAINEMENTS', createFolder: async (parent, name) => { calls.drive.push({ parent, name }); return { id: 'FOLDER1' }; } };
  return { calls, d: { fetchRows, drive, audit } };
}

test('creating a simulation passes the verified identity and the parent, never a body-supplied user', async () => {
  const { calls, d } = world();
  const out = await createSimulation(user, PARENT, { name: 'Entraînement Atlas 2024', user_id: 'evil', source: { client: 'Atlas', period: '2024' } }, d);
  assert.equal(out.org_id, SIM); assert.equal(out.folder_id, 'FOLDER1');
  assert.deepEqual(calls.rpc[0], { p_auth_user_id: 'u1', p_parent_org: PARENT, p_name: 'Entraînement Atlas 2024', p_display_name: 'Junior' });
  assert.equal(calls.drive[0].parent, 'ENTRAINEMENTS');
  assert.match(calls.drive[0].name, /Atlas 2024/);
  assert.ok(calls.drive[0].name.length <= 60);
  assert.equal(calls.put[0].body[0].drive_id, 'folder:FOLDER1');
});

test('an unverified e-mail, an empty name and a missing Entraînements folder are refused with clear codes', async () => {
  const { d } = world();
  await assert.rejects(createSimulation({ ...user, email_confirmed_at: null }, PARENT, { name: 'X' }, d), /EMAIL_NOT_VERIFIED/);
  await assert.rejects(createSimulation(user, PARENT, { name: '  ' }, d), /SIMULATION_NAME_REQUIRED/);
  d.drive = { defaultParent: () => null, createFolder: async () => ({ id: 'F' }) };
  await assert.rejects(createSimulation(user, PARENT, { name: 'X' }, d), /TRAINING_PARENT_REQUIRED/);
});

test('a second click on the same name returns the same firm and creates no second folder', async () => {
  const calls = [];
  const d = { audit, fetchRows: async () => ({ org_id: SIM, created: false }), drive: { defaultParent: () => 'E', createFolder: async () => { calls.push(1); return { id: 'F' }; } } };
  const out = await createSimulation(user, PARENT, { name: 'Même nom' }, d);
  assert.equal(out.created, false); assert.equal(calls.length, 0);
});

test('the SQL errors of the function become clear codes', async () => {
  const { d } = world();
  for (const code of ['NOT_IN_PARENT', 'PARENT_IS_SIMULATION']) {
    d.fetchRows = async () => { throw new Error('SUPABASE_400 ' + code); };
    await assert.rejects(createSimulation(user, PARENT, { name: 'X' }, d), new RegExp(code));
  }
});

test('listing returns only the simulations the person belongs to', async () => {
  const fetchRows = async path => path.startsWith('office_organizations?parent_org_id')
    ? [{ id: SIM, name: 'A', created_at: '2026-11-18' }, { id: 'other', name: 'B', created_at: '2026-11-17' }]
    : [{ org_id: SIM, role: 'owner', active: true }];
  const out = await listSimulations(user, PARENT, { fetchRows });
  assert.deepEqual(out.map(s => s.org_id), [SIM]); assert.equal(out[0].archived, false);
});

test('archiving deactivates the members of the simulation and touches nothing of the parent', async () => {
  const seen = [];
  const fetchRows = async (path, o = {}) => { seen.push([path, o.method]); return !o.method && path.includes('auth_user_id=eq.u1') ? [{ role: 'owner' }] : []; };
  const out = await archiveSimulation(user, SIM, { fetchRows, audit });
  assert.equal(out.archived, true);
  assert.ok(seen.some(([p, m]) => m === 'PATCH' && p.startsWith('office_app_users?org_id=eq.' + SIM)));
  assert.ok(!seen.some(([p]) => p.includes(PARENT)));
  await assert.rejects(archiveSimulation(user, SIM, { fetchRows: async () => [{ role: 'senior' }], audit }), /NOT_SIMULATION_OWNER/);
});
