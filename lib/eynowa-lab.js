// Authenticated connection to EYNOWA local AI.
// Preferred path: Vercel -> Cloudflare broker -> Queue -> cabinet worker -> local gateway/Ollama.
// Legacy direct EYNOWA_LAB_URL remains supported for local/dev compatibility.
const cleanUrl = value => String(value || '').trim().replace(/\/$/, '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function validHttpsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash;
  } catch {
    return false;
  }
}

export function brokerReady(env = process.env) {
  return Boolean(
    env.EYNOWA_BROKER_KEY &&
    validHttpsUrl(cleanUrl(env.EYNOWA_BROKER_URL))
  );
}

function legacyReady(env = process.env) {
  return Boolean(
    env.EYNOWA_LAB_API_KEY &&
    validHttpsUrl(cleanUrl(env.EYNOWA_LAB_URL))
  );
}

export function labReady(env = process.env) {
  return brokerReady(env) || legacyReady(env);
}

async function brokerRequest(path, { method = 'GET', body, env = process.env, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!brokerReady(env)) throw new Error('EYNOWA_BROKER_NOT_CONFIGURED');
  const response = await fetchImpl(cleanUrl(env.EYNOWA_BROKER_URL) + path, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + env.EYNOWA_BROKER_KEY,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error('EYNOWA_BROKER_HTTP_' + response.status + ': ' + String(data?.error || '').slice(0, 160));
  return data;
}

async function brokerLocalChat(body, { env = process.env, fetchImpl = fetch, timeoutMs } = {}) {
  const totalTimeout = Math.max(5000, Number(timeoutMs || env.EYNOWA_BROKER_TIMEOUT_MS || 45000));
  const created = await brokerRequest('/job', {
    method: 'POST',
    body: {
      type: 'ai.local_chat',
      request: {
        prompt: String(body?.prompt || ''),
        system: String(body?.system || ''),
        model: body?.model || env.EYNOWA_LAB_MODEL || env.OLLAMA_CHAT_MODEL || 'llama3.2:3b'
      }
    },
    env,
    fetchImpl,
    timeoutMs: Math.min(10000, totalTimeout)
  });
  const jobId = String(created?.job_id || '').trim();
  if (!jobId) throw new Error('EYNOWA_BROKER_JOB_ID_MISSING');

  const deadline = Date.now() + totalTimeout;
  while (Date.now() < deadline) {
    const result = await brokerRequest('/result/' + encodeURIComponent(jobId), {
      env,
      fetchImpl,
      timeoutMs: Math.min(10000, Math.max(1000, deadline - Date.now()))
    });
    if (result?.status === 'completed') {
      const local = result.response || {};
      return {
        ...local,
        done: local.done !== false,
        response: local.response ?? local.text ?? '',
        model: local.model || body?.model || env.EYNOWA_LAB_MODEL || env.OLLAMA_CHAT_MODEL || 'llama3.2:3b'
      };
    }
    if (result?.status === 'failed') throw new Error('EYNOWA_BROKER_JOB_FAILED: ' + String(result?.error || 'UNKNOWN').slice(0, 160));
    await sleep(650);
  }
  throw new Error('EYNOWA_BROKER_TIMEOUT');
}

export async function labRequest(path, body, { env = process.env, fetchImpl = fetch, timeoutMs = 65000 } = {}) {
  if (!labReady(env)) throw new Error('EYNOWA_LAB_NOT_CONFIGURED');
  if (!['/health', '/ai/local-chat'].includes(path)) throw new Error('EYNOWA_LAB_OPERATION_NOT_ALLOWED');

  // Vercel uses the stable broker. The PC never needs an inbound public URL.
  if (brokerReady(env)) {
    if (path === '/ai/local-chat') return brokerLocalChat(body || {}, { env, fetchImpl, timeoutMs });
    return { ok: true, broker: true, configured: true };
  }

  // Legacy direct gateway kept for tests/local development and old installations.
  const response = await fetchImpl(cleanUrl(env.EYNOWA_LAB_URL) + path, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.EYNOWA_LAB_API_KEY },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error('EYNOWA_LAB_HTTP_' + response.status);
  const text = await response.text();
  if (text.length > 1024 * 1024) throw new Error('EYNOWA_LAB_RESPONSE_TOO_LARGE');
  return JSON.parse(text);
}
