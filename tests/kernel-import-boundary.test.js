import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgentKernel, KERNEL_STATUS } from '../lib/agent-kernel.js';
import { think } from '../lib/agent-brain.js';
import {
  actionCatalog,
  executeKernelOrders,
  KERNEL_WORK_STATE
} from '../lib/kernel-actions.js';

test('kernel lifecycle, brain and action helpers import together without a circular export failure', () => {
  assert.equal(typeof runAgentKernel, 'function');
  assert.equal(typeof think, 'function');
  assert.equal(typeof actionCatalog, 'function');
  assert.equal(KERNEL_STATUS.VERIFIED, 'verified');
});

test('action helpers keep verified execution separate from approval proposals', async () => {
  const actions = {
    rename_clear_document: {
      describe: 'Rename a clearly identified document',
      run: async params => ({ name: params.name }),
      verify: async (_params, result) => ({ ok: result.name === 'invoice.pdf', observed_name: result.name })
    },
    professional_signoff: {
      describe: 'Professional sign-off',
      approval: true,
      run: async () => ({ signed: true })
    }
  };

  const catalog = actionCatalog(actions);
  assert.deepEqual(catalog, [
    { action: 'rename_clear_document', does: 'Rename a clearly identified document', needs_a_person_first: false },
    { action: 'professional_signoff', does: 'Professional sign-off', needs_a_person_first: true }
  ]);

  const result = await executeKernelOrders({
    actions,
    orders: [
      { action: 'rename_clear_document', params: { name: 'invoice.pdf' }, why: 'Document identity is clear' },
      { action: 'professional_signoff', params: {}, why: 'Professional judgment is required' }
    ]
  });

  assert.equal(result.done.length, 1);
  assert.equal(result.done[0].work_state, KERNEL_WORK_STATE.VERIFIED);
  assert.equal(result.proposed.length, 1);
  assert.equal(result.proposed[0].work_state, KERNEL_WORK_STATE.PROPOSED);
  assert.equal(result.refused.length, 0);
});
