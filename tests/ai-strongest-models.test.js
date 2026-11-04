// Paul, 2026-11-04: « on reste sur Claude et ChatGPT, mais avec le modèle le plus puissant ».
// The strongest models think before answering, and that thinking counts in the length limit: room is kept, and big
// readings get the time they need, so the answer is neither cut nor silently replaced by the other AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, requestTimeout, THINKING_ROOM, thinksAlways } from '../lib/ai-plus.js';

function fakeFetch(reply) {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => reply, text: async () => JSON.stringify(reply) }; };
  return { seen, fetchImpl };
}

test('a Claude 5 model gets room for its thinking and the effort asked; an older model is sent as before', async () => {
  const ok = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }] };
  let f = fakeFetch(ok);
  await callModel({ provider: 'anthropic', instructions: 'i', input: 'x', maxTokens: 6000 }, { env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-fable-5-1' }, fetchImpl: f.fetchImpl });
  assert.equal(f.seen[0].body.max_tokens, 6000 + THINKING_ROOM);
  assert.deepEqual(f.seen[0].body.output_config, { effort: 'high' });
  assert.equal(f.seen[0].body.temperature, undefined, 'never a temperature (refused by these models)');
  f = fakeFetch(ok);
  await callModel({ provider: 'anthropic', instructions: 'i', input: 'x', maxTokens: 6000 }, { env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-opus-5-5', ANTHROPIC_EFFORT: 'max' }, fetchImpl: f.fetchImpl });
  assert.deepEqual(f.seen[0].body.output_config, { effort: 'max' });
  f = fakeFetch(ok);
  await callModel({ provider: 'anthropic', instructions: 'i', input: 'x', maxTokens: 6000 }, { env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-sonnet-4-6' }, fetchImpl: f.fetchImpl });
  assert.equal(f.seen[0].body.max_tokens, 6000); assert.equal(f.seen[0].body.output_config, undefined);
  assert.equal(thinksAlways('claude-opus-5-5'), true); assert.equal(thinksAlways('claude-opus-4-8'), false);
});

test('a request declined by Claude is said as such (the next AI answers), never read as an empty answer', async () => {
  const f = fakeFetch({ stop_reason: 'refusal', content: [] });
  await assert.rejects(callModel({ provider: 'anthropic', instructions: 'i', input: 'x' }, { env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-fable-5-1' }, fetchImpl: f.fetchImpl }), /ANTHROPIC_REFUSED/);
});

test('OpenAI keeps room for reasoning; the reasoning effort is sent only when set', async () => {
  const ok = { status: 'completed', output_text: '{"ok":true}' };
  let f = fakeFetch(ok);
  await callModel({ provider: 'openai', instructions: 'i', input: 'x', maxTokens: 6000 }, { env: { OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-6-astra' }, fetchImpl: f.fetchImpl });
  assert.equal(f.seen[0].body.max_output_tokens, 6000 + THINKING_ROOM); assert.equal(f.seen[0].body.reasoning, undefined);
  f = fakeFetch(ok);
  await callModel({ provider: 'openai', instructions: 'i', input: 'x', maxTokens: 6000 }, { env: { OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-6-astra', OPENAI_REASONING_EFFORT: 'high' }, fetchImpl: f.fetchImpl });
  assert.deepEqual(f.seen[0].body.reasoning, { effort: 'high' });
});

test('a big reading (a data sheet with its context) gets two minutes', () => {
  assert.equal(requestTimeout({ maxTokens: 6000, input: 'x'.repeat(130000) }, {}), 120000);
  assert.equal(requestTimeout({ maxTokens: 1800, input: 'x'.repeat(70000) }, {}), 60000);
});
