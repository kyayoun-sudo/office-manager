import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateKnowledgeChunk } from './knowledge-contract.js';
import { detectAccountingTopics, detectAuditTopics, detectAdvisoryTopics } from './topic-router.js';

async function load(relative) {
  return JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
}

for (const [name, relative] of [
  ['IFRS methodology', './packs/ifrs/core/eynowa-accounting-methodology.json'],
  ['IFRS public metadata', './packs/ifrs/core/official-public-metadata.json'],
  ['Audit methodology', './packs/audit/core/eynowa-audit-methodology.json'],
  ['Audit public metadata', './packs/audit/core/official-public-metadata.json'],
  ['Advisory methodology', './packs/advisory/core/eynowa-advisory-methodology.json'],
  ['Advisory public metadata', './packs/advisory/core/official-public-metadata.json'],
]) {
  test(`${name} chunks satisfy the knowledge contract`, async () => {
    const chunks = await load(relative);
    assert.ok(chunks.length > 0);
    for (const chunk of chunks) assert.ok(validateKnowledgeChunk(chunk).sourceId);
  });
}

test('IFRS question routes to accounting topics', () => {
  const topics = detectAccountingTopics({
    frameworks: ['IFRS'],
    query: 'Analyse la reconnaissance du revenu, la dépréciation et les états financiers IFRS.',
  });
  assert.ok(topics.includes('sales_and_revenue'));
  assert.ok(topics.includes('financial_statements') || topics.includes('property_plant_equipment'));
});

test('ISA ISQM and IESBA questions route to audit topics', () => {
  const topics = detectAuditTopics({
    frameworks: ['ISA', 'ISQM', 'IESBA Code'],
    query: 'Vérifie indépendance, matérialité, risque de fraude et système de gestion de la qualité.',
  });
  assert.ok(topics.includes('acceptance_and_independence'));
  assert.ok(topics.includes('quality_management'));
  assert.ok(topics.includes('fraud') || topics.includes('planning_and_materiality'));
});

test('advisory question routes across valuation due diligence and sustainability', () => {
  const topics = detectAdvisoryTopics({
    frameworks: ['IVS', 'IFRS S1'],
    query: 'Prépare une due diligence, une valorisation IVS et une analyse de readiness IFRS S1 ESG.',
  });
  assert.ok(topics.includes('valuation'));
  assert.ok(topics.includes('sustainability_esg'));
  assert.ok(topics.includes('due_diligence'));
});
