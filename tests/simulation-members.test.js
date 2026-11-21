import test from 'node:test';
import assert from 'node:assert/strict';
import { simulationMembers, inviteToSimulation, revokeSimulationInvitation, setSimulationRole, removeSimulationMember } from '../lib/simulation.js';

const PARENT = '11111111-1111-4111-8111-111111111111', SIM = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
const owner = { id: 'u-owner', email: 'owner@cabinet.test' };

// A small in-memory base: just enough PostgREST behaviour for these functions.
function world({ members = [], orgs } = {}) {
  const db = {
    orgs: orgs || { [SIM]: { account_kind: 'simulation', parent_org_id: PARENT }, [PARENT]: { account_kind: null, parent_org_id: null }, [OTHER]: { account_kind: 'simulation', parent_org_id: 'someone-else' } },
    users: [{ org_id: SIM, auth_user_id: 'u-owner', email: 'owner@cabinet.test', role: 'owner', active: true }, ...members],
    invites: [], audit: []
  };
  const has = (path, key, val) => path.includes(key + '=eq.' + encodeURIComponent(val));
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_organizations?id=eq.')) { const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(path)[1]); return db.orgs[id] ? [db.orgs[id]] : []; }
    if (path.startsWith('office_app_users?')) {
      const org = decodeURIComponent(/org_id=eq\.([^&]+)/.exec(path)[1]);
      let rows = db.users.filter(u => u.org_id === org);
      const uid = /auth_user_id=eq\.([^&]+)/.exec(path); if (uid) rows = rows.filter(u => u.auth_user_id === decodeURIComponent(uid[1]));
      if (path.includes('active=eq.true')) rows = rows.filter(u => u.active);
      if (o.method === 'PATCH') { const patch = JSON.parse(o.body); rows.forEach(r => Object.assign(r, patch)); return null; }
      return rows;
    }
    if (path.startsWith('office_invitations')) {
      if (o.method === 'POST') { const r = { id: 'inv' + (db.invites.length + 1), used_at: null, revoked_at: null, ...JSON.parse(o.body)[0] }; db.invites.push(r); return [r]; }
      if (o.method === 'PATCH') { const id = decodeURIComponent(/[?&]id=eq\.([^&]+)/.exec(path)[1]); const r = db.invites.find(i => i.id === id && !i.used_at && !i.revoked_at); if (!r) return []; Object.assign(r, JSON.parse(o.body)); return [r]; }
      return db.invites.map(i => ({ ...i, created_at: '2026-11-21' }));
    }
    throw new Error('unexpected ' + path);
  };
  return { db, d: { fetchRows, audit: async (org, action, who, detail) => db.audit.push({ org, action, detail }) } };
}
const junior = { auth_user_id: 'u-jr', email: 'jr@cabinet.test', role: 'auditor', active: true, org_id: SIM };

test('the owner invites by address, any role, external address allowed; the secret is a link token', async () => {
  const { db, d } = world();
  const out = await inviteToSimulation(owner, PARENT, SIM, { email: 'Stagiaire@Externe.test', role: 'manager' }, d);
  assert.equal(out.kind, 'link'); assert.equal(out.email, 'stagiaire@externe.test'); assert.equal(out.role, 'manager'); assert.ok(out.token);
  assert.equal(db.invites[0].org_id, SIM);
  assert.equal(db.audit[0].action, 'SIMULATION_MEMBER_INVITED');
});

test('a shared code is refused in a simulation', async () => {
  const { db, d } = world();
  await assert.rejects(inviteToSimulation(owner, PARENT, SIM, { kind: 'code', role: 'auditor' }, d), /SIMULATION_CODE_INVITE_REFUSED/);
  assert.deepEqual(db.invites, []);
});

test('only the owner of the simulation manages it, and only a simulation of the current firm', async () => {
  const { d } = world({ members: [junior] });
  const jr = { id: 'u-jr', email: 'jr@cabinet.test' };
  for (const run of [
    () => inviteToSimulation(jr, PARENT, SIM, { email: 'x@y.test', role: 'auditor' }, d),
    () => simulationMembers(jr, PARENT, SIM, d),
    () => setSimulationRole(jr, PARENT, SIM, { user_id: 'u-jr', role: 'owner' }, d),
    () => removeSimulationMember(jr, PARENT, SIM, { user_id: 'u-owner' }, d)
  ]) await assert.rejects(run(), /NOT_SIMULATION_OWNER/);
  await assert.rejects(inviteToSimulation(owner, PARENT, OTHER, { email: 'x@y.test', role: 'auditor' }, d), /NOT_A_SIMULATION/);
  await assert.rejects(inviteToSimulation(owner, PARENT, PARENT, { email: 'x@y.test', role: 'auditor' }, d), /NOT_A_SIMULATION/);
  await assert.rejects(inviteToSimulation(owner, OTHER, SIM, { email: 'x@y.test', role: 'auditor' }, d), /NOT_A_SIMULATION/);
});

test('the 21st person is refused (active members + open invitations)', async () => {
  const many = Array.from({ length: 18 }, (_, i) => ({ org_id: SIM, auth_user_id: 'u' + i, email: 'p' + i + '@c.test', role: 'auditor', active: true }));
  const { d } = world({ members: many }); // 19 active with the owner
  await inviteToSimulation(owner, PARENT, SIM, { email: 'last@c.test', role: 'auditor' }, d); // 20th place = open invitation
  await assert.rejects(inviteToSimulation(owner, PARENT, SIM, { email: 'more@c.test', role: 'auditor' }, d), /SIMULATION_FULL/);
});

test('roles change inside the simulation only; an unknown role is refused; the last owner stays', async () => {
  const { db, d } = world({ members: [junior] });
  await setSimulationRole(owner, PARENT, SIM, { user_id: 'u-jr', role: 'partner' }, d);
  assert.equal(db.users.find(u => u.auth_user_id === 'u-jr').role, 'partner');
  assert.deepEqual(db.users.filter(u => u.org_id !== SIM), []);
  await assert.rejects(setSimulationRole(owner, PARENT, SIM, { user_id: 'u-jr', role: 'god' }, d), /INVALID_ROLE/);
  await assert.rejects(setSimulationRole(owner, PARENT, SIM, { user_id: 'u-owner', role: 'auditor' }, d), /LAST_SIMULATION_OWNER/);
  await assert.rejects(removeSimulationMember(owner, PARENT, SIM, { user_id: 'u-owner' }, d), /LAST_SIMULATION_OWNER/);
  await setSimulationRole(owner, PARENT, SIM, { user_id: 'u-jr', role: 'owner' }, d);
  await setSimulationRole(owner, PARENT, SIM, { user_id: 'u-owner', role: 'auditor' }, d); // a second owner exists now
  assert.equal(db.audit.filter(a => a.action === 'SIMULATION_ROLE_CHANGED').length, 3);
});

test('removing deactivates (nothing deleted); listing shows members and open invitations; a link can be revoked', async () => {
  const { db, d } = world({ members: [junior] });
  const inv = await inviteToSimulation(owner, PARENT, SIM, { email: 'new@c.test', role: 'senior' }, d);
  const view = await simulationMembers(owner, PARENT, SIM, d);
  assert.equal(view.members.length, 2); assert.equal(view.invitations.length, 1); assert.equal(view.max, 20);
  await removeSimulationMember(owner, PARENT, SIM, { user_id: 'u-jr' }, d);
  assert.equal(db.users.find(u => u.auth_user_id === 'u-jr').active, false);
  assert.equal(db.users.length, 2);
  await revokeSimulationInvitation(owner, PARENT, SIM, inv.id, d);
  assert.equal((await simulationMembers(owner, PARENT, SIM, d)).invitations.length, 0);
  await assert.rejects(setSimulationRole(owner, PARENT, SIM, { user_id: 'u-jr', role: 'auditor' }, d), /MEMBER_NOT_ACTIVE/);
  await assert.rejects(removeSimulationMember(owner, PARENT, SIM, { user_id: 'nobody' }, d), /MEMBER_NOT_FOUND/);
});
