import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeForbiddenHere, listDriveChildren } from '../lib/google-drive.js';

// Test run "TATY TEST": a preview must never reach the REAL firm Drive through the Supabase
// bridge (bound to the real Drive) or start the real Drive's scan worker.
test('the bridge is forbidden in preview (and with OFFICE_MANAGER_TEST_RUN=on), allowed in production', async () => {
  assert.equal(bridgeForbiddenHere({ VERCEL_ENV: 'production' }), false);
  assert.equal(bridgeForbiddenHere({}), false);
  assert.equal(bridgeForbiddenHere({ VERCEL_ENV: 'preview' }), true);
  assert.equal(bridgeForbiddenHere({ OFFICE_MANAGER_TEST_RUN: 'on' }), true);

  const saved = { ...process.env };
  try {
    Object.assign(process.env, { VERCEL_ENV: 'preview', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', ORPAILLEUR_JOB_SECRET: 's' });
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    const realFetch = globalThis.fetch; let called = false;
    globalThis.fetch = async () => { called = true; return { ok: true, text: async () => '{}' }; };
    try {
      await assert.rejects(listDriveChildren('ROOT'), /PREVIEW_BRIDGE_FORBIDDEN/);
      assert.equal(called, false, 'no request left for the real Drive');
    } finally { globalThis.fetch = realFetch; }
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
