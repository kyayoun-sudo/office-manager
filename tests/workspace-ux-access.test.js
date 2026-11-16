import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { ROUTES } from '../api/app.js';
import { SHADOW_VIEWERS, ROLES } from '../lib/roles.js';
import { effectiveMatrix, can } from '../lib/permissions.js';
import { firmAction } from '../lib/firm-simulation-service.js';
import { sandboxAction } from '../lib/audit-sandbox.js';
import { getTraining } from '../lib/training.js';

test('Shadow / training is hard-locked to the owner, the partners and IT, even with legacy role overrides (Paul, 2026-11-16)', () => {
  assert.deepEqual([...SHADOW_VIEWERS], ['owner', 'partner', 'it_admin']);
  const matrix = effectiveMatrix({ matrix: {
    partner: { shadow: 'none' }, auditor: { shadow: 'admin' },
    owner: { shadow: 'none' }, it_admin: { shadow: 'none', mission: 'admin' }
  } });
  for (const role of ROLES) {
    assert.equal(matrix[role].shadow.level, ['owner', 'partner', 'it_admin'].includes(role) ? 'approve' : 'none', role);
  }
  assert.equal(matrix.it_admin.mission.level, 'none', 'IT must not inherit real client data');
  assert.equal(can({ role: 'partner' }, 'shadow_lesson_validate').ok, true, 'the partners decide on lessons');
  assert.equal(can({ role: 'it_admin' }, 'shadow_lesson_validate').ok, false, 'IT operates the lab, the partners decide');
  assert.equal(can({ role: 'partner' }, 'phase0_decision').ok, true, 'business partner approval still works');
});

test('all private training APIs use the same role family', async () => {
  for (const route of ['shadow', 'training']) {
    for (const method of ['GET', 'POST']) {
      assert.deepEqual(ROUTES[route][method].userRoles, ['owner', 'partner', 'it_admin'], route + '/' + method);
    }
  }
  assert.deepEqual(ROUTES['training-confirm'].POST.userRoles, ['owner', 'partner', 'it_admin']);
  // The IT administrator controls synthetic training, not real mission-quality documents.
  await assert.rejects(
    ROUTES.shadow.POST('firm-test', { account: { role: 'it_admin' }, body: { action: 'quality-check', mission_id: 'real-client-id' } }),
    /CLIENT_MISSION_RESTRICTED/
  );
  await assert.rejects(firmAction('org', { role: 'senior' }, { action: 'firm-create' }), /TRAINING_ADMIN_ONLY/);
  await assert.rejects(sandboxAction('org', { role: 'senior' }, { action: 'sandbox-create' }), /TRAINING_ADMIN_ONLY/);
});

test('GET training is read-only and IT receives metrics, never real-client evidence', async () => {
  const cases = [
    { id: 'real-1', day: 1, kind: 'real', ref: 'REALCLIENTSECRET', agent_key: 'grand-controleur', status: 'graded',
      title: 'REALCLIENTSECRET', score: 85, answer: 'REALCLIENTSECRET', lesson: 'REALCLIENTSECRET',
      scenario: { client: 'REALCLIENTSECRET', files: [{ name: 'REALCLIENTSECRET' }] },
      grade: { traps: [{ id: 'secret', label: 'REALCLIENTSECRET', detected: true }] },
      feedback: { verdict: 'juste', note: 'REALCLIENTSECRET' }, drive_folder_id: 'REALCLIENTSECRET' },
    { id: 'fake-1', day: 1, kind: 'fake', ref: 'F-1', agent_key: 'orpailleur', status: 'graded',
      title: 'Fictif', score: 92, answer: 'Données simulées', lesson: 'Contrôler le classement',
      scenario: { client: 'Fictif' }, grade: { traps: [] } }
  ];
  const campaign = { id: 'c-1', status: 'active', start_date: '2026-11-16', timezone: 'UTC',
    run_time: '07:00', days: 5, created_by: 'owner' };
  const writes = [];
  const deps = {
    now: () => new Date('2026-11-16T09:00:00Z'),
    driveReady: () => false,
    fetchRows: async (url, options) => {
      if (options?.method && options.method !== 'GET') writes.push(options.method);
      if (url.startsWith('office_training_campaigns?')) return [campaign];
      if (url.startsWith('office_training_cases?')) return cases;
      return [];
    }
  };
  const it = await getTraining('firm', { account: { role: 'it_admin' }, query: {} }, deps);
  const real = it.cases.find(c => c.kind === 'real');
  assert.equal(real.title, 'Cas réel — accès restreint');
  assert.equal(real.answer, null);
  assert.equal(real.drive_folder_id, null);
  assert.equal(real.grade, null);
  assert.equal(it.report.real_missions.seen, 1, 'IT sees aggregate metrics');
  assert.ok(!JSON.stringify(it).includes('REALCLIENTSECRET'), 'no client evidence anywhere in IT payload');
  const owner = await getTraining('firm', { account: { role: 'owner' }, query: {} }, deps);
  assert.equal(owner.cases.find(c => c.kind === 'real').answer, 'REALCLIENTSECRET');
  assert.deepEqual(writes, [], 'opening and refreshing training must never write');
});

test('global navigation and category hub are mounted on existing pages without replacing forms', () => {
  const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  for (const file of ['assets/workspace-navigation.js', 'assets/settings-hub.js', 'assets/brand-theme.js',
    'assets/firm-simulation.js', 'assets/audit-sandbox.js', 'assets/training-navigation.js']) {
    assert.doesNotThrow(() => new Script(read(file), { filename: file }), file);
  }
  const nav = read('assets/workspace-navigation.js');
  assert.match(nav, /history\.back\(\)/);
  assert.match(nav, /location\.reload\(\)/);
  assert.match(nav, /history\.forward\(\)/);
  assert.match(nav, /om-nav-compact/);
  assert.match(read('assets/brand-theme.js'), /\/assets\/workspace-navigation\.js/);
  assert.match(read('parametres.html'), /\/assets\/settings-hub\.js/);
  assert.match(read('assets/settings-hub.js'), /getElementById\('owner-area'\)/);
  assert.match(read('assets/app.css'), /om-settings-out\{display:none!important\}/);
});
