// EYNOWA Tool Gateway
// Additive laboratory layer for local/on-prem tools.
// IMPORTANT: nothing in the existing agents imports this module yet.
// The gateway is disabled by default and must be explicitly enabled.

const TRUTHY = new Set(["1", "true", "yes", "on"]);

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
      headers: { Accept: "application/json" }
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

export async function localLlmGenerate({ prompt, model = "llama3.2:3b", system = "" }) {
  assertEnabled();
  const { ollama } = toolGatewayConfig();
  const baseUrl = requireService("ollama", ollama);
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, system, stream: false })
  });
  if (!response.ok) throw new Error(`OLLAMA_HTTP_${response.status}: ${await response.text()}`);
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
    body: form
  });
  if (!response.ok) throw new Error(`DOCTR_HTTP_${response.status}: ${await response.text()}`);
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
    body: form
  });
  if (!response.ok) throw new Error(`GOTENBERG_HTTP_${response.status}: ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}
