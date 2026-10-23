import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { detectAccountingTopics } from './topic-router.js';
import { validateKnowledgeChunk } from './knowledge-contract.js';

const accountingFile = new URL('./packs/ohada/core-final/eynowa-accounting-methodology.json', import.meta.url);
const auditFile = new URL('./packs/ohada/core-final/eynowa-audit-methodology.json', import.meta.url);
const publicFile = new URL('./packs/ohada/core-final/official-public-guidance.json', import.meta.url);

async function load(url) {
  return JSON.parse(await fs.readFile(url, 'utf8'));
}

test('final OHADA core accounting chunks satisfy the knowledge contract', async () => {
  const rows = await load(accountingFile);
  assert.ok(rows.length >= 15);
  for (const row of rows) assert.ok(validateKnowledgeChunk(row).sourceId);
});

test('final OHADA core audit chunks satisfy the knowledge contract', async () => {
  const rows = await load(auditFile);
  assert.ok(rows.length >= 8);
  for (const row of rows) assert.equal(validateKnowledgeChunk(row).domain, 'audit');
});

test('final OHADA public guidance chunks satisfy the knowledge contract', async () => {
  const rows = await load(publicFile);
  assert.ok(rows.length >= 4);
  for (const row of rows) assert.ok(validateKnowledgeChunk(row).sourceId);
});

test('borrowings and covenant query routes to financing', () => {
  const topics = detectAccountingTopics({ query: 'Emprunt bancaire avec covenant non respecté et waiver à la clôture.' });
  assert.ok(topics.includes('borrowings_and_financing'));
  assert.ok(topics.includes('period_end_close'));
});

test('payroll query routes to employee costs', () => {
  const topics = detectAccountingTopics({ query: 'Rapprocher le journal de paie, les primes et les charges sociales.' });
  assert.ok(topics.includes('payroll_and_employee_costs'));
});

test('tax query routes to taxes and levies', () => {
  const topics = detectAccountingTopics({ query: 'Contrôle fiscal, TVA, retenue à la source et redressement fiscal.' });
  assert.ok(topics.includes('taxes_and_levies'));
});

test('foreign currency query routes to FX', () => {
  const topics = detectAccountingTopics({ query: 'Réévaluation des comptes en devises au cours de clôture et écarts de change.' });
  assert.ok(topics.includes('foreign_currency'));
});

test('equity query routes to equity', () => {
  const topics = detectAccountingTopics({ query: 'Affectation du résultat, dividendes et augmentation de capital.' });
  assert.ok(topics.includes('equity'));
});

test('financial statement query routes to financial statements', () => {
  const topics = detectAccountingTopics({ query: 'Mapping de la balance vers les états financiers et revue des annexes.' });
  assert.ok(topics.includes('financial_statements'));
});

test('group query routes to consolidated accounts', () => {
  const topics = detectAccountingTopics({ query: 'Périmètre de consolidation, filiales et éliminations intercompagnies.' });
  assert.ok(topics.includes('consolidated_and_combined_accounts'));
});

test('SYCEBNL donor query routes to nonprofit specifics', () => {
  const topics = detectAccountingTopics({
    query: 'Rapprocher les fonds affectés du bailleur, le registre des donateurs et le reporting projet.',
    frameworks: ['SYCEBNL'],
  });
  assert.ok(topics.includes('not_for_profit_specifics'));
});
