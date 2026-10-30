import crypto from 'node:crypto';
import { checkAttempts, countAttempt } from './attempts.js';

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
  const supplied = req.headers?.['x-office-manager-owner-token'];
  // A typed code that is wrong counts; an empty header (pages using the person's session) does not (audit 2026-10-30).
  if (supplied) checkAttempts('owner-code', req);
  if (!safeEqual(supplied, expected)) {
    if (supplied) countAttempt('owner-code', req);
    throw Object.assign(new Error('OWNER_ONLY'), { statusCode: 403 });
  }
}
