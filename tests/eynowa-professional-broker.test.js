import test from 'node:test';
import assert from 'node:assert/strict';

import { labRequest } from '../lib/eynowa-lab.js';
import {
  gatewayRouteForJob,
  callGateway,
  parseQueueBody
} from '../scripts/eynowa-cloudflare-worker-v3.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('Professional Brain uses the existing White Label broker with professional.query', async () => {
  const calls = [];
  const env = {
    EYNOWA_BROKER_URL: 'https://broker.example.test',
    EYNOWA_BROKER_KEY: 'broker-secret'
  };

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/job')) {
      return jsonResponse({ job_id: 'job-1' });
    }
    if (String(url).endsWith('/result/job-1')) {
      return jsonResponse({
        status: 'completed',
        response: {
          answer: 'Professional answer',
          domains: ['audit'],
          requires_validation: true
        }
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await labRequest('/v1/professional/query', {
    application: 'office_manager',
    query: 'Assess audit evidence',
    domains: ['audit']
  }, { env, fetchImpl, timeoutMs: 3000 });

  assert.equal(result.answer, 'Professional answer');
  assert.equal(result.requires_validation, true);
  assert.equal(calls.length, 2);

  const submitted = JSON.parse(calls[0].options.body);
  assert.equal(submitted.type, 'professional.query');
  assert.equal(submitted.request.query, 'Assess audit evidence');
  assert.deepEqual(submitted.request.domains, ['audit']);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer broker-secret');
});

test('Professional Brain keeps the direct local/dev gateway fallback', async () => {
  const env = {
    EYNOWA_LAB_URL: 'https://gateway.example.test',
    EYNOWA_LAB_API_KEY: 'gateway-secret'
  };

  const fetchImpl = async (url, options = {}) => {
    assert.equal(String(url), 'https://gateway.example.test/v1/professional/query');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer gateway-secret');
    const body = JSON.parse(options.body);
    assert.equal(body.query, 'Explain the accounting treatment');
    return jsonResponse({ answer: 'Treatment', knowledge_hits: 3 });
  };

  const result = await labRequest('/v1/professional/query', {
    query: 'Explain the accounting treatment'
  }, { env, fetchImpl, timeoutMs: 3000 });

  assert.equal(result.answer, 'Treatment');
  assert.equal(result.knowledge_hits, 3);
});

test('Lab client refuses arbitrary gateway operations', async () => {
  await assert.rejects(
    () => labRequest('/dangerous/arbitrary-operation', {}, {
      env: {
        EYNOWA_LAB_URL: 'https://gateway.example.test',
        EYNOWA_LAB_API_KEY: 'gateway-secret'
      },
      fetchImpl: async () => jsonResponse({ ok: true })
    }),
    /EYNOWA_LAB_OPERATION_NOT_ALLOWED/
  );
});

test('local worker explicitly routes the two authorised job types', () => {
  assert.equal(gatewayRouteForJob('ai.local_chat'), '/ai/local-chat');
  assert.equal(gatewayRouteForJob('professional.query'), '/v1/professional/query');
  assert.equal(gatewayRouteForJob('delete.files'), null);
});

test('local worker sends professional.query to the local professional endpoint', async () => {
  const config = {
    gatewayUrl: 'http://127.0.0.1:8787',
    gatewayKey: 'local-gateway-key'
  };

  const fetchImpl = async (url, options = {}) => {
    assert.equal(String(url), 'http://127.0.0.1:8787/v1/professional/query');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer local-gateway-key');
    const body = JSON.parse(options.body);
    assert.equal(body.query, 'Going concern assessment');
    return jsonResponse({ answer: 'Assessment', domains: ['audit'] });
  };

  const result = await callGateway(config, {
    type: 'professional.query',
    request: { query: 'Going concern assessment', domains: ['audit'] }
  }, fetchImpl);

  assert.equal(result.answer, 'Assessment');
});

test('worker parses JSON queue messages and rejects non JSON input', () => {
  assert.deepEqual(
    parseQueueBody('{"job_id":"j1","type":"professional.query","request":{}}'),
    { job_id: 'j1', type: 'professional.query', request: {} }
  );
  assert.throws(() => parseQueueBody('%%%not-json%%%'), /EYNOWA_WORKER_INVALID_JOB_JSON/);
});
