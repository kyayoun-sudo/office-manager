// EYNOWA local broker worker v3
// Vercel -> Cloudflare broker/Queue -> this PC worker -> local EYNOWA Gateway.
//
// Supported jobs are deliberately allow-listed. The worker never executes
// arbitrary URLs or application actions received from the queue.
//
// Required env:
//   CLOUDFLARE_ACCOUNT_ID
//   CLOUDFLARE_QUEUE_ID
//   CLOUDFLARE_QUEUE_TOKEN
//   EYNOWA_LAB_API_KEY
//   EYNOWA_BROKER_URL
//   EYNOWA_BROKER_KEY
// Optional:
//   EYNOWA_LOCAL_GATEWAY_URL (default http://127.0.0.1:8787)
//   EYNOWA_WORKER_POLL_MS (default 1000)
//
// Supported job types:
//   ai.local_chat      -> POST /ai/local-chat
//   professional.query -> POST /v1/professional/query

const CF_API = 'https://api.cloudflare.com/client/v4';

function cleanUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function envConfig(env = process.env) {
  const config = {
    accountId: String(env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
    queueId: String(env.CLOUDFLARE_QUEUE_ID || '').trim(),
    queueToken: String(env.CLOUDFLARE_QUEUE_TOKEN || '').trim(),
    gatewayKey: String(env.EYNOWA_LAB_API_KEY || '').trim(),
    brokerUrl: cleanUrl(env.EYNOWA_BROKER_URL),
    brokerKey: String(env.EYNOWA_BROKER_KEY || '').trim(),
    gatewayUrl: cleanUrl(env.EYNOWA_LOCAL_GATEWAY_URL || 'http://127.0.0.1:8787'),
    pollMs: Math.max(250, Number(env.EYNOWA_WORKER_POLL_MS || 1000))
  };

  const missing = [];
  if (!config.accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!config.queueId) missing.push('CLOUDFLARE_QUEUE_ID');
  if (!config.queueToken) missing.push('CLOUDFLARE_QUEUE_TOKEN');
  if (!config.gatewayKey) missing.push('EYNOWA_LAB_API_KEY');
  if (!config.brokerUrl) missing.push('EYNOWA_BROKER_URL');
  if (!config.brokerKey) missing.push('EYNOWA_BROKER_KEY');
  if (missing.length) throw new Error(`EYNOWA_WORKER_ENV_MISSING: ${missing.join(', ')}`);
  return config;
}

function queueUrl(config, action) {
  return `${CF_API}/accounts/${encodeURIComponent(config.accountId)}/queues/${encodeURIComponent(config.queueId)}/messages/${action}`;
}

async function jsonResponse(response, label) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok || body?.success === false) {
    throw new Error(`${label}_HTTP_${response.status}: ${String(body?.errors?.[0]?.message || body?.error || '').slice(0, 240)}`);
  }
  return body;
}

export async function pullOne(config, fetchImpl = fetch) {
  const response = await fetchImpl(queueUrl(config, 'pull'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.queueToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ batch_size: 1, visibility_timeout_ms: 600000 })
  });
  const payload = await jsonResponse(response, 'CLOUDFLARE_PULL');
  return payload?.result?.messages?.[0] || null;
}

export async function acknowledge(config, leaseId, fetchImpl = fetch) {
  if (!leaseId) throw new Error('EYNOWA_WORKER_LEASE_ID_MISSING');
  const response = await fetchImpl(queueUrl(config, 'ack'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.queueToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ acks: [{ lease_id: leaseId }], retries: [] })
  });
  return jsonResponse(response, 'CLOUDFLARE_ACK');
}

export async function retryLater(config, leaseId, delaySeconds = 10, fetchImpl = fetch) {
  if (!leaseId) return null;
  const response = await fetchImpl(queueUrl(config, 'ack'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.queueToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      acks: [],
      retries: [{ lease_id: leaseId, delay_seconds: Math.max(0, Number(delaySeconds || 0)) }]
    })
  });
  return jsonResponse(response, 'CLOUDFLARE_RETRY');
}

function parseQueueBody(body) {
  if (body && typeof body === 'object') return body;
  const text = String(body || '').trim();
  if (!text) throw new Error('EYNOWA_WORKER_EMPTY_JOB');
  try { return JSON.parse(text); } catch {}

  // HTTP pull may expose a base64 body depending on the producer content type.
  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    throw new Error('EYNOWA_WORKER_INVALID_JOB_JSON');
  }
}

export function gatewayRouteForJob(type) {
  switch (String(type || '').trim()) {
    case 'ai.local_chat':
      return '/ai/local-chat';
    case 'professional.query':
      return '/v1/professional/query';
    default:
      return null;
  }
}

export async function callGateway(config, job, fetchImpl = fetch) {
  const route = gatewayRouteForJob(job?.type);
  if (!route) throw new Error(`EYNOWA_WORKER_UNSUPPORTED_JOB_TYPE: ${String(job?.type || '')}`);

  const request = job?.request && typeof job.request === 'object' ? job.request : {};
  const response = await fetchImpl(`${config.gatewayUrl}${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.gatewayKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(job?.type === 'professional.query' ? 120000 : 65000)
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    throw new Error(`EYNOWA_GATEWAY_HTTP_${response.status}: ${String(body?.error || '').slice(0, 240)}`);
  }
  return body;
}

export async function publishResult(config, jobId, responseBody, fetchImpl = fetch) {
  if (!jobId) throw new Error('EYNOWA_WORKER_JOB_ID_MISSING');
  const response = await fetchImpl(`${config.brokerUrl}/result`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.brokerKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      job_id: jobId,
      status: 'completed',
      response: responseBody
    })
  });
  return jsonResponse(response, 'EYNOWA_BROKER_RESULT');
}

export async function processPulledMessage(config, message, fetchImpl = fetch) {
  const leaseId = message?.lease_id;
  const job = parseQueueBody(message?.body);
  const jobId = String(job?.job_id || job?.id || '').trim();
  const route = gatewayRouteForJob(job?.type);

  if (!jobId) {
    await acknowledge(config, leaseId, fetchImpl);
    throw new Error('EYNOWA_WORKER_JOB_ID_MISSING');
  }
  if (!route) {
    // Poison/unknown messages are acknowledged so they cannot block the queue.
    await acknowledge(config, leaseId, fetchImpl);
    throw new Error(`EYNOWA_WORKER_UNSUPPORTED_JOB_TYPE: ${String(job?.type || '')}`);
  }

  try {
    const gatewayResult = await callGateway(config, job, fetchImpl);
    await publishResult(config, jobId, gatewayResult, fetchImpl);
    await acknowledge(config, leaseId, fetchImpl);
    return { ok: true, jobId, type: job.type };
  } catch (error) {
    try { await retryLater(config, leaseId, 10, fetchImpl); } catch {}
    throw error;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runForever({ env = process.env, fetchImpl = fetch, logger = console } = {}) {
  const config = envConfig(env);
  logger.log(`[EYNOWA worker v3] broker=${config.brokerUrl} gateway=${config.gatewayUrl}`);
  logger.log('[EYNOWA worker v3] jobs=ai.local_chat, professional.query');

  for (;;) {
    try {
      const message = await pullOne(config, fetchImpl);
      if (!message) {
        await sleep(config.pollMs);
        continue;
      }
      const result = await processPulledMessage(config, message, fetchImpl);
      logger.log(`[EYNOWA worker v3] completed ${result.type} ${result.jobId}`);
    } catch (error) {
      logger.error(`[EYNOWA worker v3] ${String(error?.message || error)}`);
      await sleep(Math.max(1000, config.pollMs));
    }
  }
}

export { envConfig, parseQueueBody };

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (invokedDirectly) {
  runForever().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
