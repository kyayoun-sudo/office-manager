function baseUrl() {
  return String(process.env.EYNOWA_LAB_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function apiKey() {
  return process.env.EYNOWA_LAB_API_KEY || '';
}

async function request(path, { method = 'POST', body } = {}) {
  const key = apiKey();
  if (!key) throw new Error('EYNOWA_LAB_API_KEY_MISSING');

  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || `EYNOWA_LAB_HTTP_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function consultEynowaLab({
  application = 'firm_manager',
  query,
  task = '',
  domains,
  frameworks = [],
  country = 'CI',
  professionalId = 'default',
  client = '',
} = {}) {
  if (!String(query || '').trim()) throw new Error('EYNOWA_LAB_QUERY_REQUIRED');
  return request('/v1/professional/query', {
    body: {
      application,
      query,
      task,
      domains,
      frameworks,
      country,
      professional_id: professionalId,
      client,
    },
  });
}

export async function validateEynowaLabConclusion(body = {}) {
  return request('/v1/professional/validation/accept', { body });
}

export async function sendEynowaLabFeedback(body = {}) {
  return request('/v1/professional/feedback', { body });
}

export async function getEynowaLabMetrics() {
  return request('/v1/professional/metrics', { method: 'GET' });
}

export function eynowaLabConfigured() {
  return Boolean(apiKey());
}
