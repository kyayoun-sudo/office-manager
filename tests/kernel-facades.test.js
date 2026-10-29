import test from 'node:test';
import assert from 'node:assert/strict';
import { tidyStepRoute } from '../lib/tidy-plan.js';
import { auditorStepRoute } from '../lib/enhanced-auditor.js';

test('Orpailleur real app call uses kernel even when api/app asks noLoop', () => {
  assert.equal(tidyStepRoute({}), 'kernel');
  assert.equal(tidyStepRoute({ noLoop: true }), 'kernel');
});

test('Orpailleur dependency-injected low-level calls keep raw domain engine', () => {
  assert.equal(tidyStepRoute({ fetchRows: async () => [] }), 'domain');
  assert.equal(tidyStepRoute({ drive: {} }), 'domain');
  assert.equal(tidyStepRoute({ kernelBypass: true }), 'domain');
});

test('Enhanced Auditor real auditor-step call uses kernel', () => {
  assert.equal(auditorStepRoute({}), 'kernel');
});

test('Enhanced Auditor dependency-injected tests keep raw domain engine', () => {
  assert.equal(auditorStepRoute({ fetchRows: async () => [] }), 'domain');
  assert.equal(auditorStepRoute({ drive: {} }), 'domain');
});
