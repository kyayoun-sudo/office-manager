import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAccountingTopics } from './topic-router.js';
import { validateKnowledgeChunk } from './knowledge-contract.js';
import { sourcesFor } from './source-registry.js';

test('treasury close query detects cash and period-end close', () => {
  const topics = detectAccountingTopics({
    query: 'A la clôture le rapprochement bancaire contient des virements en transit, des chèques en circulation et un écart de caisse.',
    frameworks: ['SYSCOHADA'],
  });
  assert.ok(topics.includes('cash_and_banking'));
  assert.ok(topics.includes('period_end_close'));
});

test('foreign currency bank query detects cash and foreign currency', () => {
  const topics = detectAccountingTopics({
    query: 'Le compte bancaire en devise USD doit être rapproché et réévalué à la clôture.',
    frameworks: ['SYSCOHADA'],
  });
  assert.ok(topics.includes('cash_and_banking'));
  assert.ok(topics.includes('foreign_currency'));
});

test('EYNOWA audit method is registered as non-normative methodology', () => {
  const source = sourcesFor({ domain: 'audit', framework: 'Audit methodology' })
    .find((row) => row.sourceId === 'EYNOWA_AUDIT_METHOD');
  assert.ok(source);
  assert.equal(source.authorityRole, 'methodology_non_normative');
});

test('EYNOWA treasury accounting methodology chunk passes knowledge contract', () => {
  const chunk = validateKnowledgeChunk({
    source_id: 'EYNOWA_ACCOUNTING_METHOD',
    domain: 'accounting',
    framework: 'SYSCOHADA methodology',
    authority: 'EYNOWA',
    reference: 'TEST treasury accounting methodology',
    version: '1.0',
    effective_from: '2026-10-23',
    jurisdiction: 'Internal methodology',
    country: 'CI',
    source_url: 'https://github.com/kyayoun-sudo/office-manager',
    license_basis: 'EYNOWA_OWNED_INTERNAL_METHODOLOGY',
    content: 'Test-only treasury accounting methodology content.',
    metadata: {
      topic: 'cash_and_banking',
      source_kind: 'eynowa_methodology',
      normative_text: false,
      requires_normative_followup: true,
    },
  });
  assert.equal(chunk.sourceId, 'EYNOWA_ACCOUNTING_METHOD');
  assert.equal(chunk.metadata.topic, 'cash_and_banking');
});

test('EYNOWA treasury audit methodology chunk passes knowledge contract', () => {
  const chunk = validateKnowledgeChunk({
    source_id: 'EYNOWA_AUDIT_METHOD',
    domain: 'audit',
    framework: 'EYNOWA Audit Methodology',
    authority: 'EYNOWA',
    reference: 'TEST treasury audit methodology',
    version: '1.0',
    effective_from: '2026-10-23',
    jurisdiction: 'Internal methodology',
    country: 'CI',
    source_url: 'https://github.com/kyayoun-sudo/office-manager',
    license_basis: 'EYNOWA_OWNED_INTERNAL_METHODOLOGY',
    content: 'Test-only treasury audit methodology content.',
    metadata: {
      topic: 'cash_and_banking',
      source_kind: 'eynowa_audit_methodology',
      normative_text: false,
      requires_normative_followup: true,
    },
  });
  assert.equal(chunk.sourceId, 'EYNOWA_AUDIT_METHOD');
  assert.equal(chunk.domain, 'audit');
  assert.equal(chunk.metadata.normative_text, false);
});
