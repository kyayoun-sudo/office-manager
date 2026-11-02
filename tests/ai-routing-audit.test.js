// Audit of the AI routing (2026-11-02): each test reproduces a defect found in lib/ai-plus.js / lib/ai-pool.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, firstAvailable } from '../lib/ai-plus.js';
import { dispatchPool, resetPoolHealth } from '../lib/ai-pool.js';
import { tryPersonal, runAs, NOTICE_VERSION } from '../lib/personal-ai.js';

const ok = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
const healthStore = { get: async () => null, set: async () => {} };
const cut = '{"orders":[{"sheet":"D2","rows":1},{"sheet":"D2","rows":2},{"sheet":"D2","ro';

test('a cut answer is refused by every provider, never repaired into a shorter « complete » one', async () => {
  const env = { OPENAI_API_KEY: 'x', GEMINI_API_KEY: 'x', OPENROUTER_API_KEY: 'x', XAI_API_KEY: 'x' };
  const cases = [
    ['openai', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ content: [{ type: 'output_text', text: cut }] }] }, /OPENAI_TRUNCATED_RESPONSE/],
    ['openai', { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [{ content: [{ type: 'output_text', text: cut }] }] }, /OPENAI_INCOMPLETE_RESPONSE/],
    ['gemini', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: cut }] } }] }, /GEMINI_TRUNCATED_RESPONSE/],
    ['gemini', { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: cut }] } }] }, /GEMINI_INCOMPLETE_RESPONSE/],
    ['openrouter', { choices: [{ finish_reason: 'length', message: { content: cut } }] }, /OPENROUTER_TRUNCATED_RESPONSE/]
  ];
  for (const [provider, body, error] of cases)
    await assert.rejects(callModel({ provider, instructions: 'x', input: 'y' }, { env, fetchImpl: async () => ok(body) }), error, provider);
  await assert.rejects(callModel({ provider: 'xai', instructions: 'x', input: 'y', webSearch: true }, { env, fetchImpl: async () => ok({ status: 'incomplete', output_text: cut }) }), /XAI_TRUNCATED_RESPONSE/);
  // A complete answer still passes.
  const r = await callModel({ provider: 'gemini', instructions: 'x', input: 'y' }, { env, fetchImpl: async () => ok({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"a":1}' }] } }] }) });
  assert.equal(r.text, '{"a":1}');
});

test('a cut answer makes the pool move to the next AI, which answers in full', async () => {
  resetPoolHealth();
  const env = { OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' };
  const fetchImpl = async url => ok(url.includes('openai')
    ? { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ content: [{ type: 'output_text', text: cut }] }] }
    : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"orders":[1,2,3]}' }] } }] });
  const r = await firstAvailable(['openai', 'gemini'], { instructions: 'x', input: 'y' }, { env, fetchImpl, healthStore, countAiCall: async () => {} });
  assert.equal(r.provider, 'gemini'); assert.equal(r.text, '{"orders":[1,2,3]}');
});

test('one request = one paid call: no second AI in parallel while the first is still working', async () => {
  resetPoolHealth();
  const launched = [];
  const r = await firstAvailable(['anthropic', 'openai', 'gemini'], { instructions: 'x', input: 'y' }, {
    env: { ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'm', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' }, healthStore, countAiCall: async () => {},
    callModel: async ({ provider }) => { launched.push(provider); await new Promise(res => setTimeout(res, 1200)); return { provider, text: 'ok' }; }
  });
  assert.deepEqual(launched, ['anthropic']); assert.equal(r.provider, 'anthropic', 'the AI the code asked for answers');
  // A firm that wants hedging can still opt in.
  resetPoolHealth(); const calls = [];
  await dispatchPool(['openai', 'mistral'], (p, signal) => { calls.push(p); return p === 'openai' ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) : Promise.resolve('relève'); }, { hedgeMs: 5 });
  assert.deepEqual(calls, ['openai', 'mistral']);
});

test('the order asked by the code is kept, even when another AI succeeded more recently', async () => {
  resetPoolHealth();
  const env = { ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'm', OPENAI_API_KEY: 'o' };
  await dispatchPool(['openai'], async () => 'ok', { env, healthStore }); // openai now has a success on record, anthropic none
  const calls = [];
  await dispatchPool(['anthropic', 'openai'], async p => { calls.push(p); return 'ok'; }, { env, healthStore });
  assert.deepEqual(calls, ['anthropic']);
});

test('EYNOWA Lab only answers a caller that names it, never as a silent fallback nor for audit work', async () => {
  resetPoolHealth();
  const env = { OPENAI_API_KEY: 'o', EYNOWA_BROKER_URL: 'https://broker.example', EYNOWA_BROKER_KEY: 'k' };
  const calls = [];
  const callModel = async ({ provider }) => { calls.push(provider); if (provider === 'openai') throw Object.assign(new Error('OPENAI_500'), { status: 500 }); return { provider, text: 'ok' }; };
  const d = { env, healthStore, countAiCall: async () => {}, callModel };
  await assert.rejects(firstAvailable(['openai'], { instructions: 'Résume', input: 'texte sans mot-clé' }, d));
  assert.deepEqual(calls, ['openai'], 'not named: never reached');
  resetPoolHealth(); calls.length = 0;
  assert.equal((await firstAvailable(['openai', 'eynowa-lab'], { instructions: 'Résume', input: 'texte' }, d)).provider, 'eynowa-lab');
  resetPoolHealth(); calls.length = 0;
  await assert.rejects(firstAvailable(['openai', 'eynowa-lab'], { instructions: 'Enhanced Auditor', input: 'working paper' }, d));
  assert.deepEqual(calls, ['openai'], 'audit work: never reached, even when named');
});

const sealer = async () => ({ seal: k => 'sealed:' + k, open: v => v.replace(/^sealed:/, '') });
function keysDb() {
  const rows = [{ provider: 'openai', key_enc: 'sealed:sk-mine', model: 'gpt-x', active: true, notice_version: NOTICE_VERSION }], patches = [];
  const fetchRows = async (url, o = {}) => {
    if (url.startsWith('office_firm_settings')) return [{ settings: { personal_ai_allowed: true } }];
    if (url.startsWith('office_user_ai_keys') && o.method === 'PATCH') { patches.push(JSON.parse(o.body)); return []; }
    if (url.startsWith('office_user_ai_keys')) return rows;
    return [];
  };
  return { patches, fetchRows };
}
const me = { auth_user_id: 'u1', email: 'awa@cab.ci', display_name: 'Awa' };

test('« Mon IA » answers first even when it takes more than half a second; the firm AI is then neither called nor counted', async () => {
  resetPoolHealth();
  const { fetchRows } = keysDb(); const calls = []; let counted = 0;
  const callModel = async (args, dd) => { calls.push(dd.env?.OPENAI_API_KEY); if (dd.env?.OPENAI_API_KEY === 'sk-mine') await new Promise(r => setTimeout(r, 1200)); return { provider: args.provider, text: 'ok' }; };
  const r = await runAs('o', me, () => firstAvailable(['anthropic', 'openai'], { input: 'x' }, {
    env: { ANTHROPIC_API_KEY: 'firm', ANTHROPIC_MODEL: 'm', OPENAI_API_KEY: 'firm-oa' }, fetchRows, sealer, callModel, healthStore, countAiCall: async () => { counted++; } }));
  assert.equal(r.via, 'personal'); assert.deepEqual(calls, ['sk-mine']); assert.equal(counted, 0);
});

test('« Mon IA »: a call cancelled by the application is not written as an error on the person’s key', async () => {
  const { patches, fetchRows } = keysDb();
  const cancelled = async () => { throw new DOMException('POOL_CANCELLED', 'AbortError'); };
  assert.equal(await runAs('o', me, () => tryPersonal(['openai'], { input: 'x' }, cancelled, { fetchRows, sealer })), null);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(patches, []);
  // A real refusal is still written.
  await runAs('o', me, () => tryPersonal(['openai'], { input: 'x' }, async () => { throw new Error('OPENAI_401: invalid key'); }, { fetchRows, sealer }));
  await new Promise(r => setTimeout(r, 20));
  assert.match(patches[0]?.last_error || '', /OPENAI_401/);
});
