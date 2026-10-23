import test from 'node:test';
import assert from 'node:assert/strict';
import { validateKnowledgeChunk } from './knowledge-contract.js';
import { evaluateValidation } from './validation-gate.js';

const METHOD_CHUNK = {
  source_id: 'EYNOWA_ACCOUNTING_METHOD',
  domain: 'accounting',
  framework: 'SYSCOHADA methodology',
  authority: 'EYNOWA',
  reference: 'EYNOWA Accounting Methodology — Stocks / Analytics',
  version: '2026.1',
  effective_from: '2026-10-23',
  jurisdiction: 'Internal methodology',
  country: 'CI',
  source_url: 'https://github.com/kyayoun-sudo/office-manager/tree/feat/eynowa-lab-professional-brains/eynowa-lab/professional/packs/ohada/stocks',
  license_basis: 'EYNOWA_OWNED_INTERNAL_METHODOLOGY',
  content: 'Test methodology for inventory analytics.',
};

test('EYNOWA stocks methodology is a valid registered knowledge source', () => {
  const chunk = validateKnowledgeChunk(METHOD_CHUNK);
  assert.equal(chunk.sourceId, 'EYNOWA_ACCOUNTING_METHOD');
  assert.equal(chunk.domain, 'accounting');
});

test('methodology-only support still requires professional validation', () => {
  const result = evaluateValidation({
    domains: ['accounting'],
    answer: 'Proposed stock treatment.',
    sources: [{
      sourceId: 'EYNOWA_ACCOUNTING_METHOD',
      authority: 'EYNOWA',
      supportRole: 'methodology_non_normative',
    }],
    confidence: 0.95,
  });
  assert.equal(result.requiresValidation, true);
  assert.match(result.reasons.join(' '), /méthodologie EYNOWA non normative/i);
});
