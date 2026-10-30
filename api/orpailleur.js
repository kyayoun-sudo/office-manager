import { requirePilotAccess } from "../lib/auth.js";
import { bridgeForbiddenHere } from "../lib/google-drive.js";
import { resolveRequestOrg, multiCabinet, pilotOrgId } from "../lib/firm-context.js";
import { requirePersonOrServer } from "../lib/caller.js";
import { loadGoogleConnection } from "../lib/google-connection.js";
import { assertIsolatedOrg, isTestMode } from "../lib/test-mode.js";
import { runOrpailleurKernel } from "../lib/orpailleur-kernel.js";

function workerUrl() {
  const base = process.env.SUPABASE_URL;
  if (!base) throw new Error("SUPABASE_URL_MISSING");

  return `${base.replace(/\/$/, "")}/functions/v1/orpailleur-durable-worker`;
}

export default async function handler(req, res) {
  try {
    requirePilotAccess(req, { allowSession: true }); // the session is verified below

    if (!["GET", "POST"].includes(req.method)) {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const orgId = await resolveRequestOrg(req);
    // Audit 2026-10-30: called by the server's own passes (signed) or a person — never the shared token alone.
    await requirePersonOrServer(req, orgId);

    // Universal-kernel continuation entry point. In preview/test it may operate only on
    // the isolated test organisation; a protected preview must never gain access to the
    // real firm Drive through this route. In the real deployment the normal Drive bridge
    // restrictions still apply and every call keeps the firm identity server-side.
    if (req.method === "POST" && req.body?.action === "kernel") {
      if (isTestMode()) assertIsolatedOrg(orgId);
      else if (bridgeForbiddenHere()) return res.status(409).json({ error: "PREVIEW_BRIDGE_FORBIDDEN" });
      await loadGoogleConnection(orgId);
      const result = await runOrpailleurKernel(orgId, req);
      return res.status(200).json(result);
    }

    // Legacy durable worker remains bound to the real pilot firm only.
    if (multiCabinet()) {
      if (orgId !== pilotOrgId()) return res.status(403).json({ error: "PILOT_FIRM_ONLY" });
    }
    // The durable worker is bound to the REAL firm Drive: not reachable from a preview (test run).
    if (bridgeForbiddenHere()) {
      return res.status(409).json({ error: "PREVIEW_BRIDGE_FORBIDDEN" });
    }

    const secret = process.env.ORPAILLEUR_JOB_SECRET;
    if (!secret) {
      return res.status(500).json({ error: "ORPAILLEUR_JOB_SECRET_MISSING" });
    }

    const response = await fetch(workerUrl(), {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "x-orpailleur-secret": secret
      },
      body:
        req.method === "POST"
          ? JSON.stringify(req.body || {})
          : undefined
    });

    const text = await response.text();

    res.status(response.status);
    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "application/json"
    );

    return res.send(text);
  } catch (error) {
    // A code for 4xx; a 5xx message may carry a URL or a key: logged, not shown (audit 2026-10-30).
    if (!(error.statusCode < 500)) console.error("[orpailleur] failed:", String(error.message || error).slice(0, 160));
    return res
      .status(error.statusCode || 500)
      .json({ error: error.statusCode < 500 || /^[A-Z0-9_]+$/.test(String(error.message)) ? String(error.message || error) : "ORPAILLEUR_UNAVAILABLE" });
  }
}
