// Authenticated connection to the user's deployed laboratory gateway.
export function labReady(env = process.env) {
  if (!env.EYNOWA_LAB_API_KEY || !env.EYNOWA_LAB_URL) return false;
  try { const u = new URL(env.EYNOWA_LAB_URL); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
}
export async function labRequest(path, body, { env = process.env, fetchImpl = fetch, timeoutMs = 65000 } = {}) {
  if (!labReady(env)) throw new Error('EYNOWA_LAB_NOT_CONFIGURED');
  if (!['/health', '/ai/local-chat'].includes(path)) throw new Error('EYNOWA_LAB_OPERATION_NOT_ALLOWED');
  const response = await fetchImpl(env.EYNOWA_LAB_URL.replace(/\/$/, '') + path, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.EYNOWA_LAB_API_KEY },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error('EYNOWA_LAB_HTTP_' + response.status);
  const text = await response.text();
  if (text.length > 1024 * 1024) throw new Error('EYNOWA_LAB_RESPONSE_TOO_LARGE');
  return JSON.parse(text);
}
