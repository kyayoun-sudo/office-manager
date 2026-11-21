import http from "node:http";
import crypto from "node:crypto";
import {
  toolGatewayHealth,
  localLlmGenerate,
  ocrDocument,
  convertOfficeToPdf,
  memoryStore,
  memorySearch,
  semanticMemoryStore,
  semanticMemorySearch,
  searchIndex,
  searchQuery,
  workflowRun
} from "./lib/tool-gateway.js";
import { loadClients, identify, handleV1, CONTRACT_VERSION } from "./lib/lab-v1.js";

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.EYNOWA_LAB_API_KEY || "";

function equalSecret(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function authorized(req) {
  const auth = req.headers.authorization || "";
  const bearer = auth.replace(/^Bearer\s+/i, "");
  const headerKey = req.headers["x-eynowa-api-key"];
  return equalSecret(bearer, SECRET) || equalSecret(headerKey, SECRET);
}

// Application keys (v1) are loaded once at start; a malformed file stops the start (no silent open access).
const CLIENTS = loadClients();

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

async function jsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 30_000_000) throw new Error("BODY_TOO_LARGE");
  }
  return raw ? JSON.parse(raw) : {};
}

function bytesFrom(data) {
  if (!data?.base64) throw new Error("BASE64_REQUIRED");
  return Buffer.from(data.base64, "base64");
}

const server = http.createServer(async (req, res) => {
  const path = String(req.url || "").split("?")[0];

  // Liveness without secrets, for Docker healthchecks only (no component detail).
  if (req.method === "GET" && path === "/livez") return send(res, 200, { ok: true, contract: CONTRACT_VERSION });

  if (path.startsWith("/v1/")) {
    const client = identify(req, CLIENTS, SECRET);
    if (!client) return send(res, 401, { error: "UNAUTHORIZED" });
    try {
      const data = req.method === "POST" ? await jsonBody(req) : {};
      return send(res, 200, await handleV1(req, path, client, data));
    } catch (error) {
      const status = Number(error?.status) || 500;
      const safe = String(error?.code || error?.message || "INTERNAL_ERROR").split(":")[0];
      return send(res, status, { error: safe, contract: CONTRACT_VERSION });
    }
  }

  // Historical routes: unchanged, legacy key only (Office Manager compatibility).
  // They give the legacy key access to any collection; switch them off once every consumer uses its own v1 key.
  if (String(process.env.EYNOWA_LAB_LEGACY_ROUTES || "true").toLowerCase() === "false") {
    return send(res, 410, { error: "LEGACY_ROUTES_DISABLED", contract: CONTRACT_VERSION });
  }
  if (!authorized(req)) {
    return send(res, 401, { error: "UNAUTHORIZED" });
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, await toolGatewayHealth());
    }

    if (req.method !== "POST") {
      return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
    }

    const data = await jsonBody(req);

    if (req.url === "/ai/local-chat") {
      return send(res, 200, await localLlmGenerate(data));
    }

    if (req.url === "/document/ocr") {
      const result = await ocrDocument({
        bytes: bytesFrom(data),
        filename: data.filename || "document.pdf",
        contentType: data.contentType || "application/pdf"
      });
      return send(res, 200, result);
    }

    if (req.url === "/document/convert-to-pdf") {
      const pdf = await convertOfficeToPdf({
        bytes: bytesFrom(data),
        filename: data.filename || "document.docx",
        contentType: data.contentType || "application/octet-stream"
      });
      return send(res, 200, {
        contentType: "application/pdf",
        base64: pdf.toString("base64")
      });
    }

    if (req.url === "/memory/store") {
      return send(res, 200, await memoryStore(data));
    }

    if (req.url === "/memory/search") {
      return send(res, 200, await memorySearch(data));
    }

    if (req.url === "/memory/semantic-store") {
      return send(res, 200, await semanticMemoryStore(data));
    }

    if (req.url === "/memory/semantic-search") {
      return send(res, 200, await semanticMemorySearch(data));
    }

    if (req.url === "/search/index") {
      return send(res, 200, await searchIndex(data));
    }

    if (req.url === "/search/query") {
      return send(res, 200, await searchQuery(data));
    }

    if (req.url === "/workflow/run") {
      return send(res, 200, await workflowRun(data));
    }

    return send(res, 404, { error: "NOT_FOUND" });

  } catch (error) {
    const safe = String(error?.code || error?.message || "INTERNAL_ERROR").split(":")[0];
    return send(res, 500, { error: safe });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`EYNOWA Gateway ready on ${PORT}`);
});
