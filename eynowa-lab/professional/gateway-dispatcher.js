import {
  createProfessionalHandler,
  handleProfessionalMemory,
  handleProfessionalValidation,
  handleProfessionalFeedback,
  handleProfessionalMetrics,
  handleProfessionalKnowledgeImport,
  handleProfessionalHealth,
  handleProfessionalDiagnostics,
} from './handler.js';

function serialiseError(error, fallbackStage = 'professional_gateway') {
  return {
    error: String(error?.message || error || 'UNKNOWN_ERROR'),
    error_name: String(error?.name || 'Error'),
    error_code: error?.code == null ? null : String(error.code),
    stage: String(error?.stage || fallbackStage),
  };
}

export function createProfessionalGatewayDispatcher(options = {}) {
  const handleQuery = createProfessionalHandler(options);

  return async function dispatchProfessionalGatewayRequest({ method, path, body } = {}) {
    const verb = String(method || 'GET').toUpperCase();
    const pathname = String(path || '').split('?')[0].replace(/\/$/, '') || '/';

    try {
      if (verb === 'POST' && pathname === '/v1/professional/query') {
        return { handled: true, status: 200, body: await handleQuery(body || {}) };
      }
      if (verb === 'POST' && pathname === '/v1/professional/memory/remember') {
        return { handled: true, status: 200, body: await handleProfessionalMemory(body || {}) };
      }
      if (verb === 'POST' && pathname === '/v1/professional/validation/accept') {
        return { handled: true, status: 200, body: await handleProfessionalValidation(body || {}) };
      }
      if (verb === 'POST' && pathname === '/v1/professional/feedback') {
        return { handled: true, status: 200, body: await handleProfessionalFeedback(body || {}) };
      }
      if ((verb === 'GET' || verb === 'POST') && pathname === '/v1/professional/metrics') {
        return { handled: true, status: 200, body: await handleProfessionalMetrics() };
      }
      if (verb === 'POST' && pathname === '/v1/professional/knowledge/import') {
        return { handled: true, status: 200, body: { imported: await handleProfessionalKnowledgeImport(body || {}) } };
      }
      if ((verb === 'GET' || verb === 'POST') && pathname === '/v1/professional/health') {
        return { handled: true, status: 200, body: await handleProfessionalHealth() };
      }
      if ((verb === 'GET' || verb === 'POST') && pathname === '/v1/professional/diagnostics') {
        return { handled: true, status: 200, body: await handleProfessionalDiagnostics() };
      }
      return { handled: false };
    } catch (error) {
      return {
        handled: true,
        status: 500,
        body: serialiseError(error),
      };
    }
  };
}

// Authentication remains the responsibility of the existing EYNOWA Lab Gateway.
export async function readJsonRequest(req, { maxBytes = 2_000_000 } = {}) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function writeJsonResponse(res, status, body) {
  const payload = JSON.stringify(body ?? {});
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}
