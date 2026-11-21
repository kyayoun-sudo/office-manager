// EYNOWA Lab contract v1: scoped application keys, knowledge search, scoped memory, task with verified provenance.
// Engines are replaced by test doubles here; tests/lab-gateway-process.test.js runs the real server process.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadClients, identify, knowledgeSearch, memorySearchScoped, memoryRemember, runTask, handleV1 } from '../lib/lab-v1.js';

const hash = k => crypto.createHash('sha256').update(k).digest('hex');
const KEY = 'accounting-key-' + 'x'.repeat(40);
const clientsJson = JSON.stringify([{ id: 'accounting-ai', key_sha256: hash(KEY), tenants: ['acme-ci'], knowledge: ['syscohada'], can_remember: true },
  { id: 'office-manager', key_sha256: hash('om-key-' + 'y'.repeat(40)), tenants: ['taty'], knowledge: ['syscohada', 'isa'] }]);
const clients = loadClients({ EYNOWA_LAB_CLIENTS_FILE: 'x' }, () => clientsJson);
const accounting = clients[0];
const knowledge = [
  { id: 'syscohada', kind: 'chroma', name: 'syscohada_v2017', authority: 'normative', domain: 'syscohada', version: 'AUDCIF révisé 2017', effective_from: '2018-01-01', effective_until: null, text_field: 'text', ref_fields: [] },
  { id: 'isa', kind: 'meilisearch', name: 'isa', authority: 'normative', domain: 'audit', version: '2026', effective_from: null, effective_until: null, text_field: 'text', ref_fields: ['ref'] }
];
const chromaResult = (ids, docs, metas = []) => ({ result: { ids: [ids], documents: [docs], metadatas: [metas], distances: [ids.map((_, i) => i * 0.1)] } });

test('application keys are matched by hash; legacy key keeps historical routes only', async () => {
  assert.equal(identify({ headers: { authorization: 'Bearer ' + KEY } }, clients, 'legacy-secret').id, 'accounting-ai');
  assert.equal(identify({ headers: { authorization: 'Bearer wrong' } }, clients, 'legacy-secret'), null);
  const legacy = identify({ headers: { 'x-eynowa-api-key': 'legacy-secret' } }, clients, 'legacy-secret');
  assert.equal(legacy.legacy, true);
  await assert.rejects(handleV1({ method: 'GET' }, '/v1/capabilities', legacy, {}), /V1_REQUIRES_APPLICATION_KEY/);
  assert.throws(() => loadClients({ EYNOWA_LAB_CLIENTS_FILE: 'x' }, () => '[{"id":"a","key_sha256":"short","tenants":["t"]}]'), /LAB_CLIENTS_INVALID/);
});

test('knowledge search returns passages with stable ids and refuses sources outside the key scope', async () => {
  const seen = [];
  const r = await knowledgeSearch(accounting, { query: 'immobilisation corporelle coût d’acquisition' }, { knowledge,
    semanticMemorySearch: async args => { seen.push(args); return chromaResult(['d1', 'd2'], ['Les immobilisations corporelles sont évaluées au coût d’acquisition.', ''], [{ page: 12 }]); } });
  assert.equal(seen[0].collection, 'syscohada_v2017');
  assert.equal(r.passages.length, 1);
  assert.match(r.passages[0].passage_id, /^P-[a-f0-9]{16}$/);
  assert.equal(r.passages[0].authority, 'normative');
  await assert.rejects(knowledgeSearch(accounting, { query: 'q', sources: ['isa'] }, { knowledge }), /KNOWLEDGE_SOURCE_NOT_ALLOWED/);
  const before = await knowledgeSearch(accounting, { query: 'q', as_of: '2010-05-01' }, { knowledge, semanticMemorySearch: async () => assert.fail('not applicable') });
  assert.deepEqual(before.sources_errors, [{ source: 'syscohada', error: 'NOT_APPLICABLE_AT_DATE' }]);
});

test('memory is confined to the tenant of the key; caller cannot choose the collection', async () => {
  let args;
  await memorySearchScoped(accounting, { query: 'loyer', scope: { tenant: 'acme-ci' }, collection: 'mem_office_manager_taty' }, {
    semanticMemorySearch: async a => { args = a; return chromaResult(['m1', 'm2'], ['ok', 'leak'], [{ tenant: 'acme-ci' }, { tenant: 'other' }]); } });
  assert.equal(args.collection, 'mem_accounting_ai_acme_ci');
  assert.deepEqual(args.where, { tenant: 'acme-ci' });
  const r = await memorySearchScoped(accounting, { query: 'loyer', scope: { tenant: 'acme-ci' } }, {
    semanticMemorySearch: async () => chromaResult(['m1', 'm2'], ['ok', 'leak'], [{ tenant: 'acme-ci' }, { tenant: 'other' }]) });
  assert.deepEqual(r.items.map(i => i.text), ['ok']);
  await assert.rejects(memorySearchScoped(accounting, { query: 'q', scope: { tenant: 'taty' } }, {}), /TENANT_NOT_ALLOWED/);
});

test('remember requires human validation and write permission; idempotency key gives a stable id', async () => {
  const stored = [];
  const store = async a => { stored.push(a); return { stored: true, id: a.id }; };
  await assert.rejects(memoryRemember(accounting, { text: 't', scope: { tenant: 'acme-ci' } }, { semanticMemoryStore: store }), /HUMAN_VALIDATION_REQUIRED/);
  const body = { text: 'Loyer bureau: 622 / 401', scope: { tenant: 'acme-ci' }, validation: { validated_by: 'u@x', validated_at: '2026-11-04' }, idempotency_key: 'proposal-12' };
  const a = await memoryRemember(accounting, body, { semanticMemoryStore: store });
  const b = await memoryRemember(accounting, body, { semanticMemoryStore: store });
  assert.equal(a.memory_id, b.memory_id);
  assert.equal(stored[0].metadata.tenant, 'acme-ci');
  assert.equal(stored[0].metadata.authority, 'client_practice');
  await assert.rejects(memoryRemember(clients[1], { ...body, scope: { tenant: 'taty' } }, { semanticMemoryStore: store }), /MEMORY_WRITE_NOT_ALLOWED/);
});

test('task: citations are kept only when the passage was retrieved in this call', async () => {
  const deps = { knowledge, trace: () => {},
    semanticMemorySearch: async ({ collection }) => collection === 'syscohada_v2017'
      ? chromaResult(['d1'], ['Les frais de transport sont inclus dans le coût d’acquisition.'], [{ page: 40 }])
      : chromaResult(['m1'], ['Fournisseur X : compte 2441 validé en 2025'], [{ tenant: 'acme-ci' }]) };
  let call;
  const first = await knowledgeSearch(accounting, { query: 'transport' }, deps);
  const realId = first.passages[0].passage_id;
  const r = await runTask(accounting, { task: 'Traitement de la facture', input: { lines: [] }, model: 'local:8b', scope: { tenant: 'acme-ci' },
    knowledge: { query: 'transport' }, memory: { query: 'fournisseur X' } }, { ...deps,
    localLlmGenerate: async a => { call = a; return { done: true, model: 'local:8b', response: JSON.stringify({ answer: 'immobiliser', citations: [realId, 'P-invented00000000'], memory_used: ['m1', 'mX'] }) }; } });
  assert.match(call.prompt, new RegExp(realId));
  assert.deepEqual(r.citations.map(c => c.passage_id), [realId]);
  assert.deepEqual(r.rejected_citations, ['P-invented00000000']);
  assert.deepEqual(r.memory_used, ['m1']);
  assert.equal(r.has_authoritative_support, true);
  assert.ok(r.warnings.includes('CITATIONS_REJECTED_NOT_RETRIEVED'));
  const none = await runTask(accounting, { task: 't', model: 'm', scope: { tenant: 'acme-ci' }, knowledge: { query: 'x' } }, { ...deps,
    semanticMemorySearch: async () => chromaResult([], []), localLlmGenerate: async () => ({ done: true, response: '{"answer":"?","citations":["P-x"]}' }) });
  assert.equal(none.has_authoritative_support, false);
  assert.ok(none.warnings.includes('NO_KNOWLEDGE_PASSAGE_RETRIEVED'));
  await assert.rejects(runTask(accounting, { task: 't', scope: { tenant: 'acme-ci' } }, { ...deps, localLlmGenerate: async () => ({}) }), /MODEL_NOT_CONFIGURED/);
});
