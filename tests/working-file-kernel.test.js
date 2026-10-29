import test from 'node:test';
import assert from 'node:assert/strict';
import { KERNEL_STATUS } from '../lib/agent-kernel.js';
import { planWorkingFileStep, runWorkingFileStep } from '../lib/working-file-kernel.js';

test('Working File plan stays awaiting_human when a valid plan is ready', async () => {
  const result = await planWorkingFileStep('O', 'M', 'D1', { step: 1 }, { email: 'auditor@example.com' }, {
    planStep: async () => ({
      ready: true,
      operation: 'extract',
      step: { n: 1, text: 'Extraire le GL' },
      source_file_id: 'F1'
    })
  });

  assert.equal(result.ready, true);
  assert.equal(result.kernel_status, KERNEL_STATUS.AWAITING_HUMAN);
  assert.ok(result.kernel_questions.some(q => /Exécuter/.test(q)));
});

test('Working File run is verified only when the domain read-back says verified', async () => {
  const result = await runWorkingFileStep('O', 'M', 'D1', { plan: { operation: 'extract' } }, { email: 'auditor@example.com' }, {
    runStep: async () => ({
      sheet: 'D1_E1',
      verified: true,
      operation: 'extract',
      count: 12
    })
  });

  assert.equal(result.verified, true);
  assert.equal(result.kernel_status, KERNEL_STATUS.VERIFIED);
  assert.equal(result.kernel_verification.sheet, 'D1_E1');
});

test('Working File run cannot become verified when read-back fails', async () => {
  const result = await runWorkingFileStep('O', 'M', 'D1', { plan: { operation: 'extract' } }, { email: 'auditor@example.com' }, {
    runStep: async () => ({
      sheet: 'D1_E1',
      verified: false,
      operation: 'extract'
    })
  });

  assert.equal(result.verified, false);
  assert.equal(result.kernel_status, KERNEL_STATUS.BLOCKED);
  assert.equal(result.kernel_error.reason, 'WORKING_FILE_WRITE_NOT_VERIFIED');
});

test('Working File keeps the existing explicit confirmation error contract', async () => {
  const expected = Object.assign(new Error('PROPOSAL_CONFIRMATION_REQUIRED'), { statusCode: 409 });
  await assert.rejects(
    () => runWorkingFileStep('O', 'M', 'D1', { plan: { operation: 'document-review' } }, { email: 'auditor@example.com' }, {
      runStep: async () => { throw expected; }
    }),
    error => error === expected && error.statusCode === 409
  );
});
