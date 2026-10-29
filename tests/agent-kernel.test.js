import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KERNEL_WORK_STATE,
  authorizeKernelOrder,
  executeKernelOrders,
  runKernelStep
} from '../lib/agent-kernel.js';

test('kernel refuses an action that is not in the agent capability set', async () => {
  const result = await authorizeKernelOrder({ action: 'delete_everything', params: {}, why: 'synthetic' }, {});
  assert.equal(result.ok, false);
  assert.equal(result.work_state, KERNEL_WORK_STATE.REFUSED);
});

test('kernel keeps human-gated work proposed and does not execute it', async () => {
  let called = 0;
  const result = await executeKernelOrders({
    orders: [{ action: 'sign', params: { id: 'x' }, why: 'requires judgment' }],
    actions: {
      sign: {
        describe: 'professional sign-off',
        approval: true,
        run: async () => { called += 1; return { signed: true }; }
      }
    }
  });
  assert.equal(called, 0);
  assert.equal(result.proposed.length, 1);
  assert.equal(result.proposed[0].work_state, KERNEL_WORK_STATE.PROPOSED);
});

test('kernel separates executed from verified', async () => {
  const result = await executeKernelOrders({
    orders: [
      { action: 'unverified', params: {}, why: 'synthetic' },
      { action: 'verified', params: {}, why: 'synthetic' }
    ],
    actions: {
      unverified: {
        describe: 'execute only',
        run: async () => ({ done: true })
      },
      verified: {
        describe: 'execute then re-read',
        run: async () => ({ done: true, id: 'f1' }),
        verify: async (_params, result) => ({ ok: result.id === 'f1', observed: result.id })
      }
    }
  });
  assert.equal(result.done[0].work_state, KERNEL_WORK_STATE.EXECUTED_UNVERIFIED);
  assert.equal(result.done[1].work_state, KERNEL_WORK_STATE.VERIFIED);
  assert.equal(result.done[1].verification.observed, 'f1');
});

test('bounded kernel step follows observe -> remember -> decide -> act -> verify -> record -> next', async () => {
  const trace = [];
  const out = await runKernelStep({
    agent: 'synthetic-agent',
    objective: 'finish one synthetic task',
    state: { cursor: 1 },
    observe: async () => { trace.push('observe'); return { value: 10 }; },
    remember: async ({ observed }) => { trace.push('remember'); return { prior: observed.value - 1 }; },
    decide: async ({ observed, memory }) => {
      trace.push('decide');
      assert.equal(observed.value, 10);
      assert.equal(memory.prior, 9);
      return { orders: [{ action: 'write', params: { value: 10 }, why: 'synthetic' }] };
    },
    actions: {
      write: {
        describe: 'synthetic write',
        run: async params => { trace.push('act'); return { written: params.value }; },
        verify: async (_params, result) => { trace.push('verify'); return { ok: result.written === 10 }; }
      }
    },
    record: async snapshot => {
      trace.push('record');
      assert.equal(snapshot.done[0].work_state, KERNEL_WORK_STATE.VERIFIED);
    },
    next: async snapshot => {
      trace.push('next');
      return snapshot.done.every(x => x.work_state === KERNEL_WORK_STATE.VERIFIED)
        ? { status: 'verified', next: null }
        : { status: 'partial', next: 'retry' };
    }
  });

  assert.deepEqual(trace, ['observe', 'remember', 'decide', 'act', 'verify', 'record', 'next']);
  assert.equal(out.status, 'verified');
  assert.equal(out.next, null);
});

test('kernel never infers objective verification from successful execution alone', async () => {
  const out = await runKernelStep({
    agent: 'synthetic-agent',
    objective: 'synthetic',
    decide: async () => ({ orders: [{ action: 'write', params: {}, why: 'synthetic' }] }),
    actions: {
      write: { describe: 'write', run: async () => ({ ok: true }) }
    }
  });
  assert.equal(out.done[0].work_state, KERNEL_WORK_STATE.EXECUTED_UNVERIFIED);
  assert.equal(out.status, 'partial');
});
