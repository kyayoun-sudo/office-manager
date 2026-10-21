import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent, Runner, tool } from '@openai/agents';
import { callModel, firstAvailable, providersStatus, deepResearch } from '../lib/ai-plus.js';
import { runAI } from '../lib/ai.js';
import { providerOrder, providerShare, selectedSupport, COMPATIBLE_PROVIDERS } from '../lib/ai-providers.js';
import { sdkProviderConfig } from '../lib/ai-sdk-provider.js';

const env = { OPENAI_API_KEY: 'test-o', OPENROUTER_API_KEY: 'test-r', OPENROUTER_SHARE: '10',
  MISTRAL_API_KEY: 'test-m', MISTRAL_SHARE: '15', HUGGINGFACE_API_KEY: 'test-h', HUGGINGFACE_SHARE: '15', GROQ_API_KEY: 'test-g', Groq_SHARE: '10' };
test('added environment keys are detected without exposing credentials; aliases and explicit models', () => {
  const status = providersStatus(env);
  for (const p of Object.keys(COMPATIBLE_PROVIDERS)) assert.equal(status[p], true);
  assert.equal(providerShare('groq', env), 10);
  assert.equal(providerShare('groq', { ...env, GROQ_SHARE: '0' }), 0);
  assert.equal(providersStatus({ HF_TOKEN: 'token', HF_MODEL: 'chosen' }).models.huggingface, 'chosen');
  assert.equal(providersStatus({ MISTRAL_API_KEY: 'x', MISTRAL_MODEL: 'chosen' }).models.mistral, 'chosen');
  assert.ok(!JSON.stringify(status).includes('test-m'));
  assert.equal(sdkProviderConfig('dual', env, () => .2).provider, 'openai');
});
test('configured shares are disjoint and missing keys do not steal a share; totals above 100 normalize', () => {
  const counts = {};
  for (let i = 0; i < 1000; i++) { const p = selectedSupport(env, () => i / 1000) || 'primary'; counts[p] = (counts[p] || 0) + 1; }
  assert.deepEqual(counts, { openrouter: 100, mistral: 150, huggingface: 150, groq: 100, primary: 500 });
  assert.equal(selectedSupport({ ...env, GROQ_API_KEY: '' }, () => .45), null);
  assert.equal(selectedSupport({ MISTRAL_API_KEY: 'k', MISTRAL_SHARE: '100', GROQ_API_KEY: 'g', GROQ_SHARE: '100' }, () => .75), 'groq');
  assert.equal(providerOrder(['openai'], {}, () => 0).length, 0);
});
test('each chat adapter uses its fixed endpoint and own key, refuses PDFs/web and fails on truncation or auth errors', async () => {
  for (const p of Object.keys(COMPATIBLE_PROVIDERS)) {
    let seen;
    const d = { env, fetchImpl: async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return Response.json({ model: 'returned-model', choices: [{ finish_reason: 'stop', message: { content: 'Réponse' } }] }); } };
    const out = await callModel({ provider: p, instructions: 'audit', input: 'public sample', maxTokens: 100 }, d);
    assert.equal(out.model, 'returned-model'); assert.equal(out.text, 'Réponse'); assert.deepEqual(out.sources, []);
    assert.equal(seen.url, COMPATIBLE_PROVIDERS[p].baseURL + '/chat/completions');
    assert.equal(seen.init.headers.Authorization, 'Bearer ' + env[COMPATIBLE_PROVIDERS[p].key]);
    assert.match(seen.body.messages[0].content, /DONNÉE/);
    await assert.rejects(callModel({ provider: p, files: [{ mimeType: 'application/pdf', base64: 'fake' }] }, d), /UNSUPPORTED_CAPABILITY/);
    await assert.rejects(callModel({ provider: p, webSearch: true }, d), /UNSUPPORTED_CAPABILITY/);
    await assert.rejects(callModel({ provider: p, input: 'x' }, { env, fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }) }), /TRUNCATED/);
    await assert.rejects(callModel({ provider: p, input: 'x' }, { env, fetchImpl: async () => Response.json({ error: { message: 'must not disclose' } }, { status: 401 }) }), new RegExp(p.toUpperCase() + '_401$'));
  }
});
test('text fallback reaches added providers once; native web/PDF requests never reach a text-only model', async () => {
  const calls = [], run = async ({ provider }) => { calls.push(provider); if (provider !== 'mistral') throw Error('unavailable'); return { provider, text: 'ok' }; };
  const out = await firstAvailable(['openai'], { input: 'x' }, { env, random: () => .99, callModel: run });
  assert.equal(out.provider, 'mistral'); assert.deepEqual(calls, ['openai', 'openrouter', 'mistral']);
  calls.length = 0;
  const research = await deepResearch({ question: 'q' }, { env: { MISTRAL_API_KEY: 'm' }, callModel: run });
  assert.equal(research.web, false); assert.deepEqual(calls, []);
  assert.deepEqual(providerOrder(['mistral'], env, () => .2, { files: [{}] }), ['openrouter']);
});
test('legacy agent entry respects explicit choice, falls back and keeps independent high-risk review', async () => {
  const calls = [], d = { env, runDirect: async () => { calls.push('direct'); return { text: 'reviewed' }; },
    callModel: async ({ provider }) => { calls.push(provider); if (provider === 'mistral') throw Error('quota'); return { provider, text: 'ok' }; } };
  await runAI({ provider: 'auto', random: () => .2 }, d); assert.deepEqual(calls, ['mistral', 'direct']);
  calls.length = 0;
  await assert.rejects(runAI({ provider: 'mistral' }, d), /quota/); assert.deepEqual(calls, ['mistral']);
  calls.length = 0;
  await runAI({ risk: 'critical', random: () => .2 }, { ...d, env: { ...env, ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'claude' } });
  assert.deepEqual(calls, ['direct']);
});
test('operational SDK preserves server tool execution with every added provider, without changing global credentials', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const p of Object.keys(COMPATIBLE_PROVIDERS)) {
      let requests = 0, executed = 0;
      globalThis.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(String(url), COMPATIBLE_PROVIDERS[p].baseURL + '/chat/completions');
        assert.equal(body.model, COMPATIBLE_PROVIDERS[p].defaultModel);
        assert.equal(body.tools[0].function.strict, false);
        requests++;
        const message = requests === 1 ? { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_public_sample', arguments: '{}' } }] }
          : { role: 'assistant', content: 'Verified sample read' };
        return Response.json({ id: 'chat-' + requests, object: 'chat.completion', created: 1, model: body.model,
          choices: [{ index: 0, finish_reason: requests === 1 ? 'tool_calls' : 'stop', message }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      };
      const { provider, ...config } = sdkProviderConfig(p, env);
      const agent = new Agent({ name: 'test', model: 'must-be-overridden', tools: [tool({ name: 'read_public_sample', description: 'Read a synthetic sample', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, execute: async () => { executed++; return 'public sample'; } })] });
      const result = await new Runner(config).run(agent, 'Read sample', { maxTurns: 3 });
      assert.equal(result.finalOutput, 'Verified sample read'); assert.equal(executed, 1); assert.equal(requests, 2); assert.equal(provider, p);
    }
  } finally { globalThis.fetch = originalFetch; }
});
