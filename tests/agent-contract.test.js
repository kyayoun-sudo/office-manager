import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_BRAIN_CONTRACT, withAgentBrainContract } from '../lib/agent-contract.js';
import { callModel, firstAvailable, DATA_GUARD } from '../lib/ai-plus.js';
import { COMPATIBLE_PROVIDERS } from '../lib/ai-providers.js';
import { runAI } from '../lib/ai.js';

test('task schema survives contract injection; nested agent calls do not duplicate it', () => {
  const task = 'Retourne uniquement {"facts":[]} ; aucune action.';
  const once = withAgentBrainContract(task);
  assert.ok(once.startsWith(task));
  assert.equal(withAgentBrainContract(once), once);
  assert.equal(once.split(AGENT_BRAIN_CONTRACT).length, 2);
});

test('cloud HTTP adapters transmit the same content-first and persistent-memory contract', async () => {
  const providers = ['openai', 'anthropic', 'gemini', ...Object.keys(COMPATIBLE_PROVIDERS)];
  for (const provider of providers) {
    let sent;
    const env = {
      OPENAI_API_KEY: 'test', ANTHROPIC_API_KEY: 'test', ANTHROPIC_MODEL: 'test', GEMINI_API_KEY: 'test',
      ...Object.fromEntries(Object.values(COMPATIBLE_PROVIDERS).map(p => [p.key, 'test']))
    };
    const reply = provider === 'openai' ? { output_text: 'ok' }
      : provider === 'anthropic' ? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }
      : provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }
      : { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] };
    await callModel({ provider, instructions: 'Extraction uniquement.', input: 'scan' }, {
      env, fetchImpl: async (_, init) => { sent = JSON.parse(init.body); return Response.json(reply); }
    });
    const system = provider === 'openai' ? sent.instructions
      : provider === 'anthropic' ? sent.system
      : provider === 'gemini' ? sent.systemInstruction.parts[0].text
      : sent.messages[0].content;
    assert.ok(system.includes(AGENT_BRAIN_CONTRACT), provider);
    assert.ok(system.includes(DATA_GUARD), provider);
    assert.ok(system.startsWith('Extraction uniquement.'), provider);
  }
});

test('legacy dual review also gives the independent reviewer the contract', async () => {
  const keys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const fetchBefore = globalThis.fetch, sent = [];
  try {
    for (const key of keys) process.env[key] = 'test';
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body); sent.push(body.instructions || body.system);
      return Response.json(String(url).includes('anthropic')
        ? { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }
        : { output_text: 'ok' });
    };
    await runAI({ provider: 'dual', instructions: 'Analyse.', input: 'document' });
    assert.equal(sent.length, 2);
    for (const system of sent) assert.ok(system.includes(AGENT_BRAIN_CONTRACT));
  } finally {
    globalThis.fetch = fetchBefore;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});

test('contract is added after routing so auxiliary tasks do not become professional audit requests', async () => {
  // The contract mentions audit/SOP, but must not alter provider eligibility or capability selection.
  const attempted = [];
  await firstAvailable(['mistral'], { instructions: 'Transcris ce texte.', input: 'scan' }, {
    env: { MISTRAL_API_KEY: 'test' },
    callModel: async args => { attempted.push(args); return { provider: args.provider, text: 'ok' }; }
  });
  assert.equal(attempted.length, 1);
  assert.equal(attempted[0].provider, 'mistral');
  assert.equal(attempted[0].instructions, 'Transcris ce texte.');
});
