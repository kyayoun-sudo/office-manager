import { chooseAgent } from "../agents/index.js";
import { requirePilotAccess } from "../lib/auth.js";
import { runOfficeManager } from "../lib/orchestrator.js";
import {
  createAgentRun,
  finishAgentRun,
  getAgentSetting,
  getPermissions,
  loadAgentContext
} from "../lib/supabase.js";

const SPECIALISTS = ["grand-controleur", "orpailleur", "sika"];

async function loadAllowedContexts(orgId) {
  const entries = await Promise.all(
    SPECIALISTS.map(async agentKey => {
      const setting = await getAgentSetting(orgId, agentKey);

      if (!setting || setting.mode === "disabled") {
        return [agentKey, {
          unavailable: true,
          reason: "AGENT_DISABLED"
        }];
      }

      const context = await loadAgentContext(orgId, agentKey);
      return [agentKey, context];
    })
  );

  return Object.fromEntries(entries);
}

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

    if (
      requestedAgent !== "auto" &&
      !SPECIALISTS.includes(requestedAgent)
    ) {
      return res.status(400).json({ error: "UNKNOWN_AGENT" });
    }

    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) {
      return res.status(500).json({
        error: "DEFAULT_ORG_ID_MISSING"
      });
    }

    const permissions = await getPermissions(orgId);

    if (!permissions?.external_ai_approved) {
      return res.status(409).json({
        error: "EXTERNAL_AI_APPROVAL_REQUIRED"
      });
    }

    if (!permissions?.selected_content_approved) {
      return res.status(409).json({
        error: "CONTENT_PROCESSING_APPROVAL_REQUIRED"
      });
    }

    let contexts;
    let runAgentKey;

    if (requestedAgent === "auto") {
      contexts = await loadAllowedContexts(orgId);
      runAgentKey = "orchestrator";
    } else {
      const setting = await getAgentSetting(orgId, requestedAgent);

      if (!setting) {
        return res.status(404).json({
          error: "AGENT_NOT_CONFIGURED",
          agent: requestedAgent
        });
      }

      if (setting.mode === "disabled") {
        return res.status(409).json({
          error: "AGENT_DISABLED",
          agent: requestedAgent
        });
      }

      contexts = {
        [requestedAgent]:
          await loadAgentContext(orgId, requestedAgent)
      };
      runAgentKey = requestedAgent;
    }

    const legacyRoute = chooseAgent(message);

    run = await createAgentRun({
      org_id: orgId,
      agent_key: runAgentKey,
      status: "running",
      metrics: {
        orchestration:
          requestedAgent === "auto"
            ? "manager"
            : "direct-specialist",
        legacy_route: legacyRoute,
        version: "v2.1"
      },
      errors: [],
      summary:
        requestedAgent === "auto"
          ? "Office Manager V2.1 multi-agent request started"
          : `${requestedAgent} V2.1 direct request started`
    });

    const result = await runOfficeManager({
      message,
      requestedAgent,
      contexts,
      provider,
      risk,
      orgId,
      runId: run?.id || null
    });

    if (run?.id) {
      await finishAgentRun(run.id, {
        status: "verified",
        finished_at: new Date().toISOString(),
        summary: result.text.slice(0, 1000),
        metrics: {
          provider: result.provider,
          orchestration:
            requestedAgent === "auto"
              ? "manager"
              : "direct-specialist",
          last_agent: result.lastAgent || null,
          reviewed: Boolean(result.review || result.reviewed),
          legacy_route: legacyRoute,
          specialists_used: result.specialistsUsed || [],
          tools_used: result.toolsUsed || [],
          version: "v2.1"
        },
        errors: []
      });
    }

    return res.status(200).json({
      agent:
        requestedAgent === "auto"
          ? "office-manager"
          : requestedAgent,
      agentName:
        requestedAgent === "auto"
          ? "Office Manager AI"
          : result.lastAgent || requestedAgent,
      provider: result.provider,
      answer: result.text,
      reviewed: Boolean(result.review || result.reviewed),
      lastAgent: result.lastAgent || null,
      specialistsUsed: result.specialistsUsed || [],
      toolsUsed: result.toolsUsed || [],
      version: "v2.1"
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
