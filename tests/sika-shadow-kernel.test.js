import test from 'node:test';
import assert from 'node:assert/strict';
import { runSikaKernel } from '../lib/sika-kernel.js';
import { runShadowKernel, KERNEL_STATUS } from '../lib/shadow-kernel.js';

test('Sika utilise le même kernel Office Manager avec son identité', async () => {
  const result = await runSikaKernel({ orgId: 'O', runId: 'R', message: 'Fais le point facturation' }, {
    runOfficeManager: async input => {
      assert.equal(input.requestedAgent, 'sika');
      return { text: 'Aucun impayé confirmé.', toolsUsed: ['read_billing_status'], provider: 'test' };
    },
    getRunToolEvents: async () => [{ tool_name: 'read_billing_status', phase: 'completed', metadata: {} }]
  });
  assert.equal(result.status, KERNEL_STATUS.VERIFIED);
});

test('Shadow est verified seulement quand son laboratoire confirme le passage', async () => {
  let lab = { last_run: null, last_observed_at: null, lessons: [], problems: [] };
  const result = await runShadowKernel('O', {
    now: new Date('2026-10-29T12:00:00.000Z'),
    loadLab: async () => lab,
    shadowPass: async () => {
      lab = { ...lab, last_run: '2026-10-29', last_observed_at: '2026-10-29T12:00:01.000Z' };
      return { signals: 3, added: 1, merged: 0 };
    }
  });
  assert.equal(result.status, KERNEL_STATUS.VERIFIED);
  assert.equal(result.verification.last_run, '2026-10-29');
});

test('Shadow ne prétend pas réussir si le laboratoire n’a pas persisté le passage', async () => {
  const lab = { last_run: null, last_observed_at: null, lessons: [], problems: [] };
  const result = await runShadowKernel('O', {
    now: new Date('2026-10-29T12:00:00.000Z'),
    loadLab: async () => lab,
    shadowPass: async () => ({ signals: 3, added: 1, merged: 0 })
  });
  assert.equal(result.status, KERNEL_STATUS.BLOCKED);
  assert.equal(result.error.reason, 'SHADOW_PASS_NOT_PERSISTED');
});
