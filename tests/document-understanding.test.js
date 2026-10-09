import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInspection } from '../lib/document-inspector.js';
import { understandDocuments, validateDocumentProfile } from '../lib/document-understanding.js';

const scope = { organization_id: 'org-a', memory_folder_id: 'memory-a' };
const inspection = () => normalizeInspection({ id: 'invoice' }, 'ALPHA SARL\nInvoice INV-2026-091\n30 September 2026\nTotal €4,250', { scope });
test('understanding keeps exact evidence and rejects invented entities and pages', () => {
  const result = validateDocumentProfile(inspection(), { facts: [
    { field: 'organizations', value: 'ALPHA SARL', quote: 'ALPHA SARL', chunk_sequence: 1, page: 88 },
    { field: 'organizations', value: 'BETA', quote: 'ALPHA SARL', chunk_sequence: 1 },
    { field: 'reference_numbers', value: 'INV-2026-091', quote: 'Invoice INV-2026-091', chunk_sequence: 1 },
    { field: 'document_type', value: 'INVOICE', quote: 'Invoice INV-2026-091', chunk_sequence: 1 }
  ] });
  assert.deepEqual(result.entities, ['ALPHA SARL']); assert.equal(result.type, 'INVOICE');
  assert.equal(result.rejected_fact_count, 1); assert.equal(result.facts[0].evidence.location.page, undefined);
  assert.equal(result.overall_confidence, null); assert.equal(result.facts[2].interpretation, true);
  assert.ok(!JSON.stringify(result).includes('"quote"'));
});
test('invalid quotes, chunks and action fields do not become facts', () => {
  const p = validateDocumentProfile(inspection(), { facts: [
    { field: 'dates', value: '2030-01-01', quote: '2030-01-01', chunk_sequence: 1 },
    { field: 'organizations', value: 'ALPHA SARL', quote: 'ALPHA SARL', chunk_sequence: 2 },
    { field: 'destination', value: '/Invoices', quote: 'Invoice', chunk_sequence: 1 }
  ] });
  assert.equal(p.status, 'UNKNOWN'); assert.equal(p.rejected_fact_count, 3);
});
test('partial coverage remains partial after supported understanding', () => {
  const i = inspection(); i.status = 'PARTIAL';
  assert.equal(validateDocumentProfile(i, { facts: [{ field: 'document_type', value: 'INVOICE', quote: 'Invoice', chunk_sequence: 1 }] }).coverage, 'PARTIAL');
});
test('batch excludes another organization before sending any content to AI', async () => {
  const other = normalizeInspection({ id: 'other' }, 'foreign confidential content', { scope: { organization_id: 'org-b', memory_folder_id: 'memory-b' } });
  let input;
  const results = await understandDocuments([inspection(), other], { scope, analyze: async opts => { input = opts.input; return { text: '{"profiles":[{"document_id":"invoice","facts":[{"field":"organizations","value":"ALPHA SARL","quote":"ALPHA SARL","chunk_sequence":1}]}]}' }; } });
  assert.ok(!input.includes('foreign')); assert.equal(results.length, 1); assert.deepEqual(results[0].entities, ['ALPHA SARL']);
});
test('same organization with different connection or memory is also isolated', async () => {
  const i = inspection(); i.scope.connection_id = 'other-connection'; let calls = 0;
  assert.deepEqual(await understandDocuments([i], { scope, analyze: async () => { calls++; } }), []);
  assert.equal(calls, 0);
});
test('AI failures remain explicit and duplicate candidate IDs cannot override one another', async () => {
  const failed = await understandDocuments([inspection()], { scope, analyze: async () => { throw new Error('failure'); } });
  assert.equal(failed[0].status, 'UNDERSTANDING_FAILED');
  const duplicates = await understandDocuments([inspection()], { scope, analyze: async () => ({ text: '{"profiles":[{"document_id":"invoice","facts":[]},{"document_id":"invoice","facts":[]}]}' }) });
  assert.equal(duplicates[0].status, 'UNKNOWN');
});
test('scope is mandatory, unreadable input does not invoke AI', async () => {
  await assert.rejects(() => understandDocuments([inspection()]), /SCOPE_REQUIRED/);
  const i = normalizeInspection({ id: 'blank' }, '', { scope }); let called = false;
  const p = await understandDocuments([i], { scope, analyze: async () => { called = true; } });
  assert.equal(called, false); assert.equal(p[0].status, 'UNKNOWN');
});
