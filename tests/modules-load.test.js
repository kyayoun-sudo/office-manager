import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

// Every serverless entry point must at least load (a syntax error there breaks production
// without any other test noticing — found by the review of 2026-10-07).
test('every api/*.js and lib/*.js module loads', async () => {
  for (const dir of ['api', 'lib']) {
    for (const f of readdirSync(new URL('../' + dir + '/', import.meta.url)).filter(n => n.endsWith('.js'))) {
      await assert.doesNotReject(import('../' + dir + '/' + f), dir + '/' + f);
    }
  }
});
