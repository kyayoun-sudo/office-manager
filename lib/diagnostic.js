import crypto from 'node:crypto';
import { checkAttempts, countAttempt } from './attempts.js';

// "Vérifier mon code": tells the person which code they typed and what is
// missing on the server, WITHOUT ever revealing a secret value.
// Same information as a login attempt (right / wrong code), plus whether each
// variable exists and whether its value has stray spaces (common copy-paste error).

function sameText(a, b) {
  const aa = crypto.createHash('sha256').update(String(a)).digest();
  const bb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(aa, bb);
}

function inspect(envValue, typed) {
  const configured = typeof envValue === 'string' && envValue.length > 0;
  if (!configured) return { configured: false, extra_spaces: false, matches: false, matches_without_spaces: false };
  const extra = envValue !== envValue.trim();
  return {
    configured: true,
    extra_spaces: extra,
    matches: Boolean(typed) && sameText(envValue, typed),
    matches_without_spaces: Boolean(typed) && sameText(envValue.trim(), typed.trim())
  };
}

export function diagnose(body = {}, env = process.env, req = null) {
  const typed = String(body.code ?? '');
  if (typed.length > 500) throw Object.assign(new Error('CODE_TOO_LONG'), { statusCode: 400 });
  // Public route (audit 2026-10-30): a limited number of tries per address.
  if (req) { checkAttempts('diagnostic', req); countAttempt('diagnostic', req); }
  // The owner code is never checked here any more: « is this the owner code? » answered to anyone was a way to guess
  // it. Only whether it is set and whether its value has stray spaces.
  const owner = inspect(env.OFFICE_MANAGER_OWNER_TOKEN, '');
  return {
    environment: env.VERCEL_ENV || 'inconnu',
    branch: env.VERCEL_GIT_COMMIT_REF || null,
    access_code: inspect(env.OFFICE_MANAGER_ACCESS_TOKEN, typed),
    owner_code: { configured: owner.configured, extra_spaces: owner.extra_spaces, checked: false,
      same_as_access_code: owner.configured && Boolean(env.OFFICE_MANAGER_ACCESS_TOKEN) && sameText(env.OFFICE_MANAGER_OWNER_TOKEN, env.OFFICE_MANAGER_ACCESS_TOKEN) },
    supabase_configured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    organisation_configured: Boolean(env.DEFAULT_ORG_ID)
  };
}
