import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { secretsMatch } from '../supabase/functions/taty-google-bridge/secret-compare.ts';

test('bridge secret: equal passes, anything else fails, an empty configured secret never passes', async () => {
  assert.equal(await secretsMatch('s3cret-value-of-the-job', 's3cret-value-of-the-job'), true);
  assert.equal(await secretsMatch('s3cret-value-of-the-jobX', 's3cret-value-of-the-job'), false);
  assert.equal(await secretsMatch('', 's3cret'), false);
  assert.equal(await secretsMatch('s3cret', ''), false);
  assert.equal(await secretsMatch('', ''), false, 'no secret configured = refused');
  assert.equal(await secretsMatch(undefined, 'x'), false);
});

test('the bridge uses it, not a plain comparison', () => {
  const src = readFileSync(new URL('../supabase/functions/taty-google-bridge/index.ts', import.meta.url), 'utf8');
  assert.match(src, /secretsMatch\(supplied, JOB_SECRET\)/);
  assert.doesNotMatch(src, /supplied !== JOB_SECRET/);
});
