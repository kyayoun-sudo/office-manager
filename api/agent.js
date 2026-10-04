import { chooseAgent, getAgent } from "../agents/index.js";
import { requirePilotAccess } from "../lib/auth.js";
import { runAI } from "../lib/ai.js";
import {
  createAgentRun,
  finishAgentRun,
  getAgentSetting,
  getPermissions,
  loadAgentContext
} from "../lib/supabase.js";

export default async function handler(req, res) {
  let run = null;

  try {
    requirePilotAccess(req);

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body || {};
    const message = String(body.message || "").trim();
    const requestedAgent = String(body.agent || "auto").trim();
    const provider = String(body.provider || "auto").trim();
    const risk = String(body.risk || "normal").trim();

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) {
      return res.status(500).json({ error: "DEFAULT_ORG_ID_MISSING" });
    }

    const agentKey =
      requestedAgent === "auto"
        ? chooseAgent(message)
        : requestedAgent;

    const agent = getAgent(agentKey);

    const [setting, permissions] = await Promise.all([
      getAgentSetting(orgId, agentKey),
      getPermissions(orgId)
    ]);

    if (!setting) {
      return res.status(404).json({ error: "AGENT_NOT_CONFIGURED", agent: agentKey });
    }

    if (setting.mode === "disabled") {
      return res.status(409).json({ error: "AGENT_DISABLED", agent: agentKey });
    }

    if (!permissions?.external_ai_approved) {
      return res.status(409).json({
        error: "EXTERNAL_AI_APPROVAL_REQUIRED",
        agent: agentKey
      });
    }

    const context = await loadAgentContext(orgId, agentKey);

    run = await createAgentRun({
      org_id: orgId,
      agent_key: agentKey,
      status: "running",
      metrics: {},
      errors: [],
      summary: `${agent.name} AI request started`
    });

    const input = JSON.stringify(
      {
        user_request: message,
        agent: agentKey,
        evidence: context
      },
      null,
      2
    );

    const result = await runAI({
      agentKey,
      instructions: agent.instructions,
      input,
      risk,
      provider
    });

    if (run?.id) {
      await finishAgentRun(run.id, {
        status: "verified",
        finished_at: new Date().toISOString(),
        summary: result.text.slice(0, 1000),
        metrics: {
          provider: result.provider
        },
        errors: []
      });
    }

    return res.status(200).json({
      agent: agentKey,
      agentName: agent.name,
      provider: result.provider,
      answer: result.text,
      reviewed: Boolean(result.review)
    });
  } catch (error) {
    if (run?.id) {
      try {
        await finishAgentRun(run.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          errors: [String(error.message || error)]
        });
      } catch {}
    }

    console.error(error);

    return res
      .status(error.statusCode || 500)
      .json({ error: String(error.message || error) });
  }
}
