import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeCycle, validationGaps, saveProgramme, validateProgramme, importProgramme, programmeView, codesInText } from '../lib/work-programme.js';

const M = '11111111-1111-1111-1111-111111111111';
const LIB = { status: 'ready', sops: [{ file_id: 'sopA', file_name: 'C02_ACH.docx', status: 'READ', cycle: { code: 'ACH', title: 'Achats' }, issues: [], procedures: [
  { code: 'ACH-01', title: 'Compréhension', type: 'CORE', level: 'Senior', sampling_mode: 'none' },
  { code: 'ACH-03', title: 'Test de détail', type: 'CORE', condition: 'si matériel', level: 'Junior', sampling_mode: 'programme_sample' },
  { code: 'ACH-08', title: 'Doublons', type: 'RISK_DEPENDENT', level: 'Senior', sampling_mode: 'programme_sample' },
  { code: 'ACH-13', title: 'Option', type: 'OPTIONAL', level: 'Junior', sampling_mode: 'none' }] }] };

// A tiny PostgREST in memory: missions, team, programmes.
function db() {
  const t = { programmes: [], posts: [] };
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_missions')) return [{ id: M, name: 'Projet X 2025' }];
    if (path.startsWith('office_mission_assignments')) return [{ staff_profile_id: 's1', mission_role: 'manager' }, { staff_profile_id: 's2', mission_role: 'auditeur' }];
    if (path.startsWith('office_staff_profiles')) return [{ id: 's1', full_name: 'Mia Manager', email: 'mia@c.ci' }, { id: 's2', full_name: 'Ali Auditeur', email: 'ali@c.ci' }];
    if (path.startsWith('office_work_programmes')) {
      if (o.method === 'POST') { const r = { id: 'p' + (t.programmes.length + 1), ...JSON.parse(o.body)[0] }; t.programmes.push(r); return [r]; }
      if (o.method === 'PATCH') {
        const id = /id=eq\.([^&]+)/.exec(path)[1]; const onlyDraft = path.includes('status=eq.draft');
        const r = t.programmes.find(x => x.id === id && (!onlyDraft || x.status === 'draft')); if (!r) return [];
        Object.assign(r, JSON.parse(o.body)); return [r];
      }
      return [...t.programmes].sort((a, b) => b.version - a.version);
    }
    return [];
  };
  return { t, fetchRows };
}
const mia = { role: 'manager', email: 'mia@c.ci' };
const deps = (x, extra = {}) => ({ fetchRows: x.fetchRows, methodology: async () => LIB, audit: async () => ({}), emit: async () => ({}), ...extra });

test('a new programme version inherits server-recorded workpaper IDs, never browser bindings', async () => {
  const x = db(), cycles = [proposeCycle(LIB.sops[0])];
  x.t.programmes.push({ id: 'p1', version: 1, status: 'validated', cycles,
    workpapers: [{ cycle_code: 'ACH', file_id: 'EXISTING', model: { id: 'MODEL' } }] });
  const r = await saveProgramme('org', M, { cycles, workpapers: [{ file_id: 'FORGED' }] }, mia, deps(x));
  assert.equal(r.programme.version, 2);
  assert.deepEqual(r.programme.workpapers, x.t.programmes[0].workpapers);
});

test('a cycle is proposed from the SOP: mandatory procedures ticked, risk-dependent and optional to decide', () => {
  const c = proposeCycle(LIB.sops[0]);
  assert.deepEqual(c.procedures.map(p => [p.code, p.active]), [['ACH-01', true], ['ACH-03', true], ['ACH-08', false], ['ACH-13', false]]);
  assert.equal(c.cycle_code, 'ACH');
});

test('validation lists everything that blocks: materiality, preparer, reasons, sample sizes, review levels', () => {
  const c = proposeCycle(LIB.sops[0]);
  c.procedures[0].active = false; c.procedures[2].active = true;
  const gaps = validationGaps({ materiality: {}, reviews: {}, cycles: [c] }).map(g => g.gap + (g.code ? ':' + g.code : ''));
  assert.deepEqual(gaps, ['MATERIALITY_REQUIRED', 'REVIEW_LEVEL_REQUIRED', 'CYCLE_PREPARER_REQUIRED', 'MANDATORY_OFF_NEEDS_REASON:ACH-01',
    'SAMPLE_SIZE_REQUIRED:ACH-03', 'RISK_DEPENDENT_NEEDS_REASON:ACH-08', 'SAMPLE_SIZE_REQUIRED:ACH-08']);
  assert.deepEqual(validationGaps({ materiality: { overall: 1 }, reviews: { manager: true }, cycles: [{ cycle_code: 'X', status: 'N/A_JUSTIFIED', justification: 'pas de stock', procedures: [] }] }), []);
});

test('the Manager saves a draft (codes checked against the library), validates it; a later change is a new version', async () => {
  const x = db(); let audited = null, emitted = null;
  await assert.rejects(saveProgramme('org', M, { cycles: [{ sop_file_id: 'unknown' }] }, mia, deps(x)), /SOP_NOT_IN_LIBRARY/);
  await assert.rejects(saveProgramme('org', M, {}, { role: 'auditor', email: 'ali@c.ci' }, deps(x)), /ROLE_NOT_ALLOWED/);
  await assert.rejects(saveProgramme('org', M, {}, { role: 'manager', email: 'other@c.ci' }, deps(x)), /NOT_ON_THIS_MISSION/);
  const body = { materiality: { overall: '12000000', performance: '9000000', trivial: '600000', file: 'https://docs.google.com/spreadsheets/d/MATERIALITEXXXXXXXXXXXXX/edit' }, reviews: { senior: true, manager: true, partner: false },
    cycles: [{ sop_file_id: 'sopA', preparer: 'ali@c.ci', procedures: [{ code: 'ACH-03', active: true, sample_size: 25 }, { code: 'ACH-08', active: true, justification: 'risque de double paiement relevé en revue analytique', sample_size: '40' }, { code: 'ACH-99', active: true }] }] };
  const s1 = await saveProgramme('org', M, body, mia, deps(x));
  assert.equal(s1.programme.version, 1); assert.equal(s1.programme.status, 'draft');
  assert.deepEqual(s1.gaps, []);
  assert.equal(s1.programme.materiality.file, 'MATERIALITEXXXXXXXXXXXXX');
  assert.ok(!s1.programme.cycles[0].procedures.some(p => p.code === 'ACH-99'), 'a code that is not in the SOP is never added');
  await saveProgramme('org', M, { ...body, reviews: { manager: true } }, mia, deps(x));
  assert.equal(x.t.programmes.length, 1, 'the draft is updated in place');
  await assert.rejects(validateProgramme('org', M, { role: 'supervisor', email: 'mia@c.ci' }, deps(x)), /ROLE_NOT_ALLOWED/);
  const v = await validateProgramme('org', M, mia, deps(x, { audit: async (o, e) => { audited = e; }, emit: async (o, e) => { emitted = e; } }));
  assert.equal(v.programme.status, 'validated'); assert.equal(v.programme.validated_by, 'mia@c.ci');
  assert.equal(audited.action_type, 'WORK_PROGRAMME_VALIDATED'); assert.equal(emitted.type, 'WORK_PROGRAMME_VALIDATED');
  await assert.rejects(validateProgramme('org', M, mia, deps(x)), /NO_DRAFT_TO_VALIDATE/);
  const s2 = await saveProgramme('org', M, body, mia, deps(x));
  assert.equal(s2.programme.version, 2, 'a change after validation = a new version');
  await validateProgramme('org', M, mia, deps(x));
  assert.deepEqual(x.t.programmes.map(p => [p.version, p.status]), [[1, 'superseded'], [2, 'validated']]);
  const view = await programmeView('org', M, mia, deps(x));
  assert.equal(view.programme.version, 2);
  assert.deepEqual(view.team.map(p => p.name), ['Mia Manager', 'Ali Auditeur']);
  assert.equal(view.library[0].procedures, 4);
});

test('an incomplete programme is not validated, and says why', async () => {
  const x = db();
  await saveProgramme('org', M, { cycles: [{ sop_file_id: 'sopA' }] }, mia, deps(x));
  await assert.rejects(validateProgramme('org', M, mia, deps(x)), e => e.message === 'PROGRAMME_INCOMPLETE' && e.gaps.some(g => g.gap === 'MATERIALITY_REQUIRED'));
});

test('import: the codes written in the Manager’s file are recognised by code, the unknown ones listed, nothing guessed', async () => {
  assert.deepEqual(codesInText('Cycle achats : ACH-03 (25 items), ach-08 ; voir aussi REV-02', LIB), { matched: [{ code: 'ACH-03', sop_file_id: 'sopA' }, { code: 'ACH-08', sop_file_id: 'sopA' }], unknown: ['REV-02'] });
  const x = db();
  const drive = { readText: async () => ({ text: 'Programme : ACH-03 test de détail ; ACH-08 doublons', file: { name: 'Programme.xlsx' } }) };
  const r = await importProgramme('org', M, { file: 'https://drive.google.com/file/d/PROGRAMMEXXXXXXXXXXXXXXXX/view' }, mia, deps(x, { drive }));
  assert.deepEqual(r.cycles[0].procedures.map(p => [p.code, p.active]), [['ACH-01', false], ['ACH-03', true], ['ACH-08', true], ['ACH-13', false]]);
  assert.equal(x.t.programmes.length, 0, 'nothing saved by the import itself');
  const none = { readText: async () => ({ text: 'Tester les achats.' }) };
  await assert.rejects(importProgramme('org', M, { file: 'PROGRAMMEXXXXXXXXXXXXXXXX' }, mia, deps(x, { drive: none })), /NO_PROCEDURE_CODE_IN_FILE/);
});
