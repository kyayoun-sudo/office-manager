import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../lib/diagnostic.js';

const env = { OFFICE_MANAGER_ACCESS_TOKEN: 'acces-123', OFFICE_MANAGER_OWNER_TOKEN: ' proprio-456 ', VERCEL_ENV: 'preview', SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' };

test('diagnostic: recognises the access code; never says whether a typed code is the owner code', () => {
  const a = diagnose({ code: 'acces-123' }, env);
  assert.equal(a.access_code.matches, true);
  assert.ok(!JSON.stringify(a).includes('acces-123') && !JSON.stringify(a).includes('proprio'));
  // Audit 2026-10-30: the owner code typed exactly answers the same as a wrong one (no way to guess it here).
  const o = diagnose({ code: ' proprio-456 ' }, env), wrong = diagnose({ code: 'nope' }, env);
  assert.deepEqual(o.owner_code, wrong.owner_code);
  assert.equal(o.owner_code.matches, undefined);
  assert.equal(o.owner_code.configured, true);
  assert.equal(o.owner_code.extra_spaces, true, 'stray spaces in Vercel are still detected');
  assert.equal(diagnose({}, { OFFICE_MANAGER_ACCESS_TOKEN: 'same', OFFICE_MANAGER_OWNER_TOKEN: 'same' }).owner_code.same_as_access_code, true);
});

test('diagnostic: a limited number of tries per address', async () => {
  const { _resetAttempts } = await import('../lib/attempts.js');
  _resetAttempts();
  const req = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } };
  for (let i = 0; i < 10; i++) diagnose({ code: 'x' + i }, env, req);
  assert.throws(() => diagnose({ code: 'again' }, env, req), /TOO_MANY_ATTEMPTS/);
  diagnose({ code: 'x' }, env, { headers: { 'x-forwarded-for': '198.51.100.2' } });
  _resetAttempts();
});

test('diagnostic: reports missing variables', () => {
  const d = diagnose({ code: 'x' }, {});
  assert.equal(d.access_code.configured, false);
  assert.equal(d.owner_code.configured, false);
  assert.equal(d.supabase_configured, false);
  assert.equal(d.organisation_configured, false);
  assert.throws(() => diagnose({ code: 'x'.repeat(501) }, env), /CODE_TOO_LONG/);
});
