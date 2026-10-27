import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAccountingTopics, detectTopicsForRequest } from './topic-router.js';
import { buildProfessionalRequest } from './router.js';

test('machine purchase routes to PPE and purchases', () => {
  const topics = detectAccountingTopics({
    query: "L'entreprise achète une machine importante chez un fournisseur.",
    frameworks: ['SYSCOHADA'],
  });
  assert.ok(topics.includes('property_plant_equipment'));
  assert.ok(topics.includes('purchases_and_expenses'));
});

test('inventory and year-end language routes to inventory and closing', () => {
  const topics = detectAccountingTopics({
    query: 'A la clôture, le stock est obsolète et l inventaire présente des écarts.',
    frameworks: ['SYSCOHADA'],
  });
  assert.ok(topics.includes('inventories'));
  assert.ok(topics.includes('period_end_close'));
});

test('SYCEBNL framework prioritises not-for-profit topic', () => {
  const topics = detectAccountingTopics({
    query: 'Comment traiter une subvention reçue par une ONG ?',
    frameworks: ['SYCEBNL'],
  });
  assert.equal(topics[0], 'not_for_profit_specifics');
});

test('Firm Manager professional request exposes detected topics', () => {
  const request = buildProfessionalRequest({
    application: 'firm_manager',
    domains: ['accounting'],
    frameworks: ['SYSCOHADA'],
    query: 'Nous avons une facture non parvenue fournisseur à la clôture.',
  });
  assert.ok(request.topics.includes('payables'));
  assert.ok(request.topics.includes('period_end_close'));
});

test('non-accounting request does not invent accounting topics', () => {
  const topics = detectTopicsForRequest({
    domains: ['audit'],
    query: 'Assess fraud risk under ISA.',
    frameworks: ['ISA'],
  });
  assert.deepEqual(topics, []);
});
