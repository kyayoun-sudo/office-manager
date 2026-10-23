import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAccountingTopics } from './topic-router.js';
import { validateKnowledgeChunk } from './knowledge-contract.js';
import { sourcesFor } from './source-registry.js';

test('provisions close query detects provisions and period-end close', () => {
  const topics = detectAccountingTopics({
    query: 'A la clôture nous avons une provision pour litige, une charge à payer et un passif éventuel avec estimation incertaine.',
    frameworks: ['SYSCOHADA'],
  });
  assert.ok(topics.includes('provisions_and_contingencies'));
  assert.ok(topics.includes('period_end_close'));
});

test('litigation query detects provisions topic', () => {
  const topics = detectAccountingTopics({
    query: 'Le conseil juridique nous informe d un procès et d une réclamation importante.',
    frameworks: ['SYSCOHADA'],
  });
  assert.ok(topics.includes('provisions_and_contingencies'));
});

test('EYNOWA audit method remains non-normative', () => {
  const source = sourcesFor({ domain: 'audit', framework: 'Audit methodology' })
    .find((row) => row.sourceId === 'EYNOWA_AUDIT_METHOD');
  assert.ok(source);
  assert.equal(source.authorityRole, 'methodology_non_normative');
});

test('EYNOWA provision methodology requires normative follow-up', () => {
  const chunk = validateKnowledgeChunk({
    source_id: 'EYNOWA_ACCOUNTING_METHOD',
    domain: 'accounting',
    framework: 'SYSCOHADA methodology',
    authority: 'EYNOWA',
    reference: 'TEST provisions methodology',
    version: '1.0',
    effective_from: '2026-10-23',
    jurisdiction: 'Internal methodology',
    country: 'CI',
    source_url: 'https://github.com/kyayoun-sudo/office-manager',
    license_basis: 'EYNOWA_OWNED_INTERNAL_METHODOLOGY',
    content: 'Test-only provision methodology content.',
    metadata: {
      topic: 'provisions_and_contingencies',
      source_kind: 'eynowa_methodology',
      normative_text: false,
      requires_normative_followup: true,
    },
  });
  assert.equal(chunk.metadata.requires_normative_followup, true);
});
