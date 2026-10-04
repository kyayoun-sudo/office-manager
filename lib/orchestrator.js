import { Agent, Runner } from "@openai/agents";
import {
  AGENTS,
  OFFICE_MANAGER_INSTRUCTIONS,
  getAgent
} from "../agents/index.js";
import { runAI } from "./ai.js";

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
  return `${agent.instructions}\n\nAUTHORIZED EVIDENCE FOR THIS RUN:\n${safeJson(evidence)}\n\nUse only the evidence above plus the user's request. If a fact is not in the evidence, do not state it as confirmed.`;
}

function makeSpecialist(agentKey, evidence) {
  const config = getAgent(agentKey);

  return new Agent({
    name: config.name,
    model: modelName(),
    handoffDescription: config.handoffDescription,
    instructions: specialistInstructions(agentKey, evidence)
  });
}

function makeManager(contexts) {
  const grandControleur = makeSpecialist(
    "grand-controleur",
    contexts["grand-controleur"]
  );
  const orpailleur = makeSpecialist("orpailleur", contexts.orpailleur);
  const sika = makeSpecialist("sika", contexts.sika);

  return new Agent({
    name: "Office Manager AI",
    model: modelName(),
    instructions: OFFICE_MANAGER_INSTRUCTIONS,
    tools: [
      grandControleur.asTool({
        toolName: "consult_grand_controleur",
        toolDescription:
          "Consult Grand Contrôleur for mission execution, deadlines, capacity, quality and engagement-risk analysis."
      }),
      orpailleur.asTool({
        toolName: "consult_orpailleur",
        toolDescription:
          "Consult Orpailleur for Drive, document, version, filing and documentary-control analysis."
      }),
      sika.asTool({
        toolName: "consult_sika",
        toolDescription:
          "Consult Sika for billing, collections, payments and administrative follow-up analysis."
      })
    ]
  });
}

async function runSdkAgent(agent, message) {
  const runner = new Runner({ model: modelName() });
  const result = await runner.run(agent, message, { maxTurns: 8 });
  const text = String(result.finalOutput ?? "").trim();
  if (!text) throw new Error("OPENAI_AGENT_EMPTY_RESPONSE");

  return {
    provider: "openai-agents-sdk",
    model: modelName(),
    text,
    lastAgent: result.lastAgent?.name || agent.name
  };
}

export async function runOfficeManager({
  message,
  requestedAgent = "auto",
  contexts = {},
  provider = "auto",
  risk = "normal"
}) {
  const normalizedProvider = String(provider || "auto").toLowerCase();
  const normalizedRisk = String(risk || "normal").toLowerCase();

  // Claude-only mode remains available as an alternate single-specialist path.
  // The OpenAI Agents SDK is the primary orchestration engine.
  if (normalizedProvider === "anthropic") {
    const agentKey = requestedAgent === "auto" ? "grand-controleur" : requestedAgent;
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
      makeSpecialist(requestedAgent, contexts[requestedAgent] || {}),
      message
    );
  } else {
    primary = await runSdkAgent(makeManager(contexts), message);
  }

  const claudeReady =
    Boolean(process.env.ANTHROPIC_API_KEY) &&
    Boolean(process.env.ANTHROPIC_MODEL);

  const needsIndependentReview =
    normalizedProvider === "dual" ||
    ((normalizedRisk === "high" || normalizedRisk === "critical") && claudeReady);

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
    agentKey: requestedAgent === "auto" ? "grand-controleur" : requestedAgent,
    provider: "anthropic",
    risk: normalizedRisk,
    instructions: `You are the independent Claude reviewer for Office Manager AI.
Review the primary answer for unsupported facts, contradictions, missing material risks, unsafe actions, overconfidence, privacy problems and failure to distinguish facts from recommendations.
Return a corrected final answer for the user. Do not invent missing evidence. Do not perform any action.`,
    input: `USER REQUEST:\n${message}\n\nPRIMARY OFFICE MANAGER ANSWER:\n${primary.text}`
  });

  return {
    provider: "dual",
    model: primary.model,
    primary,
    review,
    text: review.text,
    lastAgent: primary.lastAgent,
    reviewed: true
  };
}
