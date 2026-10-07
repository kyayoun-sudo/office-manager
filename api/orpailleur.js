import { requirePilotAccess } from "../lib/auth.js";
import { bridgeForbiddenHere } from "../lib/google-drive.js";

function workerUrl() {
  const base = process.env.SUPABASE_URL;
  if (!base) throw new Error("SUPABASE_URL_MISSING");

  return `${base.replace(/\/$/, "")}/functions/v1/orpailleur-durable-worker`;
}

export default async function handler(req, res) {
  try {
    requirePilotAccess(req);
    // The durable worker is bound to the REAL firm Drive: not reachable from a preview (test run).
    if (bridgeForbiddenHere()) {
      return res.status(409).json({ error: "PREVIEW_BRIDGE_FORBIDDEN" });
    }

    if (!["GET", "POST"].includes(req.method)) {
      return res.status(405).json({ error: "Method not allowed" });
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
