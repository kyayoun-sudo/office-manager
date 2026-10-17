import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';
import { SimulationDisk } from '../lib/firm-simulation-disk.js';
import { buildCycleWorkpaper } from '../lib/cycle-workpapers.js';
import * as P from '../lib/procedure-work.js';
import * as R from '../lib/procedure-review.js';

// Production business functions, isolated repository fixture and real disk-backed XLSX.
// No SQL writes outside this fixture, no provider calls, no production approvals.
test('real procedure services: disk WP written/read, submitted, returned, corrected, resubmitted; outsider denied', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'simulation-wp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const disk = new SimulationDisk(root); await disk.initialize();
  const junior = { email: 'junior@simulation.invalid', role: 'auditor' };
  const senior = { email: 'senior@simulation.invalid', role: 'senior' };
  const outside = { email: 'outside@simulation.invalid', role: 'manager' };
  const cycle = { cycle_code: 'ACH', cycle_title: 'SIMULATION', preparer: junior.email, procedures: [{ code: 'ACH-03', title: 'SIMULATION test', active: true, sampling_mode: 'none' }] };
  const programme = { id: 'simulation-programme', version: 1, status: 'validated', cycles: [cycle], reviews: { senior: true }, materiality: {}, workpapers: [{ cycle_code: 'ACH', file_id: 'SIM-WP' }] };
  const card = { code: 'ACH-03', title: 'SIMULATION', objective: 'Vérifier une facture fictive', steps: [{ text: 'Rapprocher la source' }], wp_columns: ['Sample ID / Référence', 'Date', 'Tiers', 'Montant', 'Pièce / source', 'Résultat PASS/EXCEPTION', 'Écart', 'Commentaire'], conclusion_template: 'SIMULATION' };
  let digest = await disk.put(await buildCycleWorkpaper({ firm: 'SIMULATION', mission: { id: 'SIM-MISSION', name: 'SIMULATION' }, programme, cycle, procedures: [card] }));
  let work = { id: 'SIM-WORK', org_id: 'SIM-ORG', programme_id: programme.id, office_mission_id: 'SIM-MISSION', procedure_code: 'ACH-03', cycle_code: 'ACH', preparer: junior.email, status: 'in_progress', items: [], conclusion: null, reviews: [], review_points: [], wp_sync: {} };
  const audit = [];
  const fetchRows = async (query, options = {}) => {
    if (query.startsWith('office_work_programmes')) return [structuredClone(programme)];
    if (query.startsWith('office_missions')) return [{ id: 'SIM-MISSION', name: 'SIMULATION' }];
    if (query.startsWith('office_mission_assignments')) return [{ staff_profile_id: 'j' }, { staff_profile_id: 's' }];
    if (query.startsWith('office_staff_profiles')) return [{ id: 'j', email: junior.email }, { id: 's', email: senior.email }];
    if (query.startsWith('office_procedure_work')) {
      if (options.method === 'PATCH') {
        work = { ...work, ...JSON.parse(options.body) };
        const saved = await disk.put(Buffer.from(JSON.stringify({ label: 'SIMULATION', ...work })));
        work = JSON.parse(await disk.readBlob(saved));
      }
      return [structuredClone(work)];
    }
    throw new Error('UNEXPECTED_FIXTURE_QUERY');
  };
  const drive = {
    getMeta: async id => { assert.equal(id, 'SIM-WP'); return { id, modifiedTime: digest }; },
    downloadBuffer: async id => { assert.equal(id, 'SIM-WP'); return disk.readBlob(digest); },
    updateBinary: async (id, { buffer, expectedModifiedTime }) => { assert.equal(id, 'SIM-WP'); assert.equal(expectedModifiedTime, digest); digest = await disk.put(buffer); }
  };
  const d = { fetchRows, drive, audit: async (_org, event) => { audit.push(event); } };
  const args = ['SIM-ORG', 'SIM-MISSION', 'ACH-03'];
  await assert.rejects(P.saveConclusion(...args, { conclusion: 'intrusion' }, outside, d), /NOT_YOUR_PROCEDURE/);
  await P.saveConclusion(...args, { conclusion: 'SIMULATION — pièce encore ambiguë, contrôle à compléter.' }, junior, d);
  await P.writeWorkpaper(...args, junior, d);
  assert.equal(work.wp_sync.verified, true);
  await P.submitProcedure(...args, junior, d);
  await assert.rejects(R.returnToPreparer(...args, { points: ['test'] }, outside, d), /NOT_THIS_REVIEW_LEVEL/);
  await R.returnToPreparer(...args, { points: ['Justifier la conclusion par la pièce.'] }, senior, d);
  assert.equal(work.status, 'returned');
  const old = digest;
  await P.saveConclusion(...args, { conclusion: 'SIMULATION — facture fictive SIM-2027-1 rapprochée au GL. Limite : test ciblé, pas une opinion.' }, junior, d);
  await R.answerPoint(...args, { id: 'RP01', response: 'Référence SIM-2027-1 ajoutée ; contrôle ciblé documenté.' }, junior, d);
  await P.writeWorkpaper(...args, junior, d);
  await P.submitProcedure(...args, junior, d);
  assert.notEqual(digest, old);
  assert.equal(work.status, 'submitted');
  assert.equal(work.review_points[0].status, 'answered');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await disk.readBlob(digest));
  const text = []; wb.getWorksheet('ACH-03').eachRow(row => text.push(JSON.stringify(row.values)));
  assert.match(text.join('\n'), /SIM-2027-1/);
  assert.ok(audit.some(e => e.action_type === 'REVIEW_POINTS_RAISED'));
  assert.ok(audit.filter(e => e.action_type === 'PROCEDURE_SUBMITTED').length === 2);
  assert.ok((await disk.readBlob(old)).length > 1000, 'old XLSX is retained');
});
