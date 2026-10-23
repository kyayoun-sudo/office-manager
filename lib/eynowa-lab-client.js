function cleanUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

// Legacy direct gateway support. Once the Cloudflare broker is configured,
// Vercel must never try the old public tunnel again: the central AI router
// owns EYNOWA calls through EYNOWA_BROKER_URL / EYNOWA_BROKER_KEY.
export function eynowaLabConfigured(env = process.env) {
  const brokerReady = Boolean(
    cleanUrl(env.EYNOWA_BROKER_URL) &&
    String(env.EYNOWA_BROKER_KEY || "").trim()
  );
  if (brokerReady) return false;
  return Boolean(
    cleanUrl(env.EYNOWA_LAB_URL) &&
    String(env.EYNOWA_LAB_API_KEY || "").trim()
  );
}

async function labRequest(path, {
  method = "POST",
  body,
  timeoutMs = 30000,
  responseType = "json"
} = {}) {
  const baseUrl = cleanUrl(process.env.EYNOWA_LAB_URL);
  const apiKey = String(process.env.EYNOWA_LAB_API_KEY || "").trim();

  if (!baseUrl || !apiKey || eynowaLabConfigured() === false && cleanUrl(process.env.EYNOWA_BROKER_URL)) {
    const error = new Error("EYNOWA_LAB_NOT_CONFIGURED");
    error.code = "EYNOWA_LAB_NOT_CONFIGURED";
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`EYNOWA_LAB_HTTP_${response.status}`);
    }

    if (responseType === "buffer") {
      return Buffer.from(await response.arrayBuffer());
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;

  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("EYNOWA_LAB_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function labHealth() {
  return labRequest("/health", { method: "GET", timeoutMs: 10000 });
}

export function labLocalChat({ prompt, model, system } = {}) {
  return labRequest("/ai/local-chat", {
    body: { prompt, model, system }
  });
}

export function labOcr({
  bytes,
  filename = "document.pdf",
  contentType = "application/pdf"
} = {}) {
  return labRequest("/document/ocr", {
    body: {
      base64: Buffer.from(bytes).toString("base64"),
      filename,
      contentType
    },
    timeoutMs: 60000
  });
}

export async function labConvertToPdf({
  bytes,
  filename,
  contentType = "application/octet-stream"
} = {}) {
  const result = await labRequest("/document/convert-to-pdf", {
    body: {
      base64: Buffer.from(bytes).toString("base64"),
      filename,
      contentType
    },
    timeoutMs: 60000
  });

  return Buffer.from(result.base64, "base64");
}

export function labMemoryStore(payload) {
  return labRequest("/memory/store", { body: payload });
}

export function labMemorySearch(payload) {
  return labRequest("/memory/search", { body: payload });
}

export function labSemanticMemoryStore(payload) {
  return labRequest("/memory/semantic-store", {
    body: payload,
    timeoutMs: 45000
  });
}

export function labSemanticMemorySearch(payload) {
  return labRequest("/memory/semantic-search", {
    body: payload,
    timeoutMs: 45000
  });
}

export function labSearchIndex(payload) {
  return labRequest("/search/index", { body: payload });
}

export function labSearchQuery(payload) {
  return labRequest("/search/query", { body: payload });
}

export function labWorkflowRun(payload) {
  return labRequest("/workflow/run", { body: payload });
}

// Professional Brain direct-gateway fallback. In production White Label the
// broker-aware wrapper in ./eynowa-lab.js is preferred; this function exists
// for local/dev installations where EYNOWA_LAB_URL is intentionally used.
export function labProfessionalQuery(payload = {}) {
  return labRequest("/v1/professional/query", {
    body: payload,
    timeoutMs: 65000
  });
}
