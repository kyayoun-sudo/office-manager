import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowSelfSignals } from '../lib/shadow-investigate.js';

test('la couverture tient compte des observations et examens récents par agent', () => {
  const now = Date.now();
  const lab = {
    agents: {
      orpailleur: { last_observed_at: new Date(now - 2 * 86400000).toISOString() },
      sika: {}
    },
    exams: [{ agent: 'sika', at: new Date(now - 3 * 86400000).toISOString() }],
    problems: []
  };

  const coverage = shadowSelfSignals(lab).find(signal => signal.outcome === 'coverage');

  assert.ok(coverage);
  assert.doesNotMatch(coverage.text, /orpailleur|sika/);
});

test('la couverture signale un agent sans observation ni examen depuis 14 jours', () => {
  const lab = {
    agents: { orpailleur: { last_observed_at: new Date(Date.now() - 15 * 86400000).toISOString() } },
    exams: [],
    problems: []
  };

  const coverage = shadowSelfSignals(lab).find(signal => signal.outcome === 'coverage');

  assert.ok(coverage);
  assert.match(coverage.text, /orpailleur/);
});
