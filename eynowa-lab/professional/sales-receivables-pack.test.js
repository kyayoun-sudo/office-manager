import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAccountingTopics } from './topic-router.js';
import { validateKnowledgeChunk } from './knowledge-contract.js';
import { sourcesFor } from './source-registry.js';

test('sales close query detects sales, receivables and period-end close', () => {
  const topics = detectAccountingTopics({
    query: 'A la clôture nous avons des factures avant livraison, des avoirs après clôture, des encaissements postérieurs et plusieurs soldes clients créditeurs.',
    frameworks: ['SYSCOHADA'],
  });
  assert.ok(topics.includes('sales_and_revenue'));
  assert.ok(topics.includes('receivables'));
  assert.ok(topics.includes('period_end_close'));
});

test('EYNOWA sales methodology remains non-normative', () => {
  const source = sourcesFor({ domain: 'accounting', framework: 'SYSCOHADA' })
    .find((row) => row.sourceId === 'EYNOWA_ACCOUNTING_METHOD');
  assert.ok(source);
  assert.equal(source.authorityRole, 'methodology_non_normative');
});

test('sales methodology chunk requires normative follow-up', () => {
  const chunk = validateKnowledgeChunk({
    source_id: 'EYNOWA_ACCOUNTING_METHOD',
    domain: 'accounting',
    framework: 'SYSCOHADA methodology',
    authority: 'EYNOWA',
    reference: 'TEST sales methodology',
    version: '1.0',
    effective_from: '2026-10-23',
    jurisdiction: 'Internal methodology',
    country: 'CI',
    source_url: 'https://github.com/kyayoun-sudo/office-manager',
    license_basis: 'EYNOWA_OWNED_INTERNAL_METHODOLOGY',
    content: 'Test-only sales methodology content.',
    metadata: {
      topic: 'sales_and_revenue',
      source_kind: 'eynowa_methodology',
      normative_text: false,
      requires_normative_followup: true,
    },
  });
  assert.equal(chunk.sourceId, 'EYNOWA_ACCOUNTING_METHOD');
  assert.equal(chunk.metadata.normative_text, false);
  assert.equal(chunk.metadata.requires_normative_followup, true);
});

test('OHADA ISA implementation guidance is registered for audit', () => {
  const source = sourcesFor({ domain: 'audit', framework: 'ISA' })
    .find((row) => row.sourceId === 'OHADA_ISA_IMPLEMENTATION_TOOLS');
  assert.ok(source);
  assert.equal(source.authority, 'CNC-OHADA / OHADA');
});
