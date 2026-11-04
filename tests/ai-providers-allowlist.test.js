// Paul, 2026-11-04: « je veux utiliser que ces 3 IA : Anthropic, ChatGPT, Kimi ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerOrder, providerReady, providerConfig, allowedProviders } from '../lib/ai-providers.js';
import { callModel, firstAvailable } from '../lib/ai-plus.js';

const keys = { OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'm', OPENROUTER_API_KEY: 'r', XAI_API_KEY: 'x',
  MISTRAL_API_KEY: 'mi', GROQ_API_KEY: 'g', HUGGINGFACE_API_KEY: 'h', KIMI_API_KEY: 'k' };

test('only the AIs of OFFICE_MANAGER_AI_PROVIDERS are used, in the order asked; the others are never ready', () => {
  const env = { ...keys, OFFICE_MANAGER_AI_PROVIDERS: 'claude, chatgpt; kimi' };
  assert.deepEqual([...allowedProviders(env)], ['anthropic', 'openai', 'kimi']);
  assert.deepEqual(providerOrder(['anthropic', 'openai', 'gemini'], env), ['anthropic', 'openai', 'kimi']);
  for (const p of ['openrouter', 'xai', 'mistral', 'groq', 'huggingface']) assert.equal(providerReady(p, env), false, p);
  // Without the setting: every AI with a key, as before.
  assert.ok(providerOrder(null, keys).includes('openrouter'));
});

test('Kimi (Moonshot) is an OpenAI-compatible provider, key KIMI_API_KEY or MOONSHOT_API_KEY, model overridable', () => {
  const c = providerConfig('kimi', { MOONSHOT_API_KEY: 'k2', KIMI_MODEL: 'kimi-k3' });
  assert.equal(c.apiKey, 'k2'); assert.equal(c.model, 'kimi-k3'); assert.equal(c.baseURL, 'https://api.moonshot.ai/v1');
  assert.equal(providerConfig('kimi', { KIMI_API_KEY: 'k' }).model, 'kimi-k2.6');
});

test('a Kimi answer is read; an AI left out is refused even when named, and the pool falls to Kimi', async () => {
  const env = { KIMI_API_KEY: 'k', OPENROUTER_API_KEY: 'r', OFFICE_MANAGER_AI_PROVIDERS: 'anthropic,openai,kimi' };
  const urls = [];
  const fetchImpl = async (url, init) => { urls.push(url); const body = JSON.parse(init.body);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ model: body.model, choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }) }; };
  await assert.rejects(callModel({ provider: 'openrouter', instructions: 'i', input: 'x' }, { env, fetchImpl }), /OPENROUTER_NOT_ALLOWED/);
  const r = await callModel({ provider: 'kimi', instructions: 'i', input: 'x' }, { env, fetchImpl });
  assert.equal(r.provider, 'kimi'); assert.equal(r.text, '{"ok":true}');
  assert.equal(urls[0], 'https://api.moonshot.ai/v1/chat/completions');
  const f = await firstAvailable(['anthropic', 'openai'], { instructions: 'i', input: 'x' }, { env, fetchImpl, orgId: 'O', healthStore: { get: async () => null, set: async () => {} } });
  assert.equal(f.provider, 'kimi');
  assert.ok(!urls.some(u => /openrouter/.test(u)), 'OpenRouter never called');
});
