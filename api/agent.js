import { chooseAgent, getAgent } from "../agents/index.js";
import { requirePilotAccess } from "../lib/auth.js";
import { runAI } from "../lib/ai.js";
import {
  consultEynowaLab,
  inferEynowaLabDomains,
  inferEynowaLabFrameworks,
  shouldConsultEynowaLab
} from "../eynowa-lab-client.js";
import {
  createAgentRun,
  finishAgentRun,
  getAgentSetting,
  getPermissions,
  loadAgentContext
} from "../lib/supabase.js";

function compactLabContext(result) {
  if (!result) return null;
  return {
    role: "professional_helper_only",
    decision_authority: "selected_agent_and_human_professional",
    domains: result.domains || [],
    topics: result.topics || [],
    answer: String(result.answer || "").slice(0, 10000),
    sources: Array.isArray(result.sources) ? result.sources.slice(0, 12) : [],
    confidence: result.confidence ?? null,
    requires_validation: Boolean(result.requires_validation),
    validation_reason: String(result.validation_reason || "").slice(0, 2500),
    question_for_professional: String(result.question_for_professional || "").slice(0, 2000),
    knowledge_hits: Number(result.knowledge_hits || 0),
    memory_hits: Number(result.memory_hits || 0),
    generation_deterministic_fallback: Boolean(result.generation_deterministic_fallback)
  };
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
    const professionalId = String(body.professional_id || body.professionalId || "default").trim() || "default";
    const labMode = String(body.eynowa_lab || body.eynowaLab || "auto").trim();
    const client = String(body.client || "").trim();
    const country = String(body.country || "CI").trim() || "CI";

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

    let labResult = null;
    let labError = "";
    const useLab = shouldConsultEynowaLab({ message, mode: labMode });

    if (useLab) {
      try {
        const explicitDomains = Array.isArray(body.professional_domains) ? body.professional_domains : null;
        const explicitFrameworks = Array.isArray(body.frameworks) ? body.frameworks : null;
        labResult = await consultEynowaLab({
          application: "firm_manager",
          query: message,
          task: `support selected agent ${agentKey}`,
          domains: explicitDomains?.length ? explicitDomains : inferEynowaLabDomains(message),
          frameworks: explicitFrameworks?.length ? explicitFrameworks : inferEynowaLabFrameworks(message),
          country,
          professionalId,
          client
        });
      } catch (error) {
        labError = String(error?.message || error).slice(0, 500);
        console.error("EYNOWA_LAB_HELPER_UNAVAILABLE", labError);
      }
    }

    const input = JSON.stringify(
      {
        user_request: message,
        agent: agentKey,
        evidence: context,
        eynowa_lab_professional_helper: compactLabContext(labResult),
        helper_rules: labResult ? [
          "EYNOWA Lab is advisory professional context, not the acting agent.",
          "Keep your own role and use verified application evidence for mission facts.",
          "Do not turn a Lab recommendation into an executed action.",
          "If Lab requires professional validation, preserve that requirement in your answer."
        ] : []
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

    const validationCards = labResult?.validation_card ? [labResult.validation_card] : [];

    if (run?.id) {
      await finishAgentRun(run.id, {
        status: "verified",
        finished_at: new Date().toISOString(),
        summary: result.text.slice(0, 1000),
        metrics: {
          provider: result.provider,
          eynowa_lab_helper_used: Boolean(labResult),
          eynowa_lab_helper_requested: useLab,
          eynowa_lab_helper_error: labError || null,
          eynowa_lab_knowledge_hits: Number(labResult?.knowledge_hits || 0),
          eynowa_lab_validation_required: Boolean(labResult?.requires_validation)
        },
        errors: []
      });
    }

    return res.status(200).json({
      agent: agentKey,
      agentName: agent.name,
      provider: result.provider,
      answer: result.text,
      reviewed: Boolean(result.review),
      eynowaLabHelperUsed: Boolean(labResult),
      eynowaLabHelperError: labError || null,
      validationCards
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
