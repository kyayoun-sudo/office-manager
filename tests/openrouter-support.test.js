import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, firstAvailable, providersStatus, OPENROUTER_DEFAULT_MODEL, openRouterShare, openRouterFirst } from '../lib/ai-plus.js';

const reply = (body, ok = true, status = 200) => async (url, init) => ({ ok, status, json: async () => (typeof body === 'function' ? body(url, JSON.parse(init.body), init) : body) });

test('OpenRouter is seen as soon as OPENROUTER_API_KEY is set in Vercel', () => {
  const s = providersStatus({ OPENROUTER_API_KEY: 'k' });
  assert.equal(s.openrouter, true); assert.equal(s.models.openrouter, OPENROUTER_DEFAULT_MODEL);
  assert.equal(providersStatus({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'anthropic/x' }).models.openrouter, 'anthropic/x');
  assert.equal(providersStatus({}).openrouter, false);
});

test('a call to OpenRouter sends the key, the instructions and a picture, and reads the answer and its sources', async () => {
  let seen;
  const fetchImpl = reply((url, body, init) => { seen = { url, body, auth: init.headers.Authorization }; return { model: 'some/model', choices: [{ message: { content: 'Réponse', annotations: [{ type: 'url_citation', url_citation: { url: 'https://a.b', title: 'A' } }] } }] }; });
  const r = await callModel({ provider: 'openrouter', instructions: 'Consigne', input: 'Question', files: [{ mimeType: 'image/png', base64: 'AAA' }], webSearch: true }, { env: { OPENROUTER_API_KEY: 'k' }, fetchImpl });
  assert.equal(seen.url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(seen.auth, 'Bearer k');
  assert.match(seen.body.messages[0].content, /Consigne/); assert.equal(seen.body.messages[1].content[1].type, 'image_url');
  assert.deepEqual(seen.body.plugins, [{ id: 'web' }]);
  assert.equal(r.text, 'Réponse'); assert.equal(r.model, 'some/model'); assert.deepEqual(r.sources, [{ url: 'https://a.b', title: 'A' }]);
  await assert.rejects(callModel({ provider: 'openrouter', instructions: '', input: 'x' }, { env: {}, fetchImpl }), /OPENROUTER_NOT_CONFIGURED/);
});

test('OpenRouter supports the others: tried last when the asked providers are missing or fail', async () => {
  const calls = [];
  const run = async ({ provider }) => { calls.push(provider); if (provider === 'anthropic') throw new Error('ANTHROPIC_529'); return { provider, text: 'ok' }; };
  const later = () => 0.99; // this request is not in OpenRouter's share
  const r = await firstAvailable(['anthropic', 'gemini'], { input: 'x' }, { env: { ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'm', OPENROUTER_API_KEY: 'k' }, callModel: run, random: later });
  assert.equal(r.provider, 'openrouter'); assert.deepEqual(calls, ['anthropic', 'openrouter']);
  // When the first one answers, OpenRouter is not used.
  calls.length = 0;
  await firstAvailable(['openai'], { input: 'x' }, { env: { OPENAI_API_KEY: 'o', OPENROUTER_API_KEY: 'k' }, callModel: run, random: later });
  assert.deepEqual(calls, ['openai']);
});

test('OpenRouter is the major one: about 45 % of requests go to it first, the others support it', async () => {
  const env = { OPENAI_API_KEY: 'o', OPENROUTER_API_KEY: 'k' };
  assert.equal(openRouterShare(env), 45); assert.equal(providersStatus(env).openrouter_share, 45);
  assert.equal(openRouterShare({ ...env, OPENROUTER_SHARE: '70' }), 70); assert.equal(openRouterShare({ ...env, OPENROUTER_SHARE: '0' }), 0);
  assert.equal(openRouterFirst({}, () => 0), false, 'never without its key');
  const calls = [];
  const run = async ({ provider }) => { calls.push(provider); if (provider === 'openrouter') throw new Error('OPENROUTER_502'); return { provider, text: 'ok' }; };
  const r = await firstAvailable(['openai'], { input: 'x' }, { env, callModel: run, random: () => 0.10 });
  assert.deepEqual(calls, ['openrouter', 'openai']); assert.equal(r.provider, 'openai');
  // Over many requests, the share is respected.
  let first = 0; for (let i = 0; i < 1000; i++) if (openRouterFirst(env, () => i / 1000)) first++;
  assert.equal(first, 450);
});
