import { requirePilotAccess } from "../lib/auth.js";
import {
  getAgentSetting,
  getPermissions
} from "../lib/supabase.js";

export default async function handler(req, res) {
  try {
    requirePilotAccess(req);

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) {
      return res.status(500).json({ error: "DEFAULT_ORG_ID_MISSING" });
    }

    const [permissions, grand, orpailleur, sika] = await Promise.all([
      getPermissions(orgId),
      getAgentSetting(orgId, "grand-controleur"),
      getAgentSetting(orgId, "orpailleur"),
      getAgentSetting(orgId, "sika")
    ]);

    return res.status(200).json({
      orgId,
      permissions,
      agents: {
        "grand-controleur": grand,
        "orpailleur": orpailleur,
        "sika": sika
      }
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: String(error.message || error) });
  }
}
