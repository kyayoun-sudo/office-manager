import { tool } from "@openai/agents";
import { z } from "zod";
import { consultEynowaLab, eynowaLabConfigured } from "./eynowa-lab-client.js";
import { createToolEvent, finishToolEvent } from "./supabase.js";

function short(value, max = 1200) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return String(value || "").slice(0, max);
  }
}

export function makeEynowaLabManagerTool(runtime = {}) {
  if (!eynowaLabConfigured()) return null;

  return tool({
    name: "consult_eynowa_lab",
    description:
      "Consult EYNOWA Lab, the métier specialist helper for accounting, audit and advisory. Use it when professional standards, accounting treatment, audit methodology, finance, risk or advisory expertise materially helps. Lab provides professional evidence and recommendations only; Office Manager and the human professional retain decision and action authority.",
    parameters: z.object({
      query: z.string(),
      task: z.string().optional(),
      domains: z.array(z.enum(["accounting", "audit", "advisory"])).optional(),
      frameworks: z.array(z.string()).optional(),
      country: z.string().optional(),
      client: z.string().optional()
    }),
    async execute(args) {
      let event = null;
      try {
        if (runtime.orgId && runtime.runId) {
          event = await createToolEvent({
            org_id: runtime.orgId,
            run_id: runtime.runId,
            parent_agent_key: "orchestrator",
            specialist_key: "eynowa-lab",
            tool_name: "consult_eynowa_lab",
            phase: "started",
            input_summary: short(args),
            metadata: { role: "professional_helper" }
          });
        }

        const result = await consultEynowaLab({
          application: "firm_manager",
          query: args.query,
          task: [args.task, "calling_agent:office_manager"].filter(Boolean).join(" | "),
          domains: args.domains,
          frameworks: args.frameworks || [],
          country: args.country || "CI",
          professionalId: runtime.professionalId || "default",
          client: args.client || ""
        });

        if (Array.isArray(runtime.eynowaLabConsultations)) {
          runtime.eynowaLabConsultations.push(result);
        }

        if (event?.id) {
          await finishToolEvent(event.id, {
            phase: "completed",
            output_summary: short(result),
            finished_at: new Date().toISOString()
          });
        }
        return result;
      } catch (error) {
        if (event?.id) {
          try {
            await finishToolEvent(event.id, {
              phase: "failed",
              output_summary: short(error?.message || error),
              finished_at: new Date().toISOString()
            });
          } catch {}
        }
        throw error;
      }
    }
  });
}
