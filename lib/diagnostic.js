import crypto from 'node:crypto';

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

export function diagnose(body = {}, env = process.env) {
  const typed = String(body.code ?? '');
  if (typed.length > 500) throw Object.assign(new Error('CODE_TOO_LONG'), { statusCode: 400 });
  return {
    environment: env.VERCEL_ENV || 'inconnu',
    branch: env.VERCEL_GIT_COMMIT_REF || null,
    access_code: inspect(env.OFFICE_MANAGER_ACCESS_TOKEN, typed),
    owner_code: inspect(env.OFFICE_MANAGER_OWNER_TOKEN, typed),
    supabase_configured: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    organisation_configured: Boolean(env.DEFAULT_ORG_ID)
  };
}
