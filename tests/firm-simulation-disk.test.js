import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SimulationDisk } from '../lib/firm-simulation-disk.js';
import { simulationPopulation, populationWorkbook, scanSimulationPopulation } from '../lib/firm-simulation-population.js';
import { evaluateSimulationScan } from '../lib/firm-simulation-evaluator.js';
import { readTable } from '../lib/procedure-work.js';

async function lab(t, options) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'office-simulation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const disk = new SimulationDisk(root);
  await disk.initialize(options);
  return disk;
}
test('atomic checkpoint, persisted artifact readback, resume without duplicate events and deterministic replay', async t => {
  const disk = await lab(t, { seed: 17 });
  await disk.run({ limit: 9 });
  const before = await disk.load();
  assert.equal(before.campaign.events.length, 9);
  for (const f of before.manifest.files) {
    const artifact = JSON.parse(await disk.readBlob(f.sha256));
    assert.match(artifact.label, /SIMULATION/);
    assert.ok(artifact.content.length > 10);
  }
  const restarted = new SimulationDisk(disk.root);
  const resumed = await restarted.run({ limit: 500 });
  const second = await lab(t, { seed: 17 });
  const replayed = await second.run({ limit: 500 });
  assert.deepEqual(resumed, replayed);
  assert.equal(new Set(resumed.events.map(e => e.id)).size, resumed.events.length);
  assert.ok((await readdir(path.join(disk.root, 'commits'))).length > 9);
});
test('budget pauses durably, costs remain zero and no Shadow quota is touched', async t => {
  const disk = await lab(t, { maxActions: 2 });
  const c = await disk.run({ limit: 10 });
  assert.equal(c.status, 'paused');
  assert.equal(c.blocker, 'SIMULATION_ACTION_BUDGET_REACHED');
  assert.equal(c.events.length, 2);
  assert.equal(c.disk_run.known_cost, 0);
  await disk.run({ limit: 10 });
  assert.equal((await disk.load()).campaign.events.length, 2);
});
test('year boundary pauses before Y2; resumed missions retain prior-year links', async t => {
  const disk = await lab(t);
  const first = await disk.run({ limit: 500, untilMonth: 12 });
  assert.equal(first.month, 12);
  assert.equal(first.status, 'paused');
  assert.ok(first.events.every(e => e.mission_id.startsWith('Y1')));
  const second = await disk.run({ limit: 500 });
  assert.equal(second.month, 24);
  assert.ok(second.events.some(e => e.mission_id.startsWith('Y2')));
  assert.ok(second.missions.filter(m => m.year === 2).every(m => m.previous_id));
});
test('uncommitted files do not move HEAD; concurrent writer and corrupted content fail closed', async t => {
  const disk = await lab(t);
  const head = await readFile(path.join(disk.root, 'HEAD'), 'utf8');
  await disk.put(Buffer.from('SIMULATION orphan before interrupted commit'));
  assert.equal(await readFile(path.join(disk.root, 'HEAD'), 'utf8'), head);
  await disk.exclusive(async () => { await assert.rejects(disk.run(), /SIMULATION_LOCKED/); });
  const { manifest } = await disk.load();
  await writeFile(path.join(disk.root, 'blobs', manifest.checkpoint), 'damaged');
  await assert.rejects(disk.load(), /SIMULATION_BLOB_CORRUPT/);
});
test('refuses a real directory, path traversal and invalid periods', async t => {
  const disk = await lab(t);
  await assert.rejects(disk.readBlob('../outside'), /INVALID_SIMULATION_DIGEST/);
  await assert.rejects(disk.run({ untilMonth: 25 }), /INVALID_RUN_LIMIT/);
  await assert.rejects(disk.initialize(), /MUST_BE_EMPTY/);
  const other = await mkdtemp(path.join(os.tmpdir(), 'not-simulation-'));
  t.after(() => rm(other, { recursive: true, force: true }));
  await assert.rejects(new SimulationDisk(other).load());
});
test('all 2400 GL lines read through production reader, balanced totals, targeted exceptions beyond row 100', async t => {
  const p = simulationPopulation({ seed: 5 });
  const disk = await lab(t);
  const digest = await disk.put(await populationWorkbook(p));
  const table = await readTable('SIMULATED', { getMeta: async () => ({ mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), downloadBuffer: () => disk.readBlob(digest) });
  assert.equal(table.header_row, 1);
  const lines = table.rows.slice(table.header_row + 1);
  assert.equal(lines.length, 2400);
  assert.equal(lines.at(-1)[0], 'SIM-2027-1200');
  assert.equal(lines.reduce((sum, row) => sum + row[3], 0), p.balance[0].debit);
  const report = scanSimulationPopulation(p);
  assert.equal(report.automated_rows_checked, 2400);
  assert.equal(report.debit, report.credit);
  assert.deepEqual(report.findings.map(f => f.kind).sort(), ['cutoff', 'invalid_date', 'invoice_gl_difference']);
  assert.ok(report.findings.find(f => f.kind === 'invalid_date').row > 100);
  assert.equal(evaluateSimulationScan({ seed: 5, year: 2027 }, report).passed, true);
  const bad = { ...report, automated_rows_checked: 100, findings: report.findings.slice(1) };
  const evaluation = evaluateSimulationScan({ seed: 5, year: 2027 }, bad);
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.missed.length, 1);
  assert.equal(evaluation.full_population_claim_supported_by_count, false);
  assert.equal(report.evidence_examined, 0);
  assert.equal(report.selection.statistical_extrapolation, false);
  assert.deepEqual(p, simulationPopulation({ seed: 5 }));
  assert.notDeepEqual(p, simulationPopulation({ seed: 6 }));
  const y2 = simulationPopulation({ seed: 5, year: 2028 });
  assert.equal(scanSimulationPopulation(y2).findings.find(f => f.kind === 'invoice_gl_difference').difference, 17000);
  p.balance[0].debit++;
  assert.ok(scanSimulationPopulation(p).findings.some(f => f.kind === 'trial_balance_difference'));
});
