import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firmPeople } from '../lib/work-programme.js';

test('anyone in the firm can be chosen as preparer, once each, not only the mission team', async () => {
  const rows = [{ full_name: 'Ana', email: 'a@x' }, { full_name: 'Ana', email: 'A@x' }, { full_name: 'Bo', email: null, role_title: 'Senior' }, { full_name: null }];
  assert.deepEqual(await firmPeople('org', async () => rows), [{ name: 'Ana', email: 'a@x', role: null }, { name: 'Bo', email: null, role: 'Senior' }]);
  assert.deepEqual(await firmPeople('org', async () => { throw new Error('x'); }), []);
});

test('programme page: changing the cycle preparer moves the tests that followed it, and a save bar stays visible', () => {
  const html = readFileSync(new URL('../programme.html', import.meta.url), 'utf8');
  assert.match(html, /Autres personnes du cabinet/);
  assert.match(html, /p\.preparer = ''/);
  assert.match(html, /id="savebar"/);
  assert.match(html, /\$\('save-now'\)\.addEventListener\('click', function \(\) \{ \$\('save'\)\.click\(\); \}\)/);
});
