import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCycleWorkpaper } from '../lib/cycle-workpapers.js';
import * as R from '../lib/procedure-review.js';
import { writeWorkpaper } from '../lib/procedure-work.js';
import { missionFunction, reviewAuthority, programmeAuthority, setMissionFunction } from '../lib/mission-function.js';

// Paul, 2026-10-19 (point 2): « une personne peut être superviseur sur une mission, manager sur une autre et coordinateur
// sur une troisième ». The function on the mission decides who reviews; signing still needs the qualified grade.

test('a supervisor is a supervisor, not a senior; an EQR is not the engagement partner', () => {
  assert.equal(missionFunction('Superviseur'), 'supervisor');
  assert.equal(missionFunction('Senior'), 'senior');
  assert.equal(missionFunction('Associé revue qualité'), 'quality_reviewer');
  assert.equal(missionFunction('Associé'), 'partner');
  assert.equal(missionFunction('Chef de mission'), 'manager');
});

// One person, Awa (grade manager), with a different function on three missions.
const awa = { role: 'manager', email: 'awa@c.ci', display_name: 'Awa' };
const kofi = { role: 'manager', email: 'kofi@c.ci', display_name: 'Kofi' };
const missionA = [{ email: 'awa@c.ci', mission_function: 'manager' }, { email: 'kofi@c.ci', mission_function: 'senior' }];
const missionB = [{ email: 'awa@c.ci', mission_function: 'senior' }, { email: 'kofi@c.ci', mission_function: 'manager' }];
const missionC = [{ email: 'awa@c.ci', mission_function: 'supervisor' }, { email: 'zoe@c.ci', mission_function: 'auditor' }];

test('the same person reviews at the level of her function on each mission', () => {
  // Mission A: she is the manager.
  assert.equal(reviewAuthority(awa, 'manager', missionA), null);
  assert.equal(reviewAuthority(kofi, 'manager', missionA), 'LEVEL_HELD_BY_OTHER', 'Kofi is manager by grade, senior here');
  assert.equal(reviewAuthority(kofi, 'senior', missionA), null);
  // Mission B: roles reversed.
  assert.equal(reviewAuthority(awa, 'manager', missionB), 'LEVEL_HELD_BY_OTHER');
  assert.equal(reviewAuthority(awa, 'senior', missionB), null);
  // Mission C: supervisor function; her grade (manager) is not assumed to be qualified for the supervisor level.
  assert.equal(reviewAuthority(awa, 'supervisor', missionC), 'NOT_QUALIFIED_FOR_LEVEL');
  // Nobody named manager on C: the grade decides, as before.
  assert.equal(reviewAuthority(awa, 'manager', missionC), null);
});

test('a function without the qualified grade never signs: an auditor named manager is told so', () => {
  const ali = { role: 'auditor', email: 'ali@c.ci' };
  const team = [{ email: 'ali@c.ci', mission_function: 'manager' }];
  assert.equal(reviewAuthority(ali, 'manager', team), 'NOT_QUALIFIED_FOR_LEVEL');
  assert.equal(reviewAuthority(ali, 'senior', team), 'NOT_THIS_REVIEW_LEVEL');
  // An ended assignment gives nothing.
  assert.equal(reviewAuthority(awa, 'manager', [{ email: 'awa@c.ci', mission_function: 'manager', status: 'completed' }, ...missionB.slice(1)]), 'LEVEL_HELD_BY_OTHER');
});

test('the programme: the grade still gates editing; the manager named on the mission validates', () => {
  const sena = { role: 'senior', email: 'sena@c.ci' };
  // A function never extends a right the grade does not have (security review, 2026-10-19).
  assert.equal(programmeAuthority(sena, [{ email: 'sena@c.ci', mission_function: 'supervisor' }], 'edit'), 'ROLE_NOT_ALLOWED');
  assert.equal(programmeAuthority(sena, [{ email: 'sena@c.ci', mission_function: 'supervisor' }], 'validate'), 'ROLE_NOT_ALLOWED');
  assert.equal(programmeAuthority({ role: 'supervisor', email: 'sup@c.ci' }, [{ email: 'sup@c.ci' }], 'edit'), null, 'as before');
  assert.equal(programmeAuthority(awa, missionA, 'validate'), null);
  assert.equal(programmeAuthority(awa, missionB, 'validate'), 'PROGRAMME_VALIDATED_BY_MISSION_MANAGER');
  assert.equal(programmeAuthority(awa, missionC, 'validate'), null, 'nobody named: the grade, as before');
  assert.equal(programmeAuthority({ role: 'partner', email: 'p@c.ci' }, missionB, 'validate'), null, 'firm partners keep their access');
});

// The real review chain, with the assignments read from the base.
const M = '22222222-2222-2222-2222-222222222222';
const cycle = { cycle_code: 'ACH', cycle_title: 'Achats', status: 'IN_SCOPE', preparer: 'ali@c.ci', procedures: [{ code: 'ACH-03', title: 'Test de détail', type: 'CORE', active: true, sampling_mode: 'programme_sample', sample_size: 2 }] };
const programme = { id: 'prog1', version: 1, status: 'validated', cycles: [cycle], reviews: { senior: false, manager: true }, materiality: {}, workpapers: [{ cycle_code: 'ACH', file_id: 'WP1' }] };
async function world(roles) {
  const t = { work: [{ id: 'w1', org_id: 'org', office_mission_id: M, programme_id: 'prog1', procedure_code: 'ACH-03', cycle_code: 'ACH', preparer: 'ali@c.ci', status: 'in_progress', items: [{ sample_id: 'S01', result: 'PASS' }], population: {}, reviews: [], review_points: [], wp_sync: {}, conclusion: 'ok' }],
    files: { WP1: { buf: await buildCycleWorkpaper({ firm: 'C', mission: { id: M, name: 'P' }, programme, cycle, procedures: cycle.procedures }), mt: 'm0' } },
    roles, audits: [] };
  const staff = [{ id: 'a', full_name: 'Ali', email: 'ali@c.ci' }, { id: 'w', full_name: 'Awa', email: 'awa@c.ci' }, { id: 'k', full_name: 'Kofi', email: 'kofi@c.ci' }];
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_work_programmes')) return [programme];
    if (path.startsWith('office_missions')) return [{ id: M, name: 'Projet' }];
    if (path.startsWith('office_mission_assignments')) {
      if (o.method === 'PATCH') { const id = decodeURIComponent(path.match(/id=eq\.([^&]+)$/)[1]); const b = JSON.parse(o.body); t.roles[id] = b.mission_function; t.set_by = b.mission_function_set_by; return []; }
      return Object.entries(t.roles).map(([id, fn]) => ({ id, staff_profile_id: id, mission_role: t.labels?.[id] || null, mission_function: fn, status: 'confirmed' }));
    }
    if (path.startsWith('office_staff_profiles')) return staff;
    if (path.startsWith('office_procedure_work')) {
      if (o.method === 'PATCH') { const r = t.work[0]; Object.assign(r, JSON.parse(o.body)); return [r]; }
      return t.work;
    }
    return [];
  };
  const drive = {
    getMeta: async id => ({ id, modifiedTime: t.files[id].mt, version: '7' }),
    downloadBuffer: async id => t.files[id].buf,
    updateBinary: async (id, { buffer, expectedModifiedTime }) => { if (expectedModifiedTime !== t.files[id].mt) throw new Error('MEMORY_CONFLICT'); t.files[id] = { buf: buffer, mt: 'm' + Math.random() }; }
  };
  const d = { fetchRows, drive, audit: async (org, e) => { t.audits.push(e); }, permissions: async () => ({ granted: true }), methodology: async () => ({ sops: [] }) };
  await writeWorkpaper('org', M, 'ACH-03', { role: 'auditor', email: 'ali@c.ci' }, d);
  t.work[0].status = 'submitted';
  return { t, d };
}

test('the manager review goes to the person named manager; changing the function moves the pending review, traced', async () => {
  const { t, d } = await world({ a: 'auditor', w: 'senior', k: 'manager' });
  const view = await R.reviewView('org', M, 'ACH-03', awa, d);
  assert.equal(view.me.may_review, false); assert.equal(view.me.why_not, 'LEVEL_HELD_BY_OTHER');
  assert.deepEqual(view.next_reviewers, ['Kofi']);
  assert.equal((await R.myReviews('org', kofi, d)).reviews.length, 1);
  assert.equal((await R.myReviews('org', awa, d)).reviews.length, 0);
  await assert.rejects(R.signOff('org', M, 'ACH-03', awa, d), /LEVEL_HELD_BY_OTHER/);

  // Nobody changes their own function; an auditor cannot change anyone's.
  await assert.rejects(setMissionFunction('org', { mission_id: M, assignment_id: 'k', function: 'senior' }, kofi, d), /NO_SELF_FUNCTION_CHANGE/);
  await assert.rejects(setMissionFunction('org', { mission_id: M, assignment_id: 'w', function: 'manager' }, { role: 'auditor', email: 'ali@c.ci' }, d), /MISSION_MANAGER_OR_PARTNER_REQUIRED/);
  // A partner of the firm swaps them: Awa becomes manager, Kofi senior.
  const partner = { role: 'partner', email: 'p@c.ci', display_name: 'Associé' };
  assert.equal((await setMissionFunction('org', { mission_id: M, assignment_id: 'w', function: 'manager' }, partner, d)).changed, true);
  await setMissionFunction('org', { mission_id: M, assignment_id: 'k', function: 'senior' }, partner, d);
  assert.deepEqual(t.audits.filter(e => e.action_type === 'MISSION_FUNCTION_CHANGED').map(e => e.decision), ['Awa : Senior → Manager', 'Kofi : Manager → Senior']);
  assert.equal(t.set_by, 'p@c.ci');
  // The pending review followed at once.
  assert.equal((await R.myReviews('org', awa, d)).reviews.length, 1);
  assert.equal((await R.myReviews('org', kofi, d)).reviews.length, 0);
  const signed = await R.signOff('org', M, 'ACH-03', awa, d);
  assert.equal(signed.all_signed, true);
});

test('a label typed by the person gives no right; only a partner of the firm gives or takes away Manager / Partner', async () => {
  // Ali (auditor) created a direct mission and typed « Associé » as his own role: a label, not a function.
  const { t, d } = await world({ a: null, w: 'senior', k: 'manager' });
  t.labels = { a: 'Associé' };
  const ali = { role: 'auditor', email: 'ali@c.ci' };
  await assert.rejects(setMissionFunction('org', { mission_id: M, assignment_id: 'w', function: 'auditor' }, ali, d), /MISSION_MANAGER_OR_PARTNER_REQUIRED/);
  // Kofi (manager grade, manager of the mission) changes other functions, never Manager / Partner.
  await assert.rejects(setMissionFunction('org', { mission_id: M, assignment_id: 'w', function: 'manager' }, kofi, d), /PARTNER_SETS_LEAD_FUNCTIONS/);
  await assert.rejects(setMissionFunction('org', { mission_id: M, assignment_id: 'a', function: 'partner' }, kofi, d), /PARTNER_SETS_LEAD_FUNCTIONS/);
  assert.equal((await setMissionFunction('org', { mission_id: M, assignment_id: 'w', function: 'supervisor' }, kofi, d)).changed, true);
  // A senior grade holding the manager function (set by a partner) still cannot change functions.
  const { d: d2 } = await world({ a: 'auditor', w: 'manager', k: 'senior' });
  await assert.rejects(setMissionFunction('org', { mission_id: M, assignment_id: 'a', function: 'senior' }, { role: 'senior', email: 'awa@c.ci' }, d2), /MISSION_MANAGER_OR_PARTNER_REQUIRED/);
  // Unknown values never reach the base.
  await assert.rejects(setMissionFunction('org', { mission_id: M, assignment_id: 'w', function: 'toString' }, { role: 'partner', email: 'p@c.ci' }, d), /UNKNOWN_MISSION_FUNCTION/);
});

test('without db/mission-functions.sql nothing changes and the reviews fall back to the grade', async () => {
  const fetchRows = async (path) => { if (path.includes('mission_function')) throw new Error('column office_mission_assignments.mission_function does not exist'); return []; };
  await assert.rejects(setMissionFunction('org', { mission_id: M, assignment_id: 'w', function: 'senior' }, { role: 'partner', email: 'p@c.ci' }, { fetchRows }), /MISSION_FUNCTION_SQL_NOT_INSTALLED/);
  assert.equal(reviewAuthority(awa, 'manager', [{ email: 'awa@c.ci', mission_role: 'Senior' }]), null, 'a label alone: the grade decides');
});

// Paul, 2026-10-19: « réglable par cabinet » — the supervisor above the manager (specification §29, default) or below it.
test('the firm chooses where the supervisor stands: order of the reviews and who is qualified follow', async () => {
  const { reviewHierarchy } = await import('../lib/mission-function.js');
  const above = reviewHierarchy(), below = reviewHierarchy('below_manager');
  assert.deepEqual(R.requiredLevels({ reviews: { senior: true, manager: true, supervisor: true, partner: true } }, above.order), ['senior', 'manager', 'supervisor', 'partner']);
  assert.deepEqual(R.requiredLevels({ reviews: { senior: true, manager: true, supervisor: true, partner: true } }, below.order), ['senior', 'supervisor', 'manager', 'partner']);
  // Awa (manager grade) holds the supervisor function on mission C.
  assert.equal(reviewAuthority(awa, 'supervisor', missionC, above), 'NOT_QUALIFIED_FOR_LEVEL', 'supervisor above: a manager is not qualified');
  assert.equal(reviewAuthority(awa, 'supervisor', missionC, below), null, 'supervisor below: a manager is qualified');
  const sup = { role: 'supervisor', email: 'sup@c.ci' }, team = [{ email: 'sup@c.ci', mission_function: 'manager' }];
  assert.equal(reviewAuthority(sup, 'manager', team, above), null, 'supervisor above: may hold the manager review');
  assert.equal(reviewAuthority(sup, 'manager', team, below), 'NOT_QUALIFIED_FOR_LEVEL');
  // Unknown or missing setting: the specification's order.
  assert.equal(reviewHierarchy('nonsense').position, 'above_manager');
});

test('the reviews of a procedure read the firm setting; changing it is refused unless known, and traced', async () => {
  const { t, d } = await world({ a: 'auditor', w: 'supervisor', k: 'manager' });
  const prog2 = { reviews: { manager: true, supervisor: true } };
  const settings = (pos) => async (path, o) => path.startsWith('office_firm_settings') ? [{ settings: { supervisor_position: pos } }]
    : path.startsWith('office_work_programmes') ? [{ ...programme, ...prog2 }] : d.fetchRows(path, o);
  const below = await R.reviewView('org', M, 'ACH-03', awa, { ...d, fetchRows: settings('below_manager') });
  assert.deepEqual(below.levels, ['supervisor', 'manager']); assert.equal(below.next, 'supervisor'); assert.equal(below.supervisor_position, 'below_manager');
  const above = await R.reviewView('org', M, 'ACH-03', awa, { ...d, fetchRows: settings('above_manager') });
  assert.deepEqual(above.levels, ['manager', 'supervisor']); assert.equal(above.next, 'manager');
  void t;
  const { saveFirmSettings } = await import('../lib/roles.js');
  const writes = [];
  // Like the database: the row has its version; a settings write returns the row it wrote (firm-settings-store).
  const fr = async (path, o) => { if (o?.method) { writes.push(path); return path.startsWith('office_firm_settings') ? [{ settings: JSON.parse(o.body).settings }] : []; } return path.startsWith('office_firm_settings?org_id') ? [{ settings: { supervisor_position: 'above_manager' }, updated_at: 'v1' }] : []; };
  await assert.rejects(saveFirmSettings('org', { supervisor_position: 'beside' }, 'p@c.ci', fr), /UNKNOWN_SUPERVISOR_POSITION/);
  const saved = await saveFirmSettings('org', { supervisor_position: 'below_manager' }, 'p@c.ci', fr);
  assert.equal(saved.supervisor_position, 'below_manager');
  assert.ok(writes.some(p => p.startsWith('office_audit_events')), 'the change is in the audit log');
});
