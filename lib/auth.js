import crypto from "node:crypto";

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export function requirePilotAccess(req) {
  const expected = process.env.OFFICE_MANAGER_ACCESS_TOKEN;
  if (!expected) throw new Error("OFFICE_MANAGER_ACCESS_TOKEN_MISSING");

  const supplied = req.headers["x-office-manager-token"];
  if (!safeEqual(supplied, expected)) {
    const error = new Error("UNAUTHORIZED");
    error.statusCode = 401;
    throw error;
  }
}
