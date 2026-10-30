// Too many tries of a secret code from one address (audit 2026-10-30: the public « diagnostic » route answered « right /
// wrong » for the codes without any limit). Kept in this server instance only: a brake against guessing, not a guarantee
// (Vercel runs several instances). Nothing about the code is stored, only a count per address and kind.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRIES = 10;
const seen = new Map(); // `${kind}|${address}` -> { count, since }

export function callerAddress(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req?.headers?.['x-real-ip'] || req?.socket?.remoteAddress || 'unknown');
}

function entry(kind, req, now) {
  const key = kind + '|' + callerAddress(req);
  const e = seen.get(key);
  if (!e || now - e.since > WINDOW_MS) { const fresh = { count: 0, since: now }; seen.set(key, fresh); return fresh; }
  return e;
}

// Throws TOO_MANY_ATTEMPTS (429) once the address has used its tries for this kind.
export function checkAttempts(kind, req, now = Date.now()) {
  if (entry(kind, req, now).count >= MAX_TRIES) throw Object.assign(new Error('TOO_MANY_ATTEMPTS'), { statusCode: 429 });
}
export function countAttempt(kind, req, now = Date.now()) {
  entry(kind, req, now).count++;
  if (seen.size > 5000) seen.delete(seen.keys().next().value);
}
export function _resetAttempts() { seen.clear(); }
