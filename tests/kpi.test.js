import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { personKpis, teamKpisFrom, coordinationFrom, myKpis } from '../lib/kpi.js';
import { currentAccount, requireRole, _clearAuthCache } from '../lib/user-auth.js';
import { ROUTES, handleApp } from '../api/app.js';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const D = n => new Date(NOW + n * 86400000).toISOString();
const staff = [
  { id: 'S1', full_name: 'Yannick KONAN', email: 'yannick@taty.info', weekly_capacity_hours: 40 },
  { id: 'S2', full_name: 'Auriane KOFFI', email: 'auriane@taty.info' }
];
const missions = [{ id: 'M1', name: 'Nova Services', status: 'active', planned_end: D(5) }, { id: 'M2', name: 'BLE', status: 'closed' }];
const assignments = [
  { staff_profile_id: 'S1', office_mission_id: 'M1', allocation_pct: 80, planned_start: D(-30), planned_end: D(30), status: 'confirmed' },
  { staff_profile_id: 'S1', office_mission_id: 'M3', allocation_pct: 40, planned_start: D(-5), planned_end: D(10), status: 'confirmed' },
  { staff_profile_id: 'S2', office_mission_id: 'M1', allocation_pct: 50, planned_start: D(-30), planned_end: D(-1), status: 'confirmed' }
];
const actions = [
  { id: 'A1', assigned_staff_profile_id: 'S1', office_mission_id: 'M1', summary: 'Relance PBC', due_at: D(-3), requested_at: D(-10), status: 'proposed' },
  { id: 'A2', assigned_staff_profile_id: 'S1', office_mission_id: 'M1', summary: 'Feuille Ventes', due_at: D(-2), requested_at: D(-8), executed_at: D(-4), status: 'approved' },
  { id: 'A3', assigned_staff_profile_id: 'S1', office_mission_id: 'M1', summary: 'Revue', due_at: D(-6), requested_at: D(-12), executed_at: D(-5), verified_at: D(-5), status: 'approved' },
  { id: 'A4', assigned_staff_profile_id: null, office_mission_id: 'M1', summary: 'Rapprochement', due_at: D(2), status: 'approved' },
  { id: 'A4b', assigned_staff_profile_id: null, office_mission_id: 'M1', summary: 'Proposition encore à valider', due_at: D(2), status: 'proposed' },
  { id: 'A4c', assigned_staff_profile_id: null, office_mission_id: 'M1', summary: 'Classer une pièce', status: 'approved', action_type: 'REVIEW_FILE' },
  { id: 'A5', assigned_staff_profile_id: 'S1', summary: 'Annulée', due_at: D(-20), status: 'rejected' }
];

test('kpi: facts only — load, late, on time, cycle time, verified', () => {
  const p = personKpis(staff[0], assignments, actions, NOW);
  assert.equal(p.load_pct, 120);
  assert.equal(p.missions_active, 2);
  assert.equal(p.actions_open, 1);
  assert.equal(p.actions_overdue, 1);
  assert.equal(p.actions_done, 2);
  assert.equal(p.on_time_rate, 50, 'A2 on time, A3 late');
  assert.equal(p.avg_cycle_days, 5.5);
  assert.equal(p.verified_rate, 50);
  assert.ok(p.signals.some(s => /Surcharge/.test(s.text)));
  const a = personKpis(staff[1], assignments, actions, NOW);
  assert.equal(a.load_pct, 0, 'finished assignment no longer counts');
  assert.equal(a.on_time_rate, null, 'not measurable is shown as not measurable, never as 0');
  assert.ok(a.coverage.some(c => /Aucune action assignée/.test(c)));
});

test('kpi: team view has no score and no ranking; method is explicit', () => {
  const t = teamKpisFrom({ staff, assignments, actions }, NOW);
  assert.deepEqual(t.people.map(p => p.name), ['Auriane KOFFI', 'Yannick KONAN'], 'alphabetical, not ranked');
  assert.ok(t.people.every(p => !('score' in p) && !('rank' in p)));
  assert.match(t.method, /jamais une décision automatique/);
  assert.equal(t.team.overloaded, 1);
});

test('coordination: missions at risk, late and unassigned actions', () => {
  const c = coordinationFrom({ missions, staff, assignments, actions }, NOW);
  assert.equal(c.totals.missions_live, 1, 'closed missions are left out');
  assert.equal(c.missions[0].overdue_actions, 1);
  assert.equal(c.overdue[0].assignee, 'Yannick KONAN');
  assert.equal(c.overdue[0].days_late, 3);
  assert.equal(c.unassigned[0].summary, 'Rapprochement');
  // 2026-10-08: a proposal waits in « À valider », work done by the agents needs no person.
  assert.equal(c.unassigned.length, 1);
});

test('my kpi: linked by e-mail only', async () => {
  const fetchRows = async path => path.startsWith('office_staff_profiles') ? staff : path.startsWith('office_mission_assignments') ? assignments : path.startsWith('office_action_queue') ? actions : missions;
  const me = await myKpis('org-1', { email: 'YANNICK@taty.info' }, fetchRows);
  assert.equal(me.linked, true);
  assert.equal(me.name, 'Yannick KONAN');
  const nobody = await myKpis('org-1', { email: 'x@taty.info' }, fetchRows);
  assert.equal(nobody.linked, false);
});

test('security: sensitive routes need a personal session and the right role', async () => {
  _clearAuthCache();
  process.env.DEFAULT_ORG_ID = 'org-1';
  const tok = 'a'.repeat(40);
  const deps = role => ({ supabaseUser: async () => ({ id: 'U1' }), fetchRows: async () => [{ auth_user_id: 'U1', email: 'y@taty.info', role, active: true }] });
  await assert.rejects(currentAccount({ headers: {} }), /USER_SESSION_REQUIRED/);
  await assert.rejects(requireRole({ headers: { authorization: 'Bearer ' + tok } }, ['manager'], deps('collaborator')), /ROLE_NOT_ALLOWED/);
  _clearAuthCache();
  const acc = await requireRole({ headers: { authorization: 'Bearer ' + tok } }, ['manager'], deps('manager'));
  assert.equal(acc.role, 'manager');
  _clearAuthCache();
  await assert.rejects(currentAccount({ headers: { authorization: 'Bearer ' + tok } }, { supabaseUser: async () => null }), /TOKEN_EXPIRED/);
  _clearAuthCache();
  await assert.rejects(currentAccount({ headers: { authorization: 'Bearer ' + tok } }, { supabaseUser: async () => ({ id: 'U1' }), fetchRows: async () => [{ role: 'manager', active: false }] }), /ACCOUNT_NOT_ALLOWED/);
  assert.deepEqual(ROUTES['team-kpi'].GET.userRoles, ['owner', 'partner', 'manager']);
  assert.deepEqual(ROUTES.coordination.GET.userRoles, ['owner', 'partner', 'manager']);
  assert.ok(ROUTES['my-kpi'].GET.userRoles.includes('collaborator'));
  process.env.OFFICE_MANAGER_ACCESS_TOKEN = 'pilot';
  await assert.rejects(handleApp({ method: 'GET', query: { route: 'team-kpi' }, headers: { 'x-office-manager-token': 'pilot' } }), /USER_SESSION_REQUIRED/, 'the shared code alone is not enough');
});

test('security headers and the team screen', () => {
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const h = Object.fromEntries(v.headers[0].headers.map(x => [x.key, x.value]));
  assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.match(h['Content-Security-Policy'], /object-src 'none'/);
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  const page = readFileSync(new URL('../equipe.html', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(page));
  assert.match(page, /journal de sécurité/);
  assert.match(readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8'), /\[hidden\]\{display:none !important\}/);
});
