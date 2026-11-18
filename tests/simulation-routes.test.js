import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../api/app.js', import.meta.url), 'utf8');

test('the simulation route exists, needs several firms and a personal session', () => {
  const i = app.indexOf('  simulation: {');
  assert.ok(i > 0, 'route simulation declared');
  const block = app.slice(i, i + 1600);
  assert.match(block, /CABINETS_NOT_ENABLED/);
  assert.match(block, /sessionUser/);
  assert.match(block, /createSimulation/);
  assert.match(block, /archiveSimulation/);
});

test('the firm type is primed right after the firm of the request is fixed (signed internal calls included)', () => {
  const j = app.indexOf('await resolveRequestOrg(req');
  assert.ok(j > 0);
  assert.match(app.slice(j, j + 500), /primeOrgKind\(orgId\)/);
});

test('the scheduler skips simulation firms', () => {
  const k = app.indexOf("'scheduler-tick'");
  const block = app.slice(k, k + 1200);
  assert.match(block, /account_kind/);
  assert.match(block, /simulation/);
});
