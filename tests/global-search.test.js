import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeQuery, normalizeScope, buildSearchPaths, globalSearch } from '../lib/global-search.js';

test('search: query is cleaned of filter syntax but keeps accents', () => {
  assert.equal(sanitizeQuery('  balance âgée, (Nova)*.  '), 'balance âgée Nova');
  assert.equal(sanitizeQuery('a),or=(id.neq.0'), 'a or id neq 0');
  assert.equal(sanitizeQuery('x'.repeat(200)).length, 80);
});

test('search: scopes are restricted', () => {
  assert.equal(normalizeScope(undefined), 'all');
  assert.equal(normalizeScope('Documents'), 'documents');
  assert.throws(() => normalizeScope('salaries'), /INVALID_SCOPE/);
});

test('search: every path is scoped to the organisation and never touches HR profiles', () => {
  const paths = buildSearchPaths('org-1', 'nova');
  for (const p of Object.values(paths)) {
    assert.match(p, /org_id=eq\.org-1/);
    assert.ok(!/management_profiles|questionnaire|email/.test(p));
  }
  assert.match(paths.documents, /^orpailleur_inventory\?/);
  assert.match(paths.missions, /^office_missions\?/);
  assert.match(paths.people, /^office_staff_profiles\?.*active=eq\.true/);
});

test('search: groups results, reports unavailable sources, stays read-only', async () => {
  const seen = [];
  const fake = async path => {
    seen.push(path);
    if (path.startsWith('office_staff_profiles')) throw new Error('down');
    if (path.startsWith('office_missions')) return [{ id: 'm1', name: 'Nova Services' }];
    return [{ file_id: 'f1', name: 'balance_clients.xlsx' }, { file_id: 'f2', name: 'pbc_nova.xlsx' }];
  };
  const r = await globalSearch('org-1', 'nova', 'all', fake);
  assert.equal(r.total, 3);
  assert.equal(r.results.missions.length, 1);
  assert.deepEqual(r.unavailable, ['people']);
  assert.equal(r.read_only, true);
  assert.equal(seen.length, 3);

  const only = await globalSearch('org-1', 'nova', 'missions', fake);
  assert.deepEqual(Object.keys(only.results), ['missions']);
  await assert.rejects(globalSearch('org-1', ' a ', 'all', fake), /QUERY_TOO_SHORT/);
});
