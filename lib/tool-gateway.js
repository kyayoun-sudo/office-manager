// EYNOWA Tool Gateway
// Additive laboratory layer for local/on-prem tools.
// IMPORTANT: nothing in the existing agents imports this module yet.
// The gateway is disabled by default and must be explicitly enabled.

const TRUTHY = new Set(["1", "true", "yes", "on"]);
function relayHeaders(headers={}) {return process.env.EYNOWA_RELAY_TOKEN?{...headers,'X-Office-Relay-Token':process.env.EYNOWA_RELAY_TOKEN}:headers;}

function enabledFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return TRUTHY.has(String(raw).trim().toLowerCase());
}

export function toolGatewayEnabled() {
  return enabledFlag("EYNOWA_TOOL_GATEWAY_ENABLED", false);
}

function configuredUrl(envName, localDefault) {
  const explicit = String(process.env[envName] || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  // localhost defaults are useful only while Office Manager itself runs locally.
  // A Vercel deployment cannot reach the developer's computer via localhost.
  if (!process.env.VERCEL) return localDefault;
  return null;
}

export function toolGatewayConfig() {
  return {
    enabled: toolGatewayEnabled(),
    ollama: configuredUrl("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    doctr: configuredUrl("DOCTR_BASE_URL", "http://127.0.0.1:8080"),
    gotenberg: configuredUrl("GOTENBERG_BASE_URL", "http://127.0.0.1:3000"),
    chroma: configuredUrl("CHROMA_BASE_URL", "http://127.0.0.1:8000"),
    meilisearch: configuredUrl("MEILISEARCH_BASE_URL", "http://127.0.0.1:7700"),
    n8n: configuredUrl("N8N_BASE_URL", "http://127.0.0.1:5678")
  };
}

async function probe(name, baseUrl, path, { timeoutMs = 5000 } = {}) {
  if (!baseUrl) {
    return { name, configured: false, ok: false, status: null, error: "NOT_CONFIGURED" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      signal: controller.signal,
      headers: relayHeaders({ Accept: "application/json" }), redirect:'error'
    });
    return {
      name,
      configured: true,
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : `HTTP_${response.status}`
    };
  } catch (error) {
    return {
      name,
      configured: true,
      ok: false,
      status: null,
      error: String(error?.name === "AbortError" ? "TIMEOUT" : error?.message || error)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function toolGatewayHealth() {
  const config = toolGatewayConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      mode: process.env.VERCEL ? "vercel" : "local",
      services: {},
      message: "EYNOWA_TOOL_GATEWAY_ENABLED is false"
    };
  }

  const checks = await Promise.all([
    probe("ollama", config.ollama, "/api/tags"),
    probe("doctr", config.doctr, "/openapi.json"),
    probe("gotenberg", config.gotenberg, "/health"),
    probe("chroma", config.chroma, "/api/v2/heartbeat"),
    probe("meilisearch", config.meilisearch, "/health"),
    probe("n8n", config.n8n, "/healthz")
  ]);

  return {
    enabled: true,
    mode: process.env.VERCEL ? "vercel" : "local",
    all_ok: checks.every(item => item.ok),
    services: Object.fromEntries(checks.map(item => [item.name, item]))
  };
}

function assertEnabled() {
  if (!toolGatewayEnabled()) {
    const error = new Error("EYNOWA_TOOL_GATEWAY_DISABLED");
    error.code = "EYNOWA_TOOL_GATEWAY_DISABLED";
    throw error;
  }
}

function requireService(name, url) {
  if (!url) {
    const error = new Error(`EYNOWA_TOOL_NOT_CONFIGURED: ${name}`);
    error.code = "EYNOWA_TOOL_NOT_CONFIGURED";
    throw error;
  }
  return url;
}

export async function localLlmGenerate({ prompt, model = "llama3.2:3b", system = "",fetchImpl=fetch,maxTokens=4000 }) {
  assertEnabled();
  const { ollama } = toolGatewayConfig();
  const baseUrl = requireService("ollama", ollama);
  const response = await fetchImpl(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: relayHeaders({ "Content-Type": "application/json" }),signal:AbortSignal.timeout(65000),redirect:'error',
    body: JSON.stringify({ model, prompt, system, stream: false,options:{num_predict:maxTokens} })
  });
  if (!response.ok) throw new Error(`OLLAMA_HTTP_${response.status}`);
  return response.json();
}

export async function ocrDocument({ bytes, filename = "document.pdf", contentType = "application/pdf" }) {
  assertEnabled();
  const { doctr } = toolGatewayConfig();
  const baseUrl = requireService("doctr", doctr);

  const form = new FormData();
  form.append("files", new Blob([bytes], { type: contentType }), filename);

  const response = await fetch(`${baseUrl}/ocr/`, {
    method: "POST",
    headers:relayHeaders(),signal:AbortSignal.timeout(65000),redirect:'error',
    body: form
  });
  if (!response.ok) throw new Error(`DOCTR_HTTP_${response.status}`);
  return response.json();
}

export async function convertOfficeToPdf({ bytes, filename, contentType = "application/octet-stream" }) {
  assertEnabled();
  const { gotenberg } = toolGatewayConfig();
  const baseUrl = requireService("gotenberg", gotenberg);

  const form = new FormData();
  form.append("files", new Blob([bytes], { type: contentType }), filename);

  const response = await fetch(`${baseUrl}/forms/libreoffice/convert`, {
    method: "POST",
    headers:relayHeaders(),signal:AbortSignal.timeout(65000),redirect:'error',
    body: form
  });
  if (!response.ok) throw new Error(`GOTENBERG_HTTP_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// Credentials stay server-side and are never included in toolGatewayConfig().
function serviceHeaders(service) {
  const prefix = { chroma: "CHROMA", meilisearch: "MEILISEARCH", n8n: "N8N" }[service];
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json" });
  if(process.env.EYNOWA_RELAY_TOKEN)headers.set('X-Office-Relay-Token',process.env.EYNOWA_RELAY_TOKEN);
  if (process.env[`${prefix}_HEADERS_JSON`]) {
    const extra = JSON.parse(process.env[`${prefix}_HEADERS_JSON`]);
    if (!extra || Array.isArray(extra) || typeof extra !== "object") throw new Error(`${prefix}_INVALID_HEADERS`);
    for (const [key, value] of Object.entries(extra)) {
      if (typeof value !== "string") throw new Error(`${prefix}_INVALID_HEADERS`);
      headers.set(key, value);
    }
  }
  const token = process.env[`${prefix}_API_KEY`];
  if (token) headers.set(service === "chroma" ? "X-Chroma-Token" : "Authorization", service === "chroma" ? token : `Bearer ${token}`);
  return headers;
}

async function serviceRequest(service, path, { body, timeoutMs = 15000, method = "POST" } = {}) {
  assertEnabled();
  const baseUrl = requireService(service, toolGatewayConfig()[service]);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("INVALID_TIMEOUT");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: serviceHeaders(service),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal, redirect: "error"
    });
    // Do not echo response bodies: upstream errors can contain credentials or documents.
    if (!response.ok) throw new Error(`${service.toUpperCase()}_HTTP_${response.status}`);
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${service.toUpperCase()}_TIMEOUT`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function pathSegment(value, name) {
  if (typeof value !== "string" || !value.trim() || value === "." || value === "..") throw new Error(`INVALID_${name}`);
  return encodeURIComponent(value);
}

function chromaPath(collectionId) {
  const tenant = pathSegment(process.env.CHROMA_TENANT || "default_tenant", "TENANT");
  const database = pathSegment(process.env.CHROMA_DATABASE || "default_database", "DATABASE");
  return `/api/v2/tenants/${tenant}/databases/${database}/collections/${pathSegment(collectionId, "COLLECTION_ID")}`;
}

function vectorsValid(vectors) {
  return Array.isArray(vectors) && vectors.length > 0 && vectors.every(v =>
    Array.isArray(v) && v.length > 0 && v.length === vectors[0].length && v.every(Number.isFinite));
}

// Use an existing collection UUID. Embeddings are explicit: the REST server does
// not run the JavaScript/Python client's default embedding function.
export async function memoryStore({ collectionId, ids, embeddings, documents, metadatas, timeoutMs } = {}) {
  assertEnabled();
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length ||
      !vectorsValid(embeddings) || embeddings.length !== ids.length) throw new Error("CHROMA_INVALID_RECORDS");
  for (const values of [documents, metadatas]) {
    if (values !== undefined && (!Array.isArray(values) || values.length !== ids.length)) throw new Error("CHROMA_INVALID_RECORDS");
  }
  return serviceRequest("chroma", `${chromaPath(collectionId)}/upsert`, { body: { ids, embeddings, documents, metadatas }, timeoutMs });
}

export async function memorySearch({ collectionId, queryEmbeddings, nResults = 10, where, whereDocument, include, timeoutMs } = {}) {
  assertEnabled();
  if (!vectorsValid(queryEmbeddings) || !Number.isInteger(nResults) || nResults < 1) throw new Error("CHROMA_INVALID_QUERY");
  return serviceRequest("chroma", `${chromaPath(collectionId)}/query`, {
    body: { query_embeddings: queryEmbeddings, n_results: nResults, where, where_document: whereDocument, include }, timeoutMs
  });
}

// Meilisearch returns an asynchronous task receipt; acceptance is not completion.
export async function searchIndex({ index, documents, primaryKey, timeoutMs } = {}) {
  assertEnabled();
  if (!Array.isArray(documents) || !documents.length || documents.some(d => !d || Array.isArray(d) || typeof d !== "object")) throw new Error("MEILISEARCH_INVALID_DOCUMENTS");
  const query = primaryKey === undefined ? "" : `?primaryKey=${pathSegment(primaryKey, "PRIMARY_KEY")}`;
  return serviceRequest("meilisearch", `/indexes/${pathSegment(index, "INDEX")}/documents${query}`, { body: documents, timeoutMs });
}

export async function searchQuery({ index, query = "", options = {}, timeoutMs } = {}) {
  assertEnabled();
  if (typeof query !== "string" || !options || Array.isArray(options) || typeof options !== "object") throw new Error("MEILISEARCH_INVALID_QUERY");
  return serviceRequest("meilisearch", `/indexes/${pathSegment(index, "INDEX")}/search`, { body: { ...options, q: query }, timeoutMs });
}

// Trigger an active workflow by its Webhook node path, not by workflow ID.
// No automatic retries: repeating a webhook may duplicate side effects.
export async function workflowRun({ webhookPath, payload = {}, timeoutMs } = {}) {
  assertEnabled();
  if (typeof webhookPath !== "string" || !webhookPath || webhookPath.split("/").some(p => !p || p === "." || p === "..")) throw new Error("N8N_INVALID_WEBHOOK_PATH");
  const path = webhookPath.split("/").map(p => pathSegment(p, "WEBHOOK_PATH")).join("/");
  return serviceRequest("n8n", `/webhook/${path}`, { body: payload, timeoutMs });
}
