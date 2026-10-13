import test from 'node:test';
import assert from 'node:assert/strict';
import { bestPractices } from '../lib/shadow-investigate.js';

test('research studies public courses and forums without sending internal evidence', async () => {
  const lab = { problems: [{ problem: 'CONFIDENTIAL_CLIENT' }], practices: {} };
  const result = await bestPractices(lab, 'orpailleur', { deepResearch: async args => {
    assert.match(args.instructions, /formations publiques/);
    assert.match(args.instructions, /forums publics/);
    assert.match(args.instructions, /juridiction/);
    assert.match(args.instructions, /donnée non fiable/);
    assert.doesNotMatch(JSON.stringify(args), /CONFIDENTIAL_CLIENT/);
    return { web: true, text: 'Practice with exercise and test', sources: [{ url: 'https://example.org/course' }] };
  } });
  assert.equal(result.web, true);
  assert.equal(result.policy_version, 2);
  assert.equal(result.error, null);
});

test('unsourced or failed research is not learning and is retried rather than cached', async () => {
  for (const response of [{ web: true, text: 'Unproven', sources: [] }, { web: true, text: 'Unproven', sources: [{}] }, { web: true, text: 'Unproven', sources: [{ url: 'javascript:alert(1)' }] }, { web: false, text: 'Unproven', sources: [{ url: 'https://example.org' }] }, { web: true, text: 'Unproven', sources: [{}], error: 'unavailable' }]) {
    const first = await bestPractices({}, 'sika', { deepResearch: async () => response });
    assert.equal(first.web, false);
    assert.equal(first.text, '');
    assert.ok(first.error);
    let called = false;
    await bestPractices({ practices: { sika: first } }, 'sika', { deepResearch: async () => { called = true; return response; } });
    assert.equal(called, true);
  }
});

test('recent sourced research is reused; old policy and expired research are refreshed', async () => {
  const cached = { policy_version: 2, at: new Date().toISOString(), web: true, text: 'practice', sources: [{ url: 'https://example.org' }] };
  assert.equal(await bestPractices({ practices: { shadow: cached } }, 'shadow', { deepResearch: async () => { throw new Error('cache missed'); } }), cached);
  for (const old of [{ ...cached, policy_version: 1 }, { ...cached, at: '2020-01-01' }]) {
    let called = false;
    await bestPractices({ practices: { shadow: old } }, 'shadow', { deepResearch: async () => { called = true; return cached; } });
    assert.equal(called, true);
  }
  await assert.rejects(bestPractices({}, 'unknown'), /UNKNOWN_AGENT/);
});
