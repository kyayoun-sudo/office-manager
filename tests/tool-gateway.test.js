import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as gateway from '../lib/tool-gateway.js';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});
function setup() {
  for (const key of Object.keys(process.env)) {
    if (/^(CHROMA_|MEILISEARCH_|N8N_|VERCEL$|EYNOWA_TOOL_GATEWAY_ENABLED$)/.test(key)) delete process.env[key];
  }
  process.env.EYNOWA_TOOL_GATEWAY_ENABLED = 'true';
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init, body: init.body ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return calls;
}
test('disabled by default, all new operations refuse network access', async () => {
  const calls = setup();
  delete process.env.EYNOWA_TOOL_GATEWAY_ENABLED;
  assert.equal(gateway.toolGatewayEnabled(), false);
  for (const name of ['memoryStore', 'memorySearch', 'searchIndex', 'searchQuery', 'workflowRun']) {
    await assert.rejects(gateway[name](), { code: 'EYNOWA_TOOL_GATEWAY_DISABLED' });
  }
  assert.equal(calls.length, 0);
});
test('Chroma v2 upsert and query preserve vectors, scope, metadata and filters', async () => {
  const calls = setup();
  process.env.CHROMA_BASE_URL = 'https://chroma.example/prefix/';
  process.env.CHROMA_TENANT = 'my tenant';
  process.env.CHROMA_DATABASE = 'db';
  process.env.CHROMA_API_KEY = 'test-token';
  await gateway.memoryStore({ collectionId: 'uuid', ids: ['one'], embeddings: [[1, 2]], documents: ['hello'], metadatas: [{ mission: 'a' }] });
  await gateway.memorySearch({ collectionId: 'uuid', queryEmbeddings: [[1, 2]], nResults: 3, where: { mission: 'a' } });
  assert.equal(calls[0].url, 'https://chroma.example/prefix/api/v2/tenants/my%20tenant/databases/db/collections/uuid/upsert');
  assert.deepEqual(calls[0].body.embeddings, [[1, 2]]);
  assert.equal(calls[0].headers.get('X-Chroma-Token'), 'test-token');
  assert.equal(calls[1].body.n_results, 3);
  assert.deepEqual(calls[1].body.where, { mission: 'a' });
});
test('Meilisearch indexes documents and queries with optional bearer auth', async () => {
  const calls = setup();
  process.env.MEILISEARCH_API_KEY = 'test-key';
  await gateway.searchIndex({ index: 'mission', documents: [{ id: 1, text: 'hello' }], primaryKey: 'id' });
  await gateway.searchQuery({ index: 'mission', query: 'hello', options: { limit: 5, filter: 'id = 1', q: 'ignored' } });
  assert.equal(calls[0].url, 'http://127.0.0.1:7700/indexes/mission/documents?primaryKey=id');
  assert.deepEqual(calls[0].body, [{ id: 1, text: 'hello' }]);
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer test-key');
  assert.deepEqual(calls[1].body, { limit: 5, filter: 'id = 1', q: 'hello' });
});
test('n8n production webhook supports nested paths, custom headers and text responses', async () => {
  setup();
  process.env.N8N_BASE_URL = 'https://n8n.example';
  process.env.N8N_HEADERS_JSON = JSON.stringify({ 'X-Webhook-Secret': 'test-secret' });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://n8n.example/webhook/mission/start');
    assert.equal(init.headers.get('X-Webhook-Secret'), 'test-secret');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { id: 1 });
    return new Response('accepted');
  };
  assert.equal(await gateway.workflowRun({ webhookPath: 'mission/start', payload: { id: 1 } }), 'accepted');
});
test('Vercel requires explicit URLs for new services', async () => {
  const calls = setup();
  process.env.VERCEL = '1';
  assert.equal(gateway.toolGatewayConfig().chroma, null);
  for (const operation of [
    () => gateway.memoryStore({ collectionId: 'uuid', ids: ['a'], embeddings: [[1]] }),
    () => gateway.memorySearch({ collectionId: 'uuid', queryEmbeddings: [[1]] }),
    () => gateway.searchIndex({ index: 'a', documents: [{ id: 1 }] }),
    () => gateway.searchQuery({ index: 'a' }),
    () => gateway.workflowRun({ webhookPath: 'a' })
  ]) await assert.rejects(operation(), { code: 'EYNOWA_TOOL_NOT_CONFIGURED' });
  assert.equal(calls.length, 0);
  process.env.N8N_BASE_URL = 'https://remote.example';
  await gateway.workflowRun({ webhookPath: 'a' });
  assert.equal(calls.length, 1);
});
test('validation rejects invalid vectors, records and unsafe webhook paths', async () => {
  const calls = setup();
  await assert.rejects(gateway.memoryStore({ collectionId: 'x', ids: ['a'], embeddings: [[NaN]] }), /INVALID_RECORDS/);
  await assert.rejects(gateway.memorySearch({ collectionId: 'x', queryEmbeddings: [[]] }), /INVALID_QUERY/);
  await assert.rejects(gateway.searchIndex({ index: 'x', documents: [null] }), /INVALID_DOCUMENTS/);
  for (const webhookPath of ['../x', '/x', 'x//y']) await assert.rejects(gateway.workflowRun({ webhookPath }), /INVALID_WEBHOOK_PATH/);
  assert.equal(calls.length, 0);
});
test('HTTP errors redact upstream bodies and mutations are never retried', async () => {
  setup();
  let count = 0;
  globalThis.fetch = async () => { count++; return new Response('sensitive upstream body', { status: 401 }); };
  await assert.rejects(gateway.workflowRun({ webhookPath: 'a' }), { message: 'N8N_HTTP_401' });
  assert.equal(count, 1);
});
test('timeouts abort requests', async () => {
  setup();
  globalThis.fetch = async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
  await assert.rejects(gateway.searchQuery({ index: 'x', timeoutMs: 10 }), /MEILISEARCH_TIMEOUT/);
});
test('existing Ollama, docTR and Gotenberg request contracts still work', async () => {
  setup();
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init });
    return url.endsWith('/convert') ? new Response(new Uint8Array([37, 80, 68, 70])) : Response.json({ result: 'ok' });
  };
  assert.deepEqual(await gateway.localLlmGenerate({ prompt: 'hello' }), { result: 'ok' });
  assert.deepEqual(await gateway.ocrDocument({ bytes: new Uint8Array([1]) }), { result: 'ok' });
  assert.deepEqual(await gateway.convertOfficeToPdf({ bytes: new Uint8Array([1]), filename: 'a.docx' }), Buffer.from('%PDF'));
  assert.equal(JSON.parse(calls[0].body).stream, false);
  assert.ok(calls[1].body instanceof FormData);
  assert.ok(calls[2].body instanceof FormData);
});
