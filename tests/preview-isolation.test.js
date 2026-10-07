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

import { assertWritableTarget } from '../lib/google-drive.js';
import { isTestMode, assertIsolatedOrg } from '../lib/test-mode.js';

const TEST_ENV = { VERCEL_ENV: 'preview', TATY_SHARED_DRIVE_ID: 'TESTDRIVE', TEST_SOURCE_DRIVE_ID: 'REALDRIVE' };

test('test mode: one definition, never in production even with an override', () => {
  assert.equal(isTestMode({ VERCEL_ENV: 'production', OFFICE_MANAGER_TEST_RUN: 'on', AGENT_MAIL_SANDBOX: 'on' }), false);
  assert.equal(isTestMode({ VERCEL_ENV: 'preview' }), true);
  assert.equal(isTestMode({ AGENT_MAIL_SANDBOX: 'on' }), true);
  assert.equal(isTestMode({}), false);
});

test('write guard: in test mode every Drive write must land in the test Drive; production unchanged', async () => {
  const meta = async id => ({ id, driveId: id.startsWith('t-') ? 'TESTDRIVE' : 'REALDRIVE' });
  await assert.doesNotReject(assertWritableTarget('t-folder', { env: TEST_ENV, meta }));
  await assert.doesNotReject(assertWritableTarget('TESTDRIVE', { env: TEST_ENV, meta }));
  await assert.rejects(assertWritableTarget('real-master-sheet', { env: TEST_ENV, meta }), /TEST_MODE_WRITE_OUTSIDE_TEST_DRIVE_REFUSED/);
  await assert.rejects(assertWritableTarget('REALDRIVE', { env: TEST_ENV, meta }), /TEST_MODE_WRITE_TO_REAL_DRIVE_REFUSED/);
  await assert.rejects(assertWritableTarget('', { env: TEST_ENV, meta }), /TEST_MODE_WRITE_TARGET_REQUIRED/);
  await assert.rejects(assertWritableTarget('t-x', { env: { VERCEL_ENV: 'preview', TATY_SHARED_DRIVE_ID: 'SAME', TEST_SOURCE_DRIVE_ID: 'SAME' }, meta }), /TEST_MODE_TARGET_DRIVE_NOT_SET/);
  let called = false;
  await assertWritableTarget('real-master-sheet', { env: { VERCEL_ENV: 'production' }, meta: async () => { called = true; } });
  assert.equal(called, false, 'production: no check, no extra call');
});

test('every route refuses the real firm in test mode, and a test mode without the real firm declared', async () => {
  assert.throws(() => assertIsolatedOrg('test-org', { VERCEL_ENV: 'preview' }), /TEST_MODE_REAL_ORG_NOT_DECLARED/);
  assert.throws(() => assertIsolatedOrg('real-org', { VERCEL_ENV: 'preview', TEST_RUN_FORBIDDEN_ORG_IDS: 'real-org' }), /TEST_MODE_ON_REAL_ORG/);
  assert.doesNotThrow(() => assertIsolatedOrg('test-org', { VERCEL_ENV: 'preview', TEST_RUN_FORBIDDEN_ORG_IDS: 'real-org' }));
  assert.doesNotThrow(() => assertIsolatedOrg('real-org', { VERCEL_ENV: 'production', TEST_RUN_FORBIDDEN_ORG_IDS: 'real-org' }));
  const { handleApp } = await import('../api/app.js');
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { VERCEL_ENV: 'preview', DEFAULT_ORG_ID: 'real-org', TEST_RUN_FORBIDDEN_ORG_IDS: 'real-org', OFFICE_MANAGER_ACCESS_TOKEN: 'tok' });
    await assert.rejects(handleApp({ method: 'GET', query: { route: 'passes' }, headers: { 'x-office-manager-token': 'tok' } }), /TEST_MODE_ON_REAL_ORG/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

import { configuredDriveId, masterSheetId } from '../lib/google-drive.js';
import { inboxQuery } from '../lib/agent-mailbox.js';

test('test mode: no silent fallback to the real firm files, and only a TEST mail label is read', () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { VERCEL_ENV: 'preview' });
    delete process.env.TATY_SHARED_DRIVE_ID; delete process.env.TATY_MASTER_SHEET_ID;
    assert.throws(() => configuredDriveId(), /TEST_MODE_DRIVE_ID_NOT_SET/);
    assert.throws(() => masterSheetId(), /TEST_MODE_DRIVE_ID_NOT_SET/);
    process.env.TATY_SHARED_DRIVE_ID = 'TESTDRIVE';
    assert.equal(configuredDriveId(), 'TESTDRIVE');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  assert.equal(inboxQuery({ VERCEL_ENV: 'preview', AGENT_MAIL_INBOX_LABEL: 'PBC' }), null);
  assert.match(inboxQuery({ VERCEL_ENV: 'preview', AGENT_MAIL_INBOX_LABEL: 'PBC-TEST' }), /PBC-TEST/);
  assert.match(inboxQuery({ VERCEL_ENV: 'production', AGENT_MAIL_INBOX_LABEL: 'PBC' }), /label:"PBC"/);
});
