// Test mode (test run "TATY TEST", 2026-10-07, hardened after an independent review).
// ONE definition used everywhere: the app is in test mode in a Vercel PREVIEW, or when
// OFFICE_MANAGER_TEST_RUN / AGENT_MAIL_SANDBOX is "on" — but NEVER in production
// (an override set by mistake in production is ignored, production keeps working).
//
// In test mode:
//   - the Supabase bridge and the scan worker (bound to the real Drive) are forbidden;
//   - every Drive write must land in the TEST Shared Drive (lib/google-drive.js guard);
//   - e-mails can only reach the sandbox addresses (lib/agent-mail.js);
//   - every route refuses to run on the real firm's organisation.

const on = v => String(v || '').toLowerCase() === 'on';
const listFrom = v => String(v || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);

export function isTestMode(env = process.env) {
  if (env.VERCEL_ENV === 'production') return false;
  return env.VERCEL_ENV === 'preview' || on(env.OFFICE_MANAGER_TEST_RUN) || on(env.AGENT_MAIL_SANDBOX);
}

export function forbiddenOrgIds(env = process.env) {
  return listFrom(env.TEST_RUN_FORBIDDEN_ORG_IDS);
}

// In test mode, the organisation must be declared isolated from the real firm:
// TEST_RUN_FORBIDDEN_ORG_IDS (the real firm's id) must be set and must not contain it.
export function assertIsolatedOrg(orgId, env = process.env) {
  if (!isTestMode(env)) return;
  const forbidden = forbiddenOrgIds(env);
  if (!forbidden.length) throw Object.assign(new Error('TEST_MODE_REAL_ORG_NOT_DECLARED'), { statusCode: 503 });
  if (!orgId || forbidden.includes(orgId)) throw Object.assign(new Error('TEST_MODE_ON_REAL_ORG'), { statusCode: 503 });
}

// Paul's addresses playing the firm's team in the test (empty outside test mode).
export function sandboxColleagues(env = process.env) {
  if (!isTestMode(env)) return [];
  return listFrom(env.AGENT_MAIL_SANDBOX_COLLEAGUES).map(s => s.toLowerCase());
}

export function testDrives(env = process.env) {
  return { target: env.TATY_SHARED_DRIVE_ID || '', source: env.TEST_SOURCE_DRIVE_ID || '' };
}
