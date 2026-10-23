import test from 'node:test';
import assert from 'node:assert/strict';
import { EVALUATION_CASES } from './evaluation-cases.js';
import { buildProfessionalRequest } from './router.js';

function includesAll(actual = [], expected = []) {
  const set = new Set(actual);
  return expected.every((item) => set.has(item));
}

test('professional evaluation corpus has broad permanent coverage', () => {
  assert.ok(EVALUATION_CASES.length >= 50);
  assert.ok(EVALUATION_CASES.some((row) => row.expected_domains.includes('accounting')));
  assert.ok(EVALUATION_CASES.some((row) => row.expected_domains.includes('audit')));
  assert.ok(EVALUATION_CASES.some((row) => row.expected_domains.includes('advisory')));
  assert.ok(EVALUATION_CASES.some((row) => row.expected_domains.length === 3));
});

for (const evalCase of EVALUATION_CASES) {
  test(`eval routing: ${evalCase.id}`, () => {
    const result = buildProfessionalRequest(evalCase.input);
    assert.ok(includesAll(result.domains, evalCase.expected_domains), `domains: ${JSON.stringify(result.domains)}`);
    assert.ok(includesAll(result.topics, evalCase.expected_topics), `topics: ${JSON.stringify(result.topics)}`);
  });
}
