import {
  LEGACY_SETTING_FALLBACK,
  ROOT_AGENT_KEY,
  ROOT_AGENT_NAME,
  SPECIALIST_KEYS
} from "../agents/index.js";
import { requirePilotAccess } from "../lib/auth.js";
import { assertIsolatedOrg } from "../lib/test-mode.js";
import {
  getAgentSetting,
  getPermissions
} from "../lib/supabase.js";

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requirePilotAccess(req);

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) {
      return res.status(500).json({ error: "DEFAULT_ORG_ID_MISSING" });
    }
    assertIsolatedOrg(orgId);

    const [permissions, rootSetting, ...specialistSettings] =
      await Promise.all([
        getPermissions(orgId),
        // Historical settings row of the root (stored as "grand-controleur").
        getAgentSetting(orgId, ROOT_AGENT_KEY),
        ...SPECIALIST_KEYS.map(agentKey => getAgentSetting(orgId, agentKey))
      ]);

    const agents = {};
    SPECIALIST_KEYS.forEach((agentKey, index) => {
      const own = specialistSettings[index];
      const legacyKey = LEGACY_SETTING_FALLBACK[agentKey];
      if (!own && legacyKey && rootSetting && legacyKey === ROOT_AGENT_KEY) {
        // No dedicated row yet: the legacy grand-controleur configuration is
        // used as a safe fallback (see api/agent.js).
        agents[agentKey] = {
          ...rootSetting,
          agent_key: agentKey,
          legacy_fallback_from: legacyKey
        };
      } else {
        agents[agentKey] = own;
      }
    });

    return res.status(200).json({
      orgId,
      permissions,
      root: {
        key: ROOT_AGENT_KEY,
        name: ROOT_AGENT_NAME,
        setting: rootSetting
      },
      agents
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: String(error.message || error) });
  }
}
