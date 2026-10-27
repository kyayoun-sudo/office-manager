import { requirePilotAccess } from "../lib/auth.js";
import { getEynowaLabMetrics } from "../eynowa-lab-client.js";

export default async function handler(req, res) {
  try {
    requirePilotAccess(req);

    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const metrics = await getEynowaLabMetrics();
    return res.status(200).json(metrics);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || error.status || 500).json({
      error: String(error.message || error)
    });
  }
}
