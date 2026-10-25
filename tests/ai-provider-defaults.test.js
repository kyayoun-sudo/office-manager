// The AI providers as their own documentation describes them (checked 2026-10-25): current default models,
// Claude's paused web search continued, and a cut answer never given as complete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, providersStatus, GEMINI_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL } from '../lib/ai-plus.js';
import { sdkProviderConfig } from '../lib/ai-sdk-provider.js';

const replies = list => { const sent = []; return { sent, fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => list.shift() }; } }; };
const claude = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-sonnet-5-5' };

test('without a model named in Vercel: a Gemini model open to new projects, one OpenAI model everywhere', async () => {
  assert.equal(GEMINI_DEFAULT_MODEL, 'gemini-3.8-flash'); // gemini-2.5-pro is refused to new Google projects
  assert.equal(providersStatus({ GEMINI_API_KEY: 'g' }).models.gemini, GEMINI_DEFAULT_MODEL);
  assert.equal(sdkProviderConfig('openai', {}).model, OPENAI_DEFAULT_MODEL); // agents and answers: the same model
  const { sent, fetchImpl } = replies([{ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }]);
  assert.equal((await callModel({ provider: 'gemini', instructions: '', input: 'x' }, { env: { GEMINI_API_KEY: 'g' }, fetchImpl })).model, 'gemini-3.8-flash');
  assert.ok(sent.length === 1);
});

test('Claude: a paused web search is continued with the paused message, and the whole answer kept', async () => {
  const { sent, fetchImpl } = replies([
    { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'Je cherche. ' }, { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Réponse.', citations: [{ url: 'https://a.b', title: 'A' }] }] }
  ]);
  const r = await callModel({ provider: 'anthropic', instructions: '', input: 'x', webSearch: true }, { env: claude, fetchImpl });
  assert.equal(r.text, 'Je cherche. Réponse.'); assert.deepEqual(r.sources, [{ url: 'https://a.b', title: 'A' }]);
  assert.equal(sent[1].messages[1].role, 'assistant'); assert.equal(sent[1].messages[1].content[1].type, 'server_tool_use');
});

test('Claude: an answer cut by the length limit, or still paused, is refused (the next AI takes over)', async () => {
  await assert.rejects(callModel({ provider: 'anthropic', instructions: '', input: 'x' }, { env: claude, ...replies([{ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Début…' }] }]) }), /ANTHROPIC_TRUNCATED_RESPONSE/);
  const paused = Array.from({ length: 4 }, () => ({ stop_reason: 'pause_turn', content: [{ type: 'text', text: '…' }] }));
  await assert.rejects(callModel({ provider: 'anthropic', instructions: '', input: 'x', webSearch: true }, { env: claude, ...replies(paused) }), /ANTHROPIC_INCOMPLETE_RESPONSE/);
});
