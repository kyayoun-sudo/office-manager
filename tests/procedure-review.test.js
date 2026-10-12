import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildCycleWorkpaper } from '../lib/cycle-workpapers.js';
import * as R from '../lib/procedure-review.js';

const M = '11111111-1111-1111-1111-111111111111';
const cycle = { cycle_code: 'ACH', cycle_title: 'Achats', status: 'IN_SCOPE', preparer: 'ali@c.ci', procedures: [{ code: 'ACH-03', title: 'Test de détail', type: 'CORE', active: true, sampling_mode: 'programme_sample', sample_size: 2 }] };
const programme = { id: 'prog1', version: 1, status: 'validated', cycles: [cycle], reviews: { senior: true, manager: true, partner: false }, materiality: {}, workpapers: [{ cycle_code: 'ACH', file_id: 'WP1' }] };
const people = { ali: { role: 'auditor', email: 'ali@c.ci' }, sam: { role: 'senior', email: 'sam@c.ci', display_name: 'Sam' }, mia: { role: 'manager', email: 'mia@c.ci', display_name: 'Mia' }, out: { role: 'manager', email: 'out@c.ci' } };

async function world() {
  const t = { work: [{ id: 'w1', org_id: 'org', office_mission_id: M, programme_id: 'prog1', procedure_code: 'ACH-03', cycle_code: 'ACH', preparer: 'ali@c.ci', status: 'submitted', items: [{ sample_id: 'S01', result: 'PASS' }], population: {}, reviews: [], review_points: [], wp_sync: {}, conclusion: 'ok' }],
    files: { WP1: { buf: await buildCycleWorkpaper({ firm: 'C', mission: { id: M, name: 'P' }, programme, cycle, procedures: cycle.procedures }), mt: 'm0' } } };
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_work_programmes')) return [programme];
    if (path.startsWith('office_missions')) return [{ id: M, name: 'Projet' }];
    if (path.startsWith('office_mission_assignments')) return [{ staff_profile_id: 'a' }, { staff_profile_id: 's' }, { staff_profile_id: 'm' }];
    if (path.startsWith('office_staff_profiles')) return [{ id: 'a', full_name: 'Ali', email: 'ali@c.ci' }, { id: 's', full_name: 'Sam', email: 'sam@c.ci' }, { id: 'm', full_name: 'Mia', email: 'mia@c.ci' }];
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
  return { t, d: { fetchRows, drive, audit: async () => ({}), permissions: async () => ({ granted: true }), methodology: async () => ({ sops: [] }) } };
}
async function editSheet(t, fn) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.files.WP1.buf); fn(wb.getWorksheet('ACH-03')); t.files.WP1.buf = Buffer.from(await wb.xlsx.writeBuffer()); t.files.WP1.mt = 'edited'; }

test('only the levels the mission requires, in order; nobody reviews their own work; a manager outside the mission cannot', async () => {
  const { t, d } = await world();
  assert.deepEqual(R.requiredLevels(programme), ['senior', 'manager']);
  await assert.rejects(R.signOff('org', M, 'ACH-03', people.mia, d), /NOT_THIS_REVIEW_LEVEL/, 'the Senior first');
  await assert.rejects(R.signOff('org', M, 'ACH-03', { role: 'senior', email: 'ali@c.ci' }, d), /NO_SELF_REVIEW/);
  const v = await R.reviewView('org', M, 'ACH-03', people.sam, d);
  assert.equal(v.next, 'senior'); assert.equal(v.me.may_review, true);
  const s1 = await R.signOff('org', M, 'ACH-03', people.sam, d);
  assert.equal(s1.next, 'manager'); assert.equal(t.work[0].status, 'submitted'); assert.match(t.work[0].reviews[0].hash, /^[0-9a-f]{64}$/);
  await assert.rejects(R.signOff('org', M, 'ACH-03', people.out, d), /NOT_ON_THIS_MISSION/);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.files.WP1.buf);
  let line = null; wb.getWorksheet('ACH-03').eachRow(r => { if (/^Revu par/.test(String(r.getCell(1).value))) line = String(r.getCell(2).value); });
  assert.match(line, /^Senior : Sam le \d{4}-\d{2}-\d{2}$/, 'the signature is written in the sheet');
  const mine = await R.myReviews('org', people.mia, d);
  assert.deepEqual(mine.reviews.map(x => [x.code, x.level]), [['ACH-03', 'manager']]);
});

test('review points: back to the preparer, answered, cleared; no signature with an open point', async () => {
  const { t, d } = await world();
  await R.signOff('org', M, 'ACH-03', people.sam, d);
  await assert.rejects(R.returnToPreparer('org', M, 'ACH-03', { points: [] }, people.mia, d), /REVIEW_POINT_REQUIRED/);
  await R.returnToPreparer('org', M, 'ACH-03', { points: ['S01 : la pièce ne montre pas le visa'], severity: 'majeur' }, people.mia, d);
  assert.equal(t.work[0].status, 'returned');
  await assert.rejects(R.answerPoint('org', M, 'ACH-03', { id: 'RP01', response: 'x' }, people.sam, d), /ONLY_THE_PREPARER_ANSWERS/);
  await R.answerPoint('org', M, 'ACH-03', { id: 'RP01', response: 'Visa ajouté : bon de commande signé, pièce ACH-03_S01_bc.pdf' }, people.ali, d);
  t.work[0].status = 'submitted';
  await assert.rejects(R.signOff('org', M, 'ACH-03', people.mia, d), /OPEN_REVIEW_POINTS/);
  await R.clearPoint('org', M, 'ACH-03', { id: 'RP01' }, people.mia, d);
  const s = await R.signOff('org', M, 'ACH-03', people.mia, d);
  assert.equal(s.all_signed, true); assert.equal(t.work[0].status, 'reviewed');
  await assert.rejects(R.signOff('org', M, 'ACH-03', people.mia, d), /ALREADY_REVIEWED/);
});

test('a change in the sheet after a signature is seen, and that signature no longer holds at the next one', async () => {
  const { t, d } = await world();
  await R.signOff('org', M, 'ACH-03', people.sam, d);
  assert.equal((await R.reviewView('org', M, 'ACH-03', people.mia, d)).changed_after_signoff, false, 'writing the signature line does not count as a change');
  await editSheet(t, ws => { ws.getRow(30).getCell(3).value = 'modifié après la revue'; });
  assert.equal((await R.reviewView('org', M, 'ACH-03', people.mia, d)).changed_after_signoff, true);
  await R.signOff('org', M, 'ACH-03', people.mia, d);
  const senior = t.work[0].reviews.find(r => r.level === 'senior');
  assert.equal(senior.revoked, true); assert.equal(senior.revoked_reason, 'MODIFIED_AFTER_SIGNOFF');
  assert.equal(t.work[0].status, 'submitted', 'the Senior must sign again');
});

test('the Enhanced Auditor reviews for the reviewer’s role (proposals only); without AI the review stays manual', async () => {
  const { d } = await world();
  let seen = null;
  const r = await R.aiReview('org', M, 'ACH-03', people.sam, { ...d, ai: async (o, a) => { seen = JSON.parse(a.input); return { text: '{"summary":"1 point","points":[{"text":"S01 : attribut non vérifié","severity":"mineur","ref":"S01"}],"ready_to_sign":false}' }; } });
  assert.equal(seen.role, 'Senior'); assert.match(seen.focus, /Revue de détail/);
  assert.equal(r.points.length, 1); assert.equal(r.ready_to_sign, false);
  assert.equal((await R.aiReview('org', M, 'ACH-03', people.sam, { ...d, ai: async () => { throw new Error('down'); } })).ai, 'unavailable');
  await assert.rejects(R.aiReview('org', M, 'ACH-03', people.ali, d), /NOT_THIS_REVIEW_LEVEL/);
});
