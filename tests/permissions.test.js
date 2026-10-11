import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveMatrix, myScreens, can, savePermissions, permissionsView, DEFAULT_MATRIX, SCREENS, ACTIONS, DEFAULT_POSITIONS } from '../lib/permissions.js';
import { ROLES, roleFromTitle } from '../lib/roles.js';

test('every role has a level on every screen; the IT administrator never opens client files', () => {
  const m = effectiveMatrix({ matrix: { it_admin: { workpapers: 'view', mission: 'approve' } } });
  for (const r of ROLES) for (const s of Object.keys(SCREENS)) assert.ok(m[r][s], r + '/' + s);
  assert.equal(m.it_admin.workpapers.level, 'none');
  assert.equal(m.it_admin.mission.level, 'none');
  assert.equal(m.it_admin.settings.level, 'admin');
  assert.equal(DEFAULT_MATRIX.partner.workpapers.mine, true, 'a partner signs on his own missions');
});

test('the menu hides the pages a role may not open', () => {
  const m = effectiveMatrix({});
  const bdm = myScreens({ role: 'bdm' }, m);
  assert.ok(!bdm.hidden_pages.includes('/veille.html'));
  assert.ok(bdm.hidden_pages.includes('/entrainement.html'), 'Shadow is not for the BDM');
  const it = myScreens({ role: 'it_admin' }, m);
  assert.ok(!it.hidden_pages.includes('/entrainement.html'), 'the IT administrator sees Shadow');
  assert.ok(it.hidden_pages.includes('/auditeur.html'));
  const aud = myScreens({ role: 'auditor' }, m);
  assert.ok(aud.hidden_pages.includes('/veille.html'));
});

test('can(): roles, AI ceiling and automatic rules', () => {
  const p = { role: 'partner', email: 'p@c.ci' };
  assert.equal(can(p, 'tender_follow_decision').ok, true);
  assert.equal(can({ role: 'bdm', email: 'b@c.ci' }, 'tender_follow_decision').reason, 'ROLE_NOT_ALLOWED');
  assert.equal(can(p, 'tender_follow_decision', { agent: true }).reason, 'AI_CANNOT_DECIDE');
  assert.equal(can(p, 'phase0_decision', { preparedBy: 'P@c.ci' }).reason, 'NO_SELF_APPROVAL');
  assert.equal(can({ role: 'senior', email: 's@c.ci' }, 'workpaper_review', { preparedBy: 's@c.ci' }).reason, 'NO_SELF_REVIEW');
  assert.equal(can(p, 'report_issue', { eqrDone: false }).reason, 'EQR_NOT_DONE');
  assert.equal(can(p, 'report_issue', { eqrDone: true, canSign: false }).reason, 'NOT_QUALIFIED_TO_SIGN');
  assert.equal(can(p, 'eqr_appointment', { inTeam: true }).reason, 'EQR_IN_TEAM');
  assert.equal(can(p, 'eqr_appointment', { signedWithinTwoYears: true }).reason, 'EQR_COOLING_OFF');
  assert.equal(can(p, 'engagement_letter_send', { kycDone: false }).reason, 'KYC_INDEPENDENCE_FIRST');
  assert.equal(can({ role: 'auditor', email: 'a@c.ci' }, 'independence_declaration', { isSelf: true }).ok, true);
  assert.equal(can(p, 'independence_declaration', { isSelf: false }).ok, false);
  for (const [k, a] of Object.entries(ACTIONS)) assert.ok(a.label && Array.isArray(a.decide), k);
});

test('only the firm’s lead changes the rights, never their own role upwards', async () => {
  const store = { settings: {} };
  const fetchRows = async (path, opts) => { if (opts?.method === 'POST') { store.settings = JSON.parse(opts.body)[0].settings; return null; } return [{ settings: store.settings }]; };
  const d = { fetchRows, audit: async () => null };
  await assert.rejects(savePermissions('org', { changes: [] }, { role: 'manager' }, d), /PARTNERS_ONLY/);
  await assert.rejects(savePermissions('org', { changes: [{ role: 'partner', screen: 'home', value: 'approve' }] }, { role: 'partner', email: 'p@c.ci' }, d), /NO_SELF_ELEVATION/);
  const r = await savePermissions('org', { changes: [{ role: 'secretary', screen: 'billing', value: 'approve' }, { role: 'manager', screen: 'tenders', value: 'view' }] }, { role: 'partner', email: 'p@c.ci' }, d);
  assert.equal(r.matrix.secretary.billing.level, 'approve');
  assert.equal(store.settings.permissions.matrix.manager.tenders, 'view');
  // Back to the default: the override disappears.
  await savePermissions('org', { changes: [{ role: 'manager', screen: 'tenders', value: null }] }, { role: 'partner', email: 'p@c.ci' }, d);
  assert.equal(store.settings.permissions.matrix.manager, undefined);
  const view = await permissionsView('org', { role: 'auditor' }, { loadOverrides: async () => ({}) });
  assert.ok(view.mine && !view.matrix, 'a team member sees only their own rights');
  const full = await permissionsView('org', { role: 'partner' }, { loadOverrides: async () => ({}) });
  assert.ok(full.matrix && full.positions.length === DEFAULT_POSITIONS.length);
});

test('the Business Development Manager is a role of its own', () => {
  assert.ok(ROLES.includes('bdm'));
  assert.equal(roleFromTitle('Business Development Manager'), 'bdm');
  assert.equal(roleFromTitle('Responsable du développement commercial'), 'bdm');
  assert.equal(roleFromTitle('Associé gérant'), 'partner');
});
