import { createHmac, timingSafeEqual, createHash } from "node:crypto";
export const MAX_BYTES = 3_000_000;
export const fail = (code, statusCode = 400) =>
  Object.assign(new Error(code), { statusCode });
export function signRequest(secret, body, claims, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      ...claims,
      exp: now + 60_000,
      hash: createHash("sha256").update(body).digest("hex"),
    }),
  ).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", secret).update(payload).digest("base64url")
  );
}
export function verifyRequest(secret, token, body, orgId, now = Date.now()) {
  if (typeof token !== "string" || token.length > 6000)
    throw fail("CONNECTOR_UNAUTHORIZED", 401);
  const [payload, signature] = token.split("."),
    expected = createHmac("sha256", secret)
      .update(payload || "")
      .digest("base64url");
  const a = Buffer.from(signature || ""),
    b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw fail("CONNECTOR_UNAUTHORIZED", 401);
  let c;
  try {
    c = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    throw fail("CONNECTOR_UNAUTHORIZED", 401);
  }
  if (
    !c.subject ||
    c.org !== orgId ||
    !Number.isFinite(c.exp) ||
    c.exp < now ||
    c.exp > now + 65_000 ||
    c.hash !== createHash("sha256").update(body).digest("hex")
  )
    throw fail("CONNECTOR_UNAUTHORIZED", 401);
  return c;
}
