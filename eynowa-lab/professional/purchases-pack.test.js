import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAccountingTopics } from './topic-router.js';
import { validateKnowledgeChunk } from './knowledge-contract.js';
import { sourcesFor } from './source-registry.js';

test('purchase close query detects payables, purchases and period-end close', () => {
  const topics = detectAccountingTopics({
    query: 'A la clôture nous avons des FNP, des soldes GR/IR et des réceptions non facturées chez plusieurs fournisseurs.',
    frameworks: ['SYSCOHADA'],
  });
  assert.ok(topics.includes('payables'));
  assert.ok(topics.includes('purchases_and_expenses'));
  assert.ok(topics.includes('period_end_close'));
});

test('EYNOWA accounting method is registered as non-normative methodology', () => {
  const source = sourcesFor({ domain: 'accounting', framework: 'SYSCOHADA' })
    .find((row) => row.sourceId === 'EYNOWA_ACCOUNTING_METHOD');
  assert.ok(source);
  assert.equal(source.authorityRole, 'methodology_non_normative');
});

test('EYNOWA purchase methodology chunk passes knowledge contract with explicit ownership basis', () => {
  const chunk = validateKnowledgeChunk({
    source_id: 'EYNOWA_ACCOUNTING_METHOD',
    domain: 'accounting',
    framework: 'SYSCOHADA methodology',
    authority: 'EYNOWA',
    reference: 'TEST purchases methodology',
    version: '1.0',
    effective_from: '2026-10-23',
    jurisdiction: 'Internal methodology',
    country: 'CI',
    source_url: 'https://github.com/kyayoun-sudo/office-manager',
    license_basis: 'EYNOWA_OWNED_INTERNAL_METHODOLOGY',
    content: 'Test-only EYNOWA methodology content.',
    metadata: {
      topic: 'payables',
      source_kind: 'eynowa_methodology',
      normative_text: false,
      requires_normative_followup: true,
    },
  });
  assert.equal(chunk.sourceId, 'EYNOWA_ACCOUNTING_METHOD');
  assert.equal(chunk.metadata.normative_text, false);
  assert.equal(chunk.metadata.requires_normative_followup, true);
});
