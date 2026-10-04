import { Agent, Runner } from "@openai/agents";
import {
  OFFICE_MANAGER_INSTRUCTIONS,
  getAgent
} from "../agents/index.js";
import { runAI } from "./ai.js";
import { buildSpecialistTools } from "./agent-tools.js";

function modelName() {
  return process.env.OPENAI_MODEL || "gpt-5.6-luna";
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function specialistInstructions(agentKey, evidence) {
  const agent = getAgent(agentKey);

  return `${agent.instructions}

PRELOADED TECHNICAL SNAPSHOT FOR THIS RUN:
${safeJson(evidence)}

The snapshot may be stale. When a live tool is available for the fact you need, use the live tool and prefer the current Drive/source result over the snapshot. If a fact is not evidenced, do not state it as confirmed.`;
}

function makeSpecialist(agentKey, evidence, runtime) {
  const config = getAgent(agentKey);

  return new Agent({
    name: config.name,
    model: modelName(),
    handoffDescription: config.handoffDescription,
    instructions: specialistInstructions(agentKey, evidence),
    tools: buildSpecialistTools(agentKey, runtime)
  });
}

function makeManager(contexts, runtime) {
  const grandControleur = makeSpecialist(
    "grand-controleur",
    contexts["grand-controleur"],
    runtime
  );

  const orpailleur = makeSpecialist(
    "orpailleur",
    contexts.orpailleur,
    runtime
  );

  const sika = makeSpecialist(
    "sika",
    contexts.sika,
    runtime
  );

  return new Agent({
    name: "Office Manager AI",
    model: modelName(),
    instructions: OFFICE_MANAGER_INSTRUCTIONS,
    tools: [
      grandControleur.asTool({
        toolName: "consult_grand_controleur",
        toolDescription:
          "Consult Grand Contrôleur for mission setup/execution, work programmes, staffing, capacity, PBC/WP/review, deadlines and engagement risk."
      }),
      orpailleur.asTool({
        toolName: "consult_orpailleur",
        toolDescription:
          "Consult Orpailleur for actual Drive documents, document retrieval, versions, filing evidence and archives."
      }),
      sika.asTool({
        toolName: "consult_sika",
        toolDescription:
          "Consult Sika for billing, collections, payments and administrative follow-up analysis."
      })
    ]
  });
}

function extractToolNames(result) {
  const names = new Set();

  for (const item of result?.newItems || []) {
    const raw = item?.rawItem || item?.raw_item || item;
    const candidates = [
      raw?.name,
      raw?.toolName,
      item?.tool?.name,
      item?.name
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        names.add(candidate.trim());
      }
    }
  }

  return [...names];
}

async function runSdkAgent(agent, message) {
  const runner = new Runner({ model: modelName() });
  const result = await runner.run(agent, message, { maxTurns: 12 });
  const text = String(result.finalOutput ?? "").trim();

  if (!text) throw new Error("OPENAI_AGENT_EMPTY_RESPONSE");

  return {
    provider: "openai-agents-sdk",
    model: modelName(),
    text,
    lastAgent: result.lastAgent?.name || agent.name,
    toolsUsed: extractToolNames(result)
  };
}

export async function runOfficeManager({
  message,
  requestedAgent = "auto",
  contexts = {},
  provider = "auto",
  risk = "normal",
  orgId = null,
  runId = null
}) {
  const normalizedProvider = String(provider || "auto").toLowerCase();
  const normalizedRisk = String(risk || "normal").toLowerCase();
  const runtime = { orgId, runId };

  // Claude-only mode remains available as an alternate review/analysis path.
  // The OpenAI Agents SDK is the primary operational orchestration engine.
  if (normalizedProvider === "anthropic") {
    const agentKey =
      requestedAgent === "auto"
        ? "grand-controleur"
        : requestedAgent;

    const agent = getAgent(agentKey);
    const input = safeJson({
      user_request: message,
      agent: agentKey,
      evidence: contexts[agentKey] || {}
    });

    return runAI({
      agentKey,
      instructions: agent.instructions,
      input,
      provider: "anthropic",
      risk: normalizedRisk
    });
  }

  let primary;

  if (requestedAgent !== "auto") {
    primary = await runSdkAgent(
      makeSpecialist(
        requestedAgent,
        contexts[requestedAgent] || {},
        runtime
      ),
      message
    );
  } else {
    primary = await runSdkAgent(
      makeManager(contexts, runtime),
      message
    );
  }

  const claudeReady =
    Boolean(process.env.ANTHROPIC_API_KEY) &&
    Boolean(process.env.ANTHROPIC_MODEL);

  const needsIndependentReview =
    normalizedProvider === "dual" ||
    (
      (normalizedRisk === "high" || normalizedRisk === "critical") &&
      claudeReady
    );

  if (!needsIndependentReview) {
    return primary;
  }

  if (!claudeReady) {
    if (normalizedProvider === "dual") {
      throw new Error("ANTHROPIC_NOT_CONFIGURED_FOR_DUAL_REVIEW");
    }
    return primary;
  }

  const review = await runAI({
    agentKey:
      requestedAgent === "auto"
        ? "grand-controleur"
        : requestedAgent,
    provider: "anthropic",
    risk: normalizedRisk,
    instructions: `You are the independent Claude reviewer for Office Manager AI.
Review the primary answer for unsupported facts, contradictions, missing material risks, unsafe actions, overconfidence, privacy problems and failure to distinguish REQUESTED / EXECUTED / VERIFIED.
Return a corrected final answer for the user. Do not invent missing evidence. Do not perform any action.`,
    input:
      `USER REQUEST:\n${message}\n\n` +
      `PRIMARY OFFICE MANAGER ANSWER:\n${primary.text}`
  });

  return {
    provider: "dual",
    model: primary.model,
    primary,
    review,
    text: review.text,
    lastAgent: primary.lastAgent,
    toolsUsed: primary.toolsUsed || [],
    reviewed: true
  };
}
