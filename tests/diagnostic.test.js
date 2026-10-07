import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../lib/diagnostic.js';

const env = { OFFICE_MANAGER_ACCESS_TOKEN: 'acces-123', OFFICE_MANAGER_OWNER_TOKEN: ' proprio-456 ', VERCEL_ENV: 'preview', SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' };

test('diagnostic: recognises the access code and the owner code, never returns a secret', () => {
  const a = diagnose({ code: 'acces-123' }, env);
  assert.equal(a.access_code.matches, true);
  assert.equal(a.owner_code.matches, false);
  assert.ok(!JSON.stringify(a).includes('acces-123') && !JSON.stringify(a).includes('proprio'));
  const o = diagnose({ code: 'proprio-456' }, env);
  assert.equal(o.owner_code.matches, false);
  assert.equal(o.owner_code.matches_without_spaces, true, 'stray spaces in Vercel are detected');
  assert.equal(o.owner_code.extra_spaces, true);
});

test('diagnostic: reports missing variables', () => {
  const d = diagnose({ code: 'x' }, {});
  assert.equal(d.access_code.configured, false);
  assert.equal(d.owner_code.configured, false);
  assert.equal(d.supabase_configured, false);
  assert.equal(d.organisation_configured, false);
  assert.throws(() => diagnose({ code: 'x'.repeat(501) }, env), /CODE_TOO_LONG/);
});
