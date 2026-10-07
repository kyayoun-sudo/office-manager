import crypto from 'node:crypto';

// Owner / managing-partner credential for the firm settings.
// Same credential as the existing owner endpoint (api/owner.js):
// header x-office-manager-owner-token = OFFICE_MANAGER_OWNER_TOKEN.
// Distinct from the pilot token used by every collaborator.

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function requireFirmOwner(req) {
  const expected = process.env.OFFICE_MANAGER_OWNER_TOKEN;
  if (!expected) throw Object.assign(new Error('OWNER_SETTINGS_NOT_CONFIGURED'), { statusCode: 503 });
  if (!safeEqual(req.headers?.['x-office-manager-owner-token'], expected)) {
    throw Object.assign(new Error('OWNER_ONLY'), { statusCode: 403 });
  }
}
