import {
  createProfessionalHandler,
  handleProfessionalMemory,
  handleProfessionalKnowledgeImport,
  handleProfessionalHealth,
} from './handler.js';

export function createProfessionalGatewayDispatcher(options = {}) {
  const handleQuery = createProfessionalHandler(options);

  return async function dispatchProfessionalGatewayRequest({ method, path, body } = {}) {
    const verb = String(method || 'GET').toUpperCase();
    const pathname = String(path || '').split('?')[0].replace(/\/$/, '') || '/';

    if (verb === 'POST' && pathname === '/v1/professional/query') {
      return { handled: true, status: 200, body: await handleQuery(body || {}) };
    }

    if (verb === 'POST' && pathname === '/v1/professional/memory/remember') {
      return { handled: true, status: 200, body: await handleProfessionalMemory(body || {}) };
    }

    if (verb === 'POST' && pathname === '/v1/professional/knowledge/import') {
      return { handled: true, status: 200, body: { imported: await handleProfessionalKnowledgeImport(body || {}) } };
    }

    if (verb === 'GET' && pathname === '/v1/professional/health') {
      return { handled: true, status: 200, body: await handleProfessionalHealth() };
    }

    return { handled: false };
  };
}

export async function readJsonRequest(req, { maxBytes = 2_000_000 } = {}) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(text);
}

export function writeJsonResponse(res, status, body) {
  const payload = JSON.stringify(body ?? {});
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}
