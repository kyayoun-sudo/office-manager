import crypto from "node:crypto";

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

// The shared pilot token (audit 2026-10-30: it no longer opens anything alone). With { allowSession: true } — and ONLY
// from a caller that verifies the session itself right after (requireRole, requirePersonOrServer, currentAccount) —
// a request carrying a personal session passes without the token: the step that will remove it from the browser.
// The session is NOT verified here: 'unverified-session' says so. Fail closed by default, and when the server has no token.
const BEARER = /^Bearer\s+[A-Za-z0-9\-_.]{20,4096}$/;
export function requirePilotAccess(req, { allowSession = false } = {}) {
  const expected = process.env.OFFICE_MANAGER_ACCESS_TOKEN;
  if (!expected) throw new Error("OFFICE_MANAGER_ACCESS_TOKEN_MISSING");
  const supplied = req.headers["x-office-manager-token"];
  if (safeEqual(supplied, expected)) return "token";
  if (allowSession && BEARER.test(String(req.headers?.authorization || req.headers?.Authorization || ""))) return "unverified-session";
  const error = new Error("UNAUTHORIZED");
  error.statusCode = 401;
  throw error;
}
