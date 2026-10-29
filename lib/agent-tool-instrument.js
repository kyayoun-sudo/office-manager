import { withOperationActor } from "./operation-context.js";
import { finishAgentToolEvent, startAgentToolEvent } from "./supabase.js";
// Wraps a tool so that every call leaves a start / end event in office_agent_tool_events (extracted from agent-tools.js, audit 2026-10-29).

function asJson(value) {
  return JSON.stringify(value ?? null, null, 2);
}

function inputSummary(input) {
  if (!input || typeof input !== "object") return "no parameters";
  return `fields: ${Object.keys(input).join(", ")}`.slice(0, 500);
}

function outputSummary(value) {
  if (Array.isArray(value)) return `rows=${value.length}`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).slice(0, 12).join(",");
    return `object:${keys}`.slice(0, 500);
  }
  return String(value ?? "ok").slice(0, 500);
}

export function instrument({
  orgId,
  runId,
  specialistKey,
  storageKey,
  toolName,
  execute
}) {
  return async input => {
    const event = await startAgentToolEvent({
      orgId,
      runId,
      specialistKey: storageKey || specialistKey,
      toolName,
      inputSummary: inputSummary(input),
      metadata: { logical_agent_key: specialistKey }
    });

    try {
      const result = await withOperationActor({orgId,actor:specialistKey || storageKey || 'office-manager',kind:'agent'},()=>execute(input));
      await finishAgentToolEvent(event?.id, {
        phase: "completed",
        outputSummary: outputSummary(result),
        // journal_record: durable, append-only trace of a business decision
        // (WP creation, PBC evaluation) in office_agent_tool_events.metadata.
        metadata: {
          logical_agent_key: specialistKey,
          ...(result?.journal_record ? { journal: result.journal_record } : {})
        }
      });
      return asJson(result);
    } catch (error) {
      await finishAgentToolEvent(event?.id, {
        phase: "failed",
        outputSummary: String(error?.message || error).slice(0, 500),
        metadata: { logical_agent_key: specialistKey }
      });
      throw error;
    }
  };
}
