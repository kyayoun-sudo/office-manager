import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, providersStatus } from '../lib/ai-plus.js';
import { providerOrder, providerShare } from '../lib/ai-providers.js';
import { labReady, labRequest } from '../lib/eynowa-lab.js';
const env = { EYNOWA_LAB_URL: 'https://lab.example.test', EYNOWA_LAB_API_KEY: 'synthetic', EYNOWA_LAB_SHARE: '20' };
test('laboratory variables connect the actual gateway protocol without exposing its key', async () => {
  let seen;
  const result = await callModel({ provider: 'eynowa-lab', instructions: 'Audit', input: 'public test' }, { env, fetchImpl: async (url, options) => {
    seen = { url, options, body: JSON.parse(options.body) };
    return Response.json({ done: true, response: 'OK', model: 'local-model' });
  } });
  assert.equal(seen.url, env.EYNOWA_LAB_URL + '/ai/local-chat');
  assert.equal(seen.options.headers.Authorization, 'Bearer synthetic');
  assert.equal(seen.options.redirect, 'error'); assert.equal(seen.body.prompt, 'public test');
  assert.equal(result.model, 'local-model'); assert.equal(result.text, 'OK');
  assert.equal(providersStatus(env)['eynowa-lab'], true);
  assert.ok(!JSON.stringify(providersStatus(env)).includes('synthetic'));
  assert.equal(providerShare('eynowa-lab', env), 20);
});
test('laboratory is never used for operational tools, web search or silently dropped files', async () => {
  assert.deepEqual(providerOrder(['openai'], env, () => 0, { tools: true }), []);
  await assert.rejects(callModel({ provider: 'eynowa-lab', files: [{}] }, { env }), /UNSUPPORTED_CAPABILITY/);
  await assert.rejects(labRequest('/workflow/run', {}, { env }), /OPERATION_NOT_ALLOWED/);
  assert.equal(labReady({ ...env, EYNOWA_LAB_URL: 'http://lab.example.test' }), false);
  assert.equal(labReady({ ...env, EYNOWA_LAB_URL: 'https://user:password@lab.example.test' }), false);
  await assert.rejects(callModel({ provider: 'eynowa-lab', input: 'public' }, { env, fetchImpl: async () => Response.json({ done: false, response: 'partial' }) }), /INCOMPLETE_RESPONSE/);
  await assert.rejects(labRequest('/health', null, { env, fetchImpl: async () => Response.json({}, { status: 401 }) }), /HTTP_401/);
});
