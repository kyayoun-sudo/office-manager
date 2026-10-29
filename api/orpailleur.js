import { requirePilotAccess } from "../lib/auth.js";
import { bridgeForbiddenHere } from "../lib/google-drive.js";
import { resolveRequestOrg, multiCabinet, pilotOrgId } from "../lib/firm-context.js";
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
    requirePilotAccess(req);

    if (!["GET", "POST"].includes(req.method)) {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const orgId = await resolveRequestOrg(req);

    // Pilot entry point for the universal kernel. It is deliberately restricted to
    // an isolated test organisation in preview/test mode: never use the experimental
    // route to bypass the production Drive bridge protections.
    if (req.method === "POST" && req.body?.action === "kernel") {
      if (!isTestMode()) return res.status(409).json({ error: "KERNEL_PILOT_TEST_ONLY" });
      assertIsolatedOrg(orgId);
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
    return res
      .status(error.statusCode || 500)
      .json({ error: String(error.message || error) });
  }
}
