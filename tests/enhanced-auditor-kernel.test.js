import test from 'node:test';
import assert from 'node:assert/strict';
import { KERNEL_STATUS, runEnhancedAuditorKernel } from '../lib/enhanced-auditor-kernel.js';

test('Enhanced Auditor avance étape par étape puis devient verified seulement avec ses livrables', async () => {
  let state = { status: 'running', stage: 'collect', analytical_review: false, evidence_files: [], knowledge: { processed: 0, total: 0 } };
  const stages = ['execute', 'risks', 'pictures', 'coverage', 'report', 'done'];
  let i = 0;
  const result = await runEnhancedAuditorKernel('O', {}, '11111111-1111-1111-1111-111111111111', {
    state: async () => state,
    step: async () => {
      const next = stages[i++];
      state = { ...state, stage: next, status: next === 'done' ? 'done' : 'running' };
      if (next === 'done') state = { ...state, report: { id: 'R' }, matrix: { id: 'M' }, coverage: [{ risk_id: 'R1' }] };
      return state;
    },
    maxCycles: 10
  });
  assert.equal(result.status, KERNEL_STATUS.VERIFIED);
  assert.equal(result.verification.state.report, true);
  assert.equal(result.verification.state.matrix, true);
  assert.ok(result.trace.length >= 2, 'le kernel doit continuer au-delà d’une seule étape');
});

test('Enhanced Auditor attend une personne quand des pièces manquent', async () => {
  const state = { status: 'needs_documents', stage: 'done', analytical_review: true, missing_documents: ['Balance N-1', 'Budget'], evidence_files: [] };
  const result = await runEnhancedAuditorKernel('O', {}, '11111111-1111-1111-1111-111111111111', {
    state: async () => state,
    step: async () => { throw new Error('ne doit pas être appelé'); }
  });
  assert.equal(result.status, KERNEL_STATUS.AWAITING_HUMAN);
  assert.deepEqual(result.questions, ['Balance N-1', 'Budget']);
});

test('Enhanced Auditor refuse une fausse fin si le rapport final manque', async () => {
  const state = { status: 'done', stage: 'done', analytical_review: false, matrix: { id: 'M' }, evidence_files: [] };
  const result = await runEnhancedAuditorKernel('O', {}, '11111111-1111-1111-1111-111111111111', {
    state: async () => state,
    step: async () => state
  });
  assert.equal(result.status, KERNEL_STATUS.BLOCKED);
  assert.equal(result.error.reason, 'ENHANCED_AUDITOR_OUTPUT_NOT_VERIFIED');
});

test('Enhanced Auditor reste blocked si son moteur métier a échoué', async () => {
  const state = { status: 'failed', stage: 'coverage', error: 'NO_MODEL_ANSWERED', evidence_files: [] };
  const result = await runEnhancedAuditorKernel('O', {}, '11111111-1111-1111-1111-111111111111', {
    state: async () => state,
    step: async () => state
  });
  assert.equal(result.status, KERNEL_STATUS.BLOCKED);
  assert.equal(result.error.reason, 'OBSERVATION_BLOCKED');
});
