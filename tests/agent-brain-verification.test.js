import test from 'node:test';
import assert from 'node:assert/strict';
import { think } from '../lib/agent-brain.js';

const decision = action => ({
  provider: 'test',
  text: JSON.stringify({
    understanding: 'synthetic decision',
    orders: [{ action, params: { id: 'x' }, why: 'synthetic reason' }],
    notes: [],
    close: [],
    questions: []
  })
});

test('an executed action without verifier is never reported as verified', async () => {
  const out = await think({
    orgId: 'org-test',
    agent: 'orpailleur',
    task: 'synthetic',
    actions: {
      move: {
        describe: 'synthetic move',
        run: async () => ({ moved: true })
      }
    }
  }, { ai: async () => decision('move') });

  assert.equal(out.done.length, 1);
  assert.equal(out.done[0].work_state, 'executed_unverified');
  assert.equal(out.done[0].verification, null);
});

test('an action is verified only after its verifier confirms the postcondition', async () => {
  const out = await think({
    orgId: 'org-test',
    agent: 'orpailleur',
    task: 'synthetic',
    actions: {
      move: {
        describe: 'synthetic move',
        run: async () => ({ moved: true, file_id: 'f1' }),
        verify: async (_params, result) => ({ ok: result.moved === true, observed_file_id: result.file_id })
      }
    }
  }, { ai: async () => decision('move') });

  assert.equal(out.done.length, 1);
  assert.equal(out.done[0].work_state, 'verified');
  assert.equal(out.done[0].verification.ok, true);
  assert.equal(out.done[0].verification.observed_file_id, 'f1');
});

test('verification failure does not erase the fact that the action executed', async () => {
  const out = await think({
    orgId: 'org-test',
    agent: 'orpailleur',
    task: 'synthetic',
    actions: {
      move: {
        describe: 'synthetic move',
        run: async () => ({ moved: true }),
        verify: async () => ({ ok: false, why: 'destination mismatch' })
      }
    }
  }, { ai: async () => decision('move') });

  assert.equal(out.done.length, 1);
  assert.equal(out.done[0].work_state, 'executed_unverified');
  assert.equal(out.done[0].verification.ok, false);
  assert.equal(out.refused.length, 0);
});
