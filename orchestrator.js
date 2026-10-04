import { Agent, Runner } from "@openai/agents";
import {
  OFFICE_MANAGER_INSTRUCTIONS,
  getAgent
} from "../agents/index.js";
import { runAI } from "./ai.js";
import { createToolEvent } from "./supabase.js";
import { makeSpecialistTools } from "./tools.js";

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

function short(value, max = 1200) {
  const stringValue = String(value ?? "");
  return stringValue.length > max
    ? `${stringValue.slice(0, max)}…`
    : stringValue;
}

function specialistInstructions(agentKey, evidence) {
  const agent = getAgent(agentKey);
  return `${agent.instructions}

AUTHORIZED EVIDENCE PRELOADED FOR THIS RUN:
${safeJson(evidence)}

You also have authorised function tools. Use them when the preloaded evidence is not enough. Do not state a fact as confirmed unless it is supported by the supplied evidence or a tool result.`;
}

function makeSpecialist(agentKey, evidence, runtime) {
  const config = getAgent(agentKey);

  return new Agent({
    name: config.name,
    model: modelName(),
    handoffDescription: config.handoffDescription,
    instructions: specialistInstructions(agentKey, evidence),
    tools: makeSpecialistTools(agentKey, runtime)
  });
}

function specialistFromToolName(toolName) {
  const map = {
    consult_grand_controleur: "grand-controleur",
    consult_orpailleur: "orpailleur",
    consult_sika: "sika"
  };
  return map[toolName] || null;
}

async function logSpecialistCall(runtime, specialistKey, result) {
  if (!runtime?.orgId || !runtime?.runId) return;

  try {
    await createToolEvent({
      org_id: runtime.orgId,
      run_id: runtime.runId,
      parent_agent_key: "orchestrator",
      specialist_key: specialistKey,
      tool_name: result.agentToolInvocation?.toolName || `consult_${specialistKey}`,
      phase: "completed",
      input_summary: short(result.agentToolInvocation?.toolArguments || ""),
      output_summary: short(result.finalOutput || ""),
      metadata: {
        tool_call_id: result.agentToolInvocation?.toolCallId || null,
        nested_last_agent: result.lastAgent?.name || null
      },
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("SPECIALIST_TOOL_EVENT_LOG_FAILED", error);
  }
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
          "Consult Grand Contrôleur for TDR/TOR, mission execution, work programme, PBC, standards, responsibilities, deadlines, quality and missing work.",
        customOutputExtractor: async result => {
          await logSpecialistCall(runtime, "grand-controleur", result);
          return String(result.finalOutput ?? "");
        }
      }),
      orpailleur.asTool({
        toolName: "consult_orpailleur",
        toolDescription:
          "Consult Orpailleur to find, inspect, classify, retrieve or assess documents, filing, versions and archives.",
        customOutputExtractor: async result => {
          await logSpecialistCall(runtime, "orpailleur", result);
          return String(result.finalOutput ?? "");
        }
      }),
      sika.asTool({
        toolName: "consult_sika",
        toolDescription:
          "Consult Sika for billing, collections, payment evidence and administrative follow-up.",
        customOutputExtractor: async result => {
          await logSpecialistCall(runtime, "sika", result);
          return String(result.finalOutput ?? "");
        }
      })
    ]
  });
}

function extractTopLevelToolUsage(result) {
  const toolNames = [];
  const specialists = [];

  for (const item of result?.newItems || []) {
    if (item?.type !== "tool_call_item") continue;
    const toolName = item.toolName || item.rawItem?.name;
    if (!toolName) continue;

    toolNames.push(toolName);

    const specialist = specialistFromToolName(toolName);
    if (specialist) specialists.push(specialist);
  }

  return {
    toolsUsed: [...new Set(toolNames)],
    specialistsUsed: [...new Set(specialists)]
  };
}

async function runSdkAgent(agent, message) {
  const runner = new Runner({ model: modelName() });
  const result = await runner.run(agent, message, { maxTurns: 12 });
  const text = String(result.finalOutput ?? "").trim();

  if (!text) throw new Error("OPENAI_AGENT_EMPTY_RESPONSE");

  const usage = extractTopLevelToolUsage(result);

  return {
    provider: "openai-agents-sdk",
    model: modelName(),
    text,
    lastAgent: result.lastAgent?.name || agent.name,
    specialistsUsed: usage.specialistsUsed,
    toolsUsed: usage.toolsUsed
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

  if (normalizedProvider === "anthropic") {
    const agentKey =
      requestedAgent === "auto" ? "grand-controleur" : requestedAgent;
    const agent = getAgent(agentKey);

    const input = safeJson({
      user_request: message,
      agent: agentKey,
      evidence: contexts[agentKey] || {}
    });

    const result = await runAI({
      agentKey,
      instructions: agent.instructions,
      input,
      provider: "anthropic",
      risk: normalizedRisk
    });

    return {
      ...result,
      specialistsUsed: [agentKey],
      toolsUsed: []
    };
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

    primary.specialistsUsed = [
      ...new Set([requestedAgent, ...(primary.specialistsUsed || [])])
    ];
  } else {
    primary = await runSdkAgent(makeManager(contexts, runtime), message);
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

  if (!needsIndependentReview) return primary;

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
Review the primary answer for unsupported facts, contradictions, missing material risks, unsafe actions, overconfidence, privacy problems and failure to distinguish REQUESTED, EXECUTED and VERIFIED.
Return a corrected final answer for the user. Do not invent missing evidence. Do not perform any action.`,
    input: `USER REQUEST:
${message}

PRIMARY OFFICE MANAGER ANSWER:
${primary.text}`
  });

  return {
    provider: "dual",
    model: primary.model,
    primary,
    review,
    text: review.text,
    lastAgent: primary.lastAgent,
    reviewed: true,
    specialistsUsed: primary.specialistsUsed || [],
    toolsUsed: primary.toolsUsed || []
  };
}
