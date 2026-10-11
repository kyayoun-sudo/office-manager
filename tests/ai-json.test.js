import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonLoose } from '../lib/ai-plus.js';
import { shadowAI } from '../lib/shadow.js';

test('a cut-off JSON answer keeps its complete elements; no JSON at all is refused', () => {
  assert.deepEqual(parseJsonLoose('{"tests":[{"a":1},{"b":2},{"c":'), { tests: [{ a: 1 }, { b: 2 }] });
  assert.deepEqual(parseJsonLoose('```json\n{"x":[1,2,],}\n```'), { x: [1, 2] });
  assert.throws(() => parseJsonLoose('rien'), /AI_JSON_UNREADABLE/);
});

test('Shadow: an unreadable JSON answer makes the next provider try', async () => {
  const lab = { usage: {}, agents: {}, calls: [] };
  const seen = [];
  const ai = async order => { seen.push(order[0]); return order[0] === 'anthropic' ? { provider: 'anthropic', text: 'Désolé, voici :' } : { provider: order[0], text: '{"ok":true}' }; };
  const r = await shadowAI(lab, { instructions: 'Réponds en JSON STRICT', input: 'x' }, { kind: 'test' }, { ai, env: {} });
  assert.equal(r.provider, 'openai'); assert.deepEqual(seen, ['anthropic', 'openai']);
});
