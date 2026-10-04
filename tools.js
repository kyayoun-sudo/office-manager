import { tool } from "@openai/agents";
import { z } from "zod";
import {
  createActionProposal,
  createToolEvent,
  finishToolEvent,
  getMissionAssignments,
  getMissionControls,
  getOpenActions,
  searchArchives,
  searchDocuments,
  searchMissions,
  searchTeamMembers
} from "./supabase.js";

function short(value, max = 1200) {
  let output;
  try {
    output = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    output = String(value ?? "");
  }
  return output.length > max ? `${output.slice(0, max)}…` : output;
}

function instrument({
  orgId,
  runId,
  agentKey,
  name,
  description,
  parameters,
  execute
}) {
  return tool({
    name,
    description,
    parameters,
    async execute(args) {
      let event = null;

      try {
        if (orgId && runId) {
          event = await createToolEvent({
            org_id: orgId,
            run_id: runId,
            parent_agent_key: agentKey,
            specialist_key: agentKey,
            tool_name: name,
            phase: "started",
            input_summary: short(args),
            metadata: {}
          });
        }

        const result = await execute(args);

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

function commonReadTools(runtime, agentKey) {
  const { orgId, runId } = runtime;

  const searchTeam = instrument({
    orgId,
    runId,
    agentKey,
    name: "search_team_directory",
    description:
      "Search the authorised Team Directory for real staff names, professional emails, roles, grades, departments and reporting lines. Use this before guessing who a person or responsible staff member is.",
    parameters: z.object({
      query: z.string()
    }),
    execute: ({ query }) => searchTeamMembers(orgId, query, 15)
  });

  const openActions = instrument({
    orgId,
    runId,
    agentKey,
    name: "search_open_internal_actions",
    description:
      "Search open internal actions and reminders. This shows whether work is only requested, executed, blocked, or verified.",
    parameters: z.object({
      query: z.string()
    }),
    execute: ({ query }) => getOpenActions(orgId, query, 50)
  });

  return [searchTeam, openActions];
}

export function makeSpecialistTools(agentKey, runtime = {}) {
  const { orgId, runId } = runtime;
  if (!orgId) return [];

  const common = commonReadTools(runtime, agentKey);

  if (agentKey === "grand-controleur") {
    const searchMission = instrument({
      orgId,
      runId,
      agentKey,
      name: "search_missions",
      description:
        "Search the authorised mission register by client, mission name, code or status. Use it to resolve the exact mission before checking controls.",
      parameters: z.object({
        query: z.string()
      }),
      execute: ({ query }) => searchMissions(orgId, query, 20)
    });

    const missionControls = instrument({
      orgId,
      runId,
      agentKey,
      name: "get_mission_controls",
      description:
        "Get the control requirements for one exact office mission: work-programme requirements, standard references, expected evidence, responsible staff, due dates and status.",
      parameters: z.object({
        mission_id: z.string()
      }),
      execute: ({ mission_id }) => getMissionControls(orgId, mission_id, 150)
    });

    const assignments = instrument({
      orgId,
      runId,
      agentKey,
      name: "get_mission_assignments",
      description:
        "Get the staff assigned to one exact mission, including mission role, cycles, dates and allocation.",
      parameters: z.object({
        mission_id: z.string()
      }),
      execute: ({ mission_id }) => getMissionAssignments(orgId, mission_id)
    });

    const documents = instrument({
      orgId,
      runId,
      agentKey,
      name: "search_document_index",
      description:
        "Search the verified document inventory for evidence such as engagement letters, work programmes, strategies, PBC items, working papers, reports or other mission documents.",
      parameters: z.object({
        query: z.string()
      }),
      execute: ({ query }) => searchDocuments(orgId, query, 25)
    });

    const proposeAction = instrument({
      orgId,
      runId,
      agentKey,
      name: "propose_internal_follow_up",
      description:
        "Create a PROPOSED internal follow-up action for missing work. This does not send an email and does not mark the work as completed.",
      parameters: z.object({
        mission_id: z.string().nullable(),
        action_type: z.string(),
        summary: z.string(),
        assigned_staff_profile_id: z.string().nullable(),
        due_at: z.string().nullable(),
        evidence_summary: z.string().nullable()
      }),
      execute: args => createActionProposal({
        orgId,
        agentKey,
        missionId: args.mission_id,
        actionType: args.action_type,
        summary: args.summary,
        assignedStaffProfileId: args.assigned_staff_profile_id,
        dueAt: args.due_at,
        evidenceSummary: args.evidence_summary
      })
    });

    return [
      ...common,
      searchMission,
      missionControls,
      assignments,
      documents,
      proposeAction
    ];
  }

  if (agentKey === "orpailleur") {
    const documents = instrument({
      orgId,
      runId,
      agentKey,
      name: "search_document_index",
      description:
        "Search the actual indexed documents by filename, client, document type, period, folder path or indexed metadata. Return real file IDs, paths and links when present.",
      parameters: z.object({
        query: z.string()
      }),
      execute: ({ query }) => searchDocuments(orgId, query, 30)
    });

    const archives = instrument({
      orgId,
      runId,
      agentKey,
      name: "search_archives",
      description:
        "Search archived mission/document records and return their actual archive status and location. This does not restore an archive.",
      parameters: z.object({
        query: z.string()
      }),
      execute: ({ query }) => searchArchives(orgId, query, 30)
    });

    const proposeAction = instrument({
      orgId,
      runId,
      agentKey,
      name: "propose_document_action",
      description:
        "Create a PROPOSED internal documentary action such as review, filing, archive review or retrieval. This does not move, delete or restore any file.",
      parameters: z.object({
        mission_id: z.string().nullable(),
        action_type: z.string(),
        summary: z.string(),
        assigned_staff_profile_id: z.string().nullable(),
        due_at: z.string().nullable(),
        evidence_summary: z.string().nullable()
      }),
      execute: args => createActionProposal({
        orgId,
        agentKey,
        missionId: args.mission_id,
        actionType: args.action_type,
        summary: args.summary,
        assignedStaffProfileId: args.assigned_staff_profile_id,
        dueAt: args.due_at,
        evidenceSummary: args.evidence_summary
      })
    });

    return [...common, documents, archives, proposeAction];
  }

  const proposeAction = instrument({
    orgId,
    runId,
    agentKey,
    name: "propose_admin_follow_up",
    description:
      "Create a PROPOSED internal billing/collection/administrative follow-up. It does not contact the client and does not confirm payment.",
    parameters: z.object({
      mission_id: z.string().nullable(),
      action_type: z.string(),
      summary: z.string(),
      assigned_staff_profile_id: z.string().nullable(),
      due_at: z.string().nullable(),
      evidence_summary: z.string().nullable()
    }),
    execute: args => createActionProposal({
      orgId,
      agentKey,
      missionId: args.mission_id,
      actionType: args.action_type,
      summary: args.summary,
      assignedStaffProfileId: args.assigned_staff_profile_id,
      dueAt: args.due_at,
      evidenceSummary: args.evidence_summary
    })
  });

  return [...common, proposeAction];
}
