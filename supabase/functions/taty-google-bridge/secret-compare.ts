// Constant-time comparison of the bridge secret (audit 2026-10-29: `supplied !== JOB_SECRET` stops at the first different character).
// Both values are hashed first, so the comparison always runs over 32 bytes whatever the lengths. Web standards only (Deno and Node).
export async function secretsMatch(supplied: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(supplied ?? ""))),
    crypto.subtle.digest("SHA-256", enc.encode(String(expected)))
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
