import { requirePilotAccess } from "../lib/auth.js";
import { toolGatewayConfig, toolGatewayHealth } from "../lib/tool-gateway.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    requirePilotAccess(req);

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const health = await toolGatewayHealth();
    const config = toolGatewayConfig();

    return res.status(200).json({
      ...health,
      configured: {
        ollama: Boolean(config.ollama),
        doctr: Boolean(config.doctr),
        gotenberg: Boolean(config.gotenberg),
        chroma: Boolean(config.chroma),
        meilisearch: Boolean(config.meilisearch),
        n8n: Boolean(config.n8n)
      },
      // Deliberately never return service URLs or credentials.
      note: "Diagnostic endpoint only. Existing agents are not wired to the gateway yet."
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: String(error?.message || error) });
  }
}
