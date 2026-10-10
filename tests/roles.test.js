import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, mayGrant, roleFromTitle, visiblePeople } from '../lib/roles.js';
import { manageAccount } from '../lib/accounts.js';
import { proposeTeamRoles } from '../lib/team-roles.js';

test('roles: who may give which role (only an owner makes an owner; the IT administrator never touches partners; nobody raises their own role)', () => {
  assert.ok(ROLES.includes('quality_reviewer') && ROLES.includes('it_admin') && ROLES.includes('secretary'));
  assert.equal(mayGrant({ role: 'owner' }, 'owner'), true);
  assert.equal(mayGrant({ role: 'partner' }, 'owner'), false);
  assert.equal(mayGrant({ role: 'partner' }, 'manager', 'auditor'), true);
  assert.equal(mayGrant({ role: 'it_admin' }, 'senior', 'auditor'), true);
  assert.equal(mayGrant({ role: 'it_admin' }, 'partner', 'manager'), false);
  assert.equal(mayGrant({ role: 'it_admin' }, 'auditor', 'partner'), false);
  assert.equal(mayGrant({ role: 'partner' }, 'owner', 'partner', true), false);
  assert.equal(mayGrant({ role: 'manager' }, 'auditor', 'senior'), false);
});

test('roles: the firm\'s titles become a proposed role', () => {
  assert.equal(roleFromTitle('Associé gérant'), 'partner');
  assert.equal(roleFromTitle('Chef de mission'), 'manager');
  assert.equal(roleFromTitle('Superviseur audit'), 'supervisor');
  assert.equal(roleFromTitle('Auditeur senior'), 'senior');
  assert.equal(roleFromTitle('Assistante de direction'), 'secretary');
  assert.equal(roleFromTitle('Responsable informatique'), 'it_admin');
  assert.equal(roleFromTitle('Stagiaire'), 'auditor');
  assert.equal(roleFromTitle('Revue qualité (EQR)'), 'quality_reviewer');
  assert.equal(roleFromTitle(''), null);
});

test('roles: a manager sees the performance of the people who report to them directly, if the firm allows it', async () => {
  const rows = { reports: [{ email: 'awa@cab.ci' }, { email: 'kofi@cab.ci' }] };
  let allowed = true;
  const fetchRows = async url => url.startsWith('office_firm_settings') ? [{ settings: { managers_see_direct_reports: allowed } }] : url.includes('reports_to=eq.m1') ? rows.reports : [];
  assert.equal(await visiblePeople('o', { role: 'partner' }, fetchRows), null);
  assert.deepEqual([...await visiblePeople('o', { role: 'manager', email: 'Ama@cab.ci', auth_user_id: 'm1' }, fetchRows)].sort(), ['ama@cab.ci', 'awa@cab.ci', 'kofi@cab.ci']);
  assert.deepEqual([...await visiblePeople('o', { role: 'auditor', email: 'awa@cab.ci', auth_user_id: 'a1' }, fetchRows)], ['awa@cab.ci']);
  allowed = false;
  assert.deepEqual([...await visiblePeople('o', { role: 'manager', email: 'ama@cab.ci', auth_user_id: 'm1' }, fetchRows)], ['ama@cab.ci']);
});

test('accounts: create with role, position and manager; the IT administrator is refused on a partner\'s account', async () => {
  const sent = [];
  const fetchRows = async (url, o) => { sent.push({ url, body: o?.body ? JSON.parse(o.body) : null }); if (url.includes('auth_user_id=eq.')) return [{ auth_user_id: '11111111-1111-4111-8111-111111111111', email: 'p@cab.ci', display_name: 'P', role: 'partner', active: true }]; return []; };
  const authCall = async () => ({ status: 200, data: { id: '22222222-2222-4222-8222-222222222222' }, body: { id: '22222222-2222-4222-8222-222222222222' } });
  await assert.rejects(manageAccount('o', { action: 'create', email: 'x@cab.ci', display_name: 'X', role: 'owner', password: 'motdepasse123' }, { fetchRows, authCall, actor: { role: 'partner' } }), /ROLE_NOT_GRANTABLE/);
  await assert.rejects(manageAccount('o', { action: 'set_role', auth_user_id: '11111111-1111-4111-8111-111111111111', role: 'manager' }, { fetchRows, actor: { role: 'it_admin' } }), /ROLE_NOT_GRANTABLE/);
  await assert.rejects(manageAccount('o', { action: 'set_profile', auth_user_id: '11111111-1111-4111-8111-111111111111', reports_to: '11111111-1111-4111-8111-111111111111' }, { fetchRows, actor: { role: 'owner' } }), /VALID_MANAGER_REQUIRED/);
  const r = await manageAccount('o', { action: 'set_profile', auth_user_id: '11111111-1111-4111-8111-111111111111', position: 'Associé gérant', reports_to: null }, { fetchRows, actor: { role: 'owner' } });
  assert.deepEqual(r, { updated: true, position: 'Associé gérant', reports_to: null });
});

test('Firm Manager: roles, positions and managers proposed from the team sheet; accounts to create listed', async () => {
  const r = await proposeTeamRoles('o', {
    teamSheetMembers: async () => ({ source: 'TATY_EQUIPE_RESPONSABLES', members: [
      { full_name: 'Ama Koné', email: 'ama@cab.ci', role: 'Manager', grade: 'M2', reports_to: 'Paul Komenan' },
      { full_name: 'Awa Diallo', email: 'awa@cab.ci', role: 'Auditeur junior', grade: null, reports_to: 'Ama Koné' },
      { full_name: 'Paul Komenan', email: 'paul@cab.ci', role: 'Associé gérant', grade: null, reports_to: null }] }),
    listAccounts: async () => ({ roles_installed: true, users: [
      { auth_user_id: 'p1', email: 'paul@cab.ci', display_name: 'Paul Komenan', role: 'owner', active: true },
      { auth_user_id: 'a1', email: 'ama@cab.ci', display_name: 'Ama Koné', role: 'collaborator', active: true, position: null, reports_to: null }] })
  });
  const ama = r.proposals.find(p => p.full_name === 'Ama Koné');
  assert.deepEqual(ama.changes, { role: 'manager', position: 'Manager — M2', reports_to: 'p1' });
  assert.equal(r.proposals.find(p => p.full_name === 'Paul Komenan').changes.role, null, 'an owner is never proposed another role');
  const awa = r.proposals.find(p => p.full_name === 'Awa Diallo');
  assert.equal(awa.status, 'no_account'); assert.equal(awa.proposed_role, 'auditor'); assert.equal(awa.proposed_reports_to, 'a1');
});
