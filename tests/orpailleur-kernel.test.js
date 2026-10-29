import test from 'node:test';
import assert from 'node:assert/strict';
import { KERNEL_STATUS, runOrpailleurKernel } from '../lib/orpailleur-kernel.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('Orpailleur traite plusieurs lots et le kernel ne termine qu’après relecture status=done', async () => {
  let state = {
    status: 'planning', total: 2, done: 0, moves: 0, renames: 0, questions: 0, ok: 0, asked: {}
  };
  let steps = 0;

  const result = await runOrpailleurKernel('O', {}, {
    maxCycles: 5,
    status: async () => clone(state),
    step: async () => {
      steps += 1;
      state.done += 1;
      state.ok += 1;
      if (state.done >= state.total) state.status = 'done';
      return { status: state.status, done: state.done };
    }
  });

  assert.equal(result.status, KERNEL_STATUS.VERIFIED);
  assert.equal(result.cycle, 2);
  assert.equal(steps, 2);
  assert.equal(result.verification.state.done, 2);
});

test('Orpailleur s’arrête en awaiting_human lorsqu’une vraie question de classement reste ouverte', async () => {
  let state = {
    status: 'planning', total: 1, done: 0, moves: 0, renames: 0, questions: 0, ok: 0, asked: {}
  };

  const result = await runOrpailleurKernel('O', {}, {
    status: async () => clone(state),
    step: async () => {
      state = {
        ...state,
        status: 'done', done: 1, questions: 1,
        asked: { F1: { status: 'open', question: 'À quelle mission appartient ce document ?' } }
      };
      return { status: 'done' };
    }
  });

  assert.equal(result.status, KERNEL_STATUS.AWAITING_HUMAN);
  assert.match(result.questions[0], /quelle mission/i);
});

test('Orpailleur ne transforme jamais un passage failed en réussite', async () => {
  let stepCalled = false;
  const result = await runOrpailleurKernel('O', {}, {
    status: async () => ({ status: 'failed', last_error: 'DRIVE_READ_FAILED' }),
    step: async () => { stepCalled = true; }
  });

  assert.equal(result.status, KERNEL_STATUS.BLOCKED);
  assert.equal(result.error.reason, 'OBSERVATION_BLOCKED');
  assert.equal(stepCalled, false);
});

test('un lecteur Drive occupé bloque explicitement le kernel au lieu de prétendre avoir travaillé', async () => {
  const state = { status: 'planning', total: 1, done: 0, asked: {} };
  const result = await runOrpailleurKernel('O', {}, {
    status: async () => clone(state),
    step: async () => ({ status: 'reader_busy', retryable: true })
  });

  assert.equal(result.status, KERNEL_STATUS.BLOCKED);
  assert.equal(result.error.reason, 'ORPAILLEUR_READER_BUSY');
});
