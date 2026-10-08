import { Agent, Runner } from "@openai/agents";
import {
  GRAND_CONTROLEUR_INSTRUCTIONS,
  ROOT_AGENT_KEY,
  ROOT_AGENT_NAME,
  ROOT_ROUTE,
  getAgent
} from "../agents/index.js";
import { runAI } from "./ai.js";
import { buildRootTools, buildSpecialistTools } from "./agent-tools.js";

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

// How an answer reads (Paul, 2026-10-07: « écris comme un professionnel… gras, souligné, mais pas
// ces étoiles partout »). The app shows the Markdown as a formatted document.
export const ANSWER_STYLE = `WRITING THE ANSWER (shown to the firm as a formatted document):
- Write like a senior audit manager writing to a partner: clear, factual, concise, no filler, no emoji, no exclamation marks.
- Start with one or two sentences that answer the question directly. Then, only if useful, short sections with a "### " title (2 to 4 sections at most).
- Bold (**text**) only for the few facts that matter (a figure, a deadline, a name, a decision to take): at most one per paragraph. Underline (++text++) only for the one point the reader must act on. Never put asterisks anywhere else; never bold whole sentences or list labels.
- Lists with "- " for items; numbered "1. " for steps. A small table (| col | col |) when comparing people, missions or figures.
- End with a "### Prochaines étapes" (or "### Next steps" when answering in English) section of 1 to 3 items when an action is expected.
- Plain characters: no decorative symbols, no "---" separators, no headings in capitals.`;

function withSnapshot(instructions, evidence) {
  return `${instructions}

${ANSWER_STYLE}

PRELOADED TECHNICAL SNAPSHOT FOR THIS RUN:
${safeJson(evidence)}

The snapshot may be stale. For Office Manager app missions, use read_office_mission_dossier with the mission UUID to read current scope, requirements and assignments from Supabase. This is distinct from the Drive planning register. Use Drive tools for Drive facts; a Drive read failure does not mean the Supabase dossier is absent. State the source and any unresolved discrepancy. If a fact is not evidenced, do not state it as confirmed.`;
}

function specialistInstructions(agentKey, evidence) {
  return withSnapshot(getAgent(agentKey).instructions, evidence);
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

// Tool names used by the root agent to consult its specialists.
// api/agent.js maps them back to specialist keys.
export const CONSULT_TOOLS = {
  "mission-controller": "consult_mission_controller",
  "orpailleur": "consult_orpailleur",
  "sika": "consult_sika",
  "enhanced-auditor": "consult_enhanced_auditor"
};

// Builds the root agent: GRAND CONTRÔLEUR / OFFICE MANAGER AI.
// Its specialists: Mission Controller, Orpailleur, Sika and (2026-10-08) Enhanced Auditor.
// There is no "Grand Contrôleur" specialist and no consult tool for it.
function makeManager(contexts, runtime, rootContext = {}) {
  const missionController = makeSpecialist(
    "mission-controller",
    contexts["mission-controller"],
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

  const enhancedAuditor = makeSpecialist(
    "enhanced-auditor",
    contexts["enhanced-auditor"],
    runtime
  );

  return new Agent({
    name: ROOT_AGENT_NAME,
    model: modelName(),
    instructions: withSnapshot(GRAND_CONTROLEUR_INSTRUCTIONS, rootContext),
    tools: [
      missionController.asTool({
        toolName: CONSULT_TOOLS["mission-controller"],
        toolDescription:
          "Consult Mission Controller for one mission's lifecycle: TDR/contract/engagement letter, validated work programme, cycles/workstreams, required Working Papers, PBC List and received-document control, execution, review, mission deadlines, delay risks and overdue-PBC reminders."
      }),
      orpailleur.asTool({
        toolName: CONSULT_TOOLS.orpailleur,
        toolDescription:
          "Consult Orpailleur for actual Drive documents, document retrieval, versions, filing evidence and archives."
      }),
      sika.asTool({
        toolName: CONSULT_TOOLS.sika,
        toolDescription:
          "Consult Sika for billing, collections, payments and administrative follow-up analysis."
      }),
      enhancedAuditor.asTool({
        toolName: CONSULT_TOOLS["enhanced-auditor"],
        toolDescription:
          "Consult Enhanced Auditor for audit intelligence and review: combined risk register (your industry risk briefing + the auditor's risk assessment), missing procedures, evaluation of audit evidence, whether each risk is fully covered, pictures turned into Excel/reports, patterns in working files."
      }),
      ...buildRootTools(runtime)
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

// requestedAgent: ROOT_ROUTE ("auto") for the Grand Contrôleur root, or a
// specialist key (mission-controller / orpailleur / sika) for a direct call.
// runtime.storageKeys: logical agent key -> Supabase agent_key (legacy
// fallback while mission-controller has no settings row).
export async function runOfficeManager({
  message,
  requestedAgent = ROOT_ROUTE,
  contexts = {},
  rootContext = {},
  provider = "auto",
  risk = "normal",
  orgId = null,
  runId = null,
  storageKeys = {}
}) {
  const normalizedProvider = String(provider || "auto").toLowerCase();
  const normalizedRisk = String(risk || "normal").toLowerCase();
  const runtime = { orgId, runId, storageKeys };
  const isRoot = requestedAgent === ROOT_ROUTE;

  // Claude-only mode remains available as an alternate review/analysis path.
  // The OpenAI Agents SDK is the primary operational orchestration engine.
  if (normalizedProvider === "anthropic") {
    const agentKey = isRoot ? ROOT_AGENT_KEY : requestedAgent;
    const instructions = isRoot
      ? GRAND_CONTROLEUR_INSTRUCTIONS
      : getAgent(requestedAgent).instructions;
    const evidence = isRoot
      ? { root: rootContext, specialists: contexts }
      : contexts[requestedAgent] || {};

    const input = safeJson({
      user_request: message,
      agent: agentKey,
      evidence
    });

    return runAI({
      agentKey,
      instructions,
      input,
      provider: "anthropic",
      risk: normalizedRisk
    });
  }

  let primary;

  if (!isRoot) {
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
      makeManager(contexts, runtime, rootContext),
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
    agentKey: isRoot ? ROOT_AGENT_KEY : requestedAgent,
    provider: "anthropic",
    risk: normalizedRisk,
    instructions: `You are the independent Claude reviewer for Office Manager AI.
Review the primary answer for unsupported facts, contradictions, missing material risks, unsafe actions, overconfidence, privacy problems and failure to distinguish REQUESTED / EXECUTED / VERIFIED.
Return a corrected final answer for the user. Do not invent missing evidence. Do not perform any action.

${ANSWER_STYLE}`,
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

// Exposed for structural tests (no network call).
export { makeManager as buildManagerAgent, makeSpecialist as buildSpecialistAgent };
