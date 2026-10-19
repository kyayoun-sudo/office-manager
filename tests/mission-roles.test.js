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
const missionA = [{ email: 'awa@c.ci', mission_role: 'Manager' }, { email: 'kofi@c.ci', mission_role: 'Senior' }];
const missionB = [{ email: 'awa@c.ci', mission_role: 'Senior' }, { email: 'kofi@c.ci', mission_role: 'Manager' }];
const missionC = [{ email: 'awa@c.ci', mission_role: 'Superviseur' }, { email: 'zoe@c.ci', mission_role: 'Auditeur' }];

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
  const team = [{ email: 'ali@c.ci', mission_role: 'Manager' }];
  assert.equal(reviewAuthority(ali, 'manager', team), 'NOT_QUALIFIED_FOR_LEVEL');
  assert.equal(reviewAuthority(ali, 'senior', team), 'NOT_THIS_REVIEW_LEVEL');
  // An ended assignment gives nothing.
  assert.equal(reviewAuthority(awa, 'manager', [{ email: 'awa@c.ci', mission_role: 'Manager', status: 'completed' }, ...missionB.slice(1)]), 'LEVEL_HELD_BY_OTHER');
});

test('the programme: edited by the mission manager / supervisor, validated by the manager named on the mission', () => {
  const sena = { role: 'senior', email: 'sena@c.ci' };
  assert.equal(programmeAuthority(sena, [{ email: 'sena@c.ci', mission_role: 'Superviseur' }], 'edit'), null, 'supervisor function edits');
  assert.equal(programmeAuthority(sena, [{ email: 'sena@c.ci', mission_role: 'Superviseur' }], 'validate'), 'ROLE_NOT_ALLOWED', 'validating needs the grade');
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
      if (o.method === 'PATCH') { const id = decodeURIComponent(path.match(/id=eq\.([^&]+)$/)[1]); t.roles[id] = JSON.parse(o.body).mission_role; return []; }
      return Object.entries(t.roles).map(([id, mission_role]) => ({ id, staff_profile_id: id, mission_role, status: 'confirmed' }));
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
  const { t, d } = await world({ a: 'Auditeur', w: 'Senior', k: 'Manager' });
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
  assert.deepEqual(t.audits.filter(e => e.action_type === 'MISSION_FUNCTION_CHANGED').map(e => e.decision), ['Awa : « Senior » → « Manager »', 'Kofi : « Manager » → « Senior »']);
  // The pending review followed at once.
  assert.equal((await R.myReviews('org', awa, d)).reviews.length, 1);
  assert.equal((await R.myReviews('org', kofi, d)).reviews.length, 0);
  const signed = await R.signOff('org', M, 'ACH-03', awa, d);
  assert.equal(signed.all_signed, true);
});
