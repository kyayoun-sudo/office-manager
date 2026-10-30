import { instrument } from "./agent-tool-instrument.js";
import { planPbcFromSops } from "./pbc-sop-plan.js";
import { MISSION_DOCUMENT_MAX_CHARS } from "./document-reading.js";
import { tool } from "@openai/agents";
import { z } from "zod";
import {
  ensureFileCopyFromTemplate,
  getDriveFileMetadata,
  getSheetValues,
  readDriveFileText,
  updateSheetValues
} from "./google-drive.js";
import {
  CHECK_VALUES,
  EVIDENCE_CHECK_KEYS,
  MISSION_TYPE_KEYS,
  PBC_STATES,
  applyPbcItemPlan,
  checkProgrammeState,
  decidePbcEvaluation,
  loadPbcItem,
  planPbcItemApplicability,
  programmeNameLooksDraft,
  writePbcEvaluation
} from "./mission-engine.js";
import { driveAdapter } from "./drive-adapter.js";
import { locatePbcSheet, pbcRange } from "./mission-engine.js";
import { pbcColumnsFromHeader } from "./pbc-lifecycle.js";

// Where the PBC list is in this checklist, found by its columns (audit 2026-10-30); the pilot's PBC_MASTER layout when the
// sheets cannot be listed. A checklist where no PBC header is found is said, never read at a guessed position.
async function pbcLayout(spreadsheetId) {
  const layout = await locatePbcSheet(driveAdapter, spreadsheetId);
  if (layout.found) return layout;
  throw Object.assign(new Error("PBC_SHEET_NOT_FOUND"), { statusCode: 422, sheets_seen: layout.sheets_seen });
}
import {
  gateBlockedResult,
  mappingGate,
  resolveRoleViaMap
} from "./memory-runtime.js";
import {
  PBC_REMINDER_GRACE_HOURS,
  PBC_EXTERNAL_REMINDER_ACTION,
  pbcLifecycleState,
  findOverduePbcItems
} from "./pbc-lifecycle.js";
import {
  defaultPbcMasterFileId,
  writeParameterByLabel,
  pbcRowsToSummary,
  queueInternalAction,
  parameterValue
} from "./agent-tool-helpers.js";

// Tools of the operational catalog (6), extracted from agent-tools.js (audit 2026-10-29).
export function pbcTools(ctx) {
  const createOrUpdatePbcChecklist = tool({
    name: "create_or_update_mission_pbc",
    description:
      "Create or update a mission PBC checklist by copying the organisation's approved PBC master and setting mission parameters/cycle applicability from an explicitly validated work programme. Optionally refine applicability per existing PBC item (pbc_item_applicability) when the programme does not require every procedure of a retained cycle: each decision must quote the programme; items are only switched on/off, never invented, and never written over a formula cell. Never use an unvalidated/draft programme.",
    parameters: z.object({
      destination_parent_id: z.string().min(1),
      client: z.string().min(1),
      exercise: z.string().min(1),
      close_date: z.string().min(1),
      mission_reference: z.string().min(1),
      validated_program_file_id: z.string().min(1),
      validated_program_url: z.string().nullable().optional(),
      validated_plan_confirmed: z.boolean(),
      applicable_cycles: z.array(z.string().min(2)).min(1),
      senior_responsable: z.string().nullable().optional(),
      manager: z.string().nullable().optional(),
      initial_request_date: z.string().nullable().optional(),
      checklist_name: z.string().nullable().optional(),
      pbc_template_file_id: z.string().nullable().optional(),
      mission_type: z.enum(MISSION_TYPE_KEYS).nullable().optional(),
      // Programme-driven, item-level applicability inside retained cycles.
      // Each decision targets an EXISTING master reference and quotes the
      // validated programme; nothing is ever added to the master.
      programme_fingerprint: z.string().nullable().optional(),
      pbc_item_applicability: z.array(z.object({
        pbc_reference: z.string().min(1),
        applicable: z.boolean(),
        programme_procedure: z.string().min(3),
        source_evidence_excerpt: z.string().min(12)
      })).max(300).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "create_or_update_mission_pbc",
      execute: async input => {
        if (!input.validated_plan_confirmed) {
          return {
            written: false,
            status: "VALIDATED_PLAN_REQUIRED",
            reason:
              "PBC generation is blocked until the mission work programme is explicitly validated."
          };
        }

        const plan = await getDriveFileMetadata(
          input.validated_program_file_id
        );
        const planName = String(plan.name || "");
        if (programmeNameLooksDraft(planName)) {
          return {
            written: false,
            status: "VALIDATION_CONFLICT",
            reason:
              `The supplied programme is named '${planName}', which still indicates a draft/to-be-validated version. Use the validated version or obtain explicit validation evidence before generating the PBC.`,
            programme: plan
          };
        }

        const gate = await mappingGate();
        if (!gate.allowed) return gateBlockedResult(gate);

        const checklistName = input.checklist_name ||
          `${input.mission_reference}_PBC_CHECKLIST`;
        // PBC master source: explicit > owner-approved MAP role > legacy default.
        let templateFileId = input.pbc_template_file_id || null;
        let pbcMasterBasis = templateFileId ? "EXPLICIT" : null;
        if (!templateFileId) {
          const resolution = await resolveRoleViaMap("PBC_MASTER");
          if (resolution.status === "REVIEW_REQUIRED") {
            return { written: false, status: "PBC_MASTER_REVIEW_REQUIRED", map_resolution: resolution };
          }
          if (resolution.status === "OWNER_APPROVED") {
            templateFileId = resolution.target_file_id;
            pbcMasterBasis = "OWNER_APPROVED_MAP";
          } else {
            templateFileId = defaultPbcMasterFileId();
            pbcMasterBasis = "LEGACY_DEFAULT";
          }
        }

        const ensured = await ensureFileCopyFromTemplate({
          templateFileId,
          destinationParentId: input.destination_parent_id,
          destinationName: checklistName
        });
        const spreadsheetId = ensured.file.id;
        const paramRows = await getSheetValues(
          spreadsheetId,
          "PARAMETRES!A1:D100"
        );

        const programRef = [
          planName,
          plan.modifiedTime ? `modifié ${plan.modifiedTime}` : "",
          input.validated_program_url || plan.webViewLink || ""
        ].filter(Boolean).join(" | ");

        const writes = [
          ["Client", input.client],
          ["Exercice audité", input.exercise],
          ["Date de clôture", input.close_date],
          ["Référence mission", input.mission_reference],
          ["Programme de travail validé (réf. / date)", programRef],
          ["Date d'envoi de la demande PBC initiale", input.initial_request_date || ""],
          ["Senior responsable du suivi PBC", input.senior_responsable || ""],
          ["Manager", input.manager || ""]
        ];

        const writtenParameters = [];
        for (const [label, value] of writes) {
          const written = await writeParameterByLabel(
            spreadsheetId,
            paramRows,
            label,
            value
          );
          if (written) writtenParameters.push(label);
        }

        const cycleSet = new Set(
          input.applicable_cycles.map(code => String(code).trim().toUpperCase())
        );
        const cycleRows = await getSheetValues(
          spreadsheetId,
          "PARAMETRES!A16:D80"
        );
        const cycleUpdates = [];

        for (let i = 1; i < cycleRows.length; i += 1) {
          const code = String(cycleRows[i]?.[0] || "").trim().toUpperCase();
          if (!/^[A-Z]{3}$/.test(code)) continue;
          const absoluteRow = 16 + i;
          const applicable = cycleSet.has(code) ? "Oui" : "Non";
          const comment = cycleSet.has(code)
            ? `Applicable selon programme validé: ${planName}`
            : `Non retenu selon programme validé: ${planName}`;
          await updateSheetValues(
            spreadsheetId,
            `PARAMETRES!C${absoluteRow}:D${absoluteRow}`,
            [[applicable, comment]]
          );
          cycleUpdates.push({ code, applicable });
        }

        let itemApplicability = null;
        if (input.pbc_item_applicability?.length) {
          const read = await readDriveFileText(input.validated_program_file_id, {
            maxChars: 60000
          });
          const state = checkProgrammeState({
            meta: plan,
            read,
            validatedConfirmed: true,
            expectedFingerprint: input.programme_fingerprint || null
          });
          if (!state.ok) {
            itemApplicability = {
              status: state.status,
              reasons: state.reasons,
              items: []
            };
          } else {
            const layout = await pbcLayout(spreadsheetId);
            const rowsForPlan = await getSheetValues(spreadsheetId, pbcRange(layout));
            const itemPlan = planPbcItemApplicability({
              headerRow: layout.header_row,
              columns: layout.columns,
              rows: rowsForPlan,
              retainedCycles: input.applicable_cycles,
              decisions: input.pbc_item_applicability,
              programmeText: read.text
            });
            const applied = await applyPbcItemPlan(
              driveAdapter,
              spreadsheetId,
              itemPlan
            );
            const counts = {};
            for (const item of applied) {
              counts[item.status] = (counts[item.status] || 0) + 1;
            }
            itemApplicability = { status: "PROCESSED", counts, items: applied };
          }
        }

        const pbcRows = await getSheetValues(spreadsheetId, pbcRange(await pbcLayout(spreadsheetId)));

        return {
          written: true,
          created: ensured.created,
          mission_type: input.mission_type || null,
          pbc_master: { file_id: templateFileId, basis: pbcMasterBasis },
          item_applicability: itemApplicability,
          checklist: {
            file_id: spreadsheetId,
            name: ensured.file.name,
            url: ensured.file.webViewLink
          },
          validated_program: {
            file_id: plan.id,
            name: planName,
            url: plan.webViewLink,
            modified_at: plan.modifiedTime
          },
          parameters_written: writtenParameters,
          cycle_updates: cycleUpdates,
          pbc_summary: pbcRowsToSummary(pbcRows)
        };
      }
    })
  });

  const inspectPbcChecklist = tool({
    name: "inspect_pbc_checklist",
    description:
      "Inspect an existing mission PBC checklist and summarize applicable requests, automatic statuses and critical missing items. Does not mark documents received unless the checklist/evidence already supports it.",
    parameters: z.object({
      spreadsheet_file_id: z.string().min(1),
      critical_limit: z.number().int().min(1).max(100).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "inspect_pbc_checklist",
      execute: async ({ spreadsheet_file_id, critical_limit }) => {
        const meta = await getDriveFileMetadata(spreadsheet_file_id);
        if (meta.mimeType !== "application/vnd.google-apps.spreadsheet") {
          return {
            inspected: false,
            reason: "The supplied file is not a native Google Sheet PBC checklist.",
            file: meta
          };
        }
        const [params, pbcRows] = await Promise.all([
          getSheetValues(spreadsheet_file_id, "PARAMETRES!A1:D80"),
          pbcLayout(spreadsheet_file_id).then(layout => getSheetValues(spreadsheet_file_id, pbcRange(layout)))
        ]);
        return {
          inspected: true,
          file: meta,
          mission_parameters: params,
          summary: pbcRowsToSummary(
            pbcRows,
            critical_limit || 50
          )
        };
      }
    })
  });

  const detectOverduePbcReminders = tool({
    name: "detect_overdue_pbc_reminders",
    description:
      "Inspect a mission PBC checklist and detect applicable PBC items still missing more than 24 hours after their expected date. When create_actions is true, queue one structured external-reminder action per overdue item for the mission Manager and the client/site responsible person. Actions stay PENDING for the future email dispatcher: nothing is sent and no email address is resolved or invented.",
    parameters: z.object({
      spreadsheet_file_id: z.string().min(1),
      mission_id: z.string().nullable().optional(),
      mission_manager_name: z.string().nullable().optional(),
      client_site_responsible_name: z.string().nullable().optional(),
      create_actions: z.boolean()
    }),
    execute: instrument({
      ...ctx,
      toolName: "detect_overdue_pbc_reminders",
      execute: async input => {
        const meta = await getDriveFileMetadata(input.spreadsheet_file_id);
        if (meta.mimeType !== "application/vnd.google-apps.spreadsheet") {
          return {
            inspected: false,
            reason: "The supplied file is not a native Google Sheet PBC checklist.",
            file: meta
          };
        }

        const [params, pbcRows] = await Promise.all([
          getSheetValues(input.spreadsheet_file_id, "PARAMETRES!A1:D80"),
          pbcLayout(input.spreadsheet_file_id).then(layout => getSheetValues(input.spreadsheet_file_id, pbcRange(layout)))
        ]);

        const managerFromChecklist = parameterValue(params, "Manager");
        const missionReference = parameterValue(params, "Référence mission");
        const now = new Date();
        const { overdue, unparseableDeadlines } = findOverduePbcItems(
          pbcRows,
          now
        );

        const managerName =
          input.mission_manager_name || managerFromChecklist || null;
        const clientResponsibleName =
          input.client_site_responsible_name || null;

        const queued = [];
        if (input.create_actions) {
          for (const item of overdue) {
            const result = await queueInternalAction(ctx, {
              missionId: input.mission_id || null,
              assignedStaffProfileId: null,
              actionType: PBC_EXTERNAL_REMINDER_ACTION,
              summary:
                `Relance PBC ${item.reference} (${item.document || "document"}) — attendue le ${item.deadline}, état ${item.lifecycle_state} ${PBC_REMINDER_GRACE_HOURS}h après l'échéance.`.slice(0, 500),
              dueAt: now.toISOString(),
              // One reminder per item, deadline AND state: no duplicate for the
              // same state/deadline; a new state (e.g. NON_CONFORME after
              // PARTIAL) can be reminded again.
              idempotencyParts: [
                "pbc-reminder",
                input.spreadsheet_file_id,
                item.reference,
                item.deadline,
                item.lifecycle_state
              ],
              evidence: {
                checklist_file_id: meta.id,
                checklist_name: meta.name || "",
                checklist_url: meta.webViewLink || "",
                pbc_reference: item.reference,
                raw_status: item.raw_status,
                lifecycle_state: item.lifecycle_state,
                deadline: item.deadline,
                overdue_since: item.overdue_since
              },
              payload: {
                channel: "email",
                direction: "external",
                dispatch_status: "PENDING_EMAIL_DISPATCHER",
                dispatch_group: input.spreadsheet_file_id,
                mission_reference: missionReference || null,
                grace_hours: PBC_REMINDER_GRACE_HOURS,
                recipients: [
                  {
                    role: "mission_manager",
                    name: managerName,
                    email: null,
                    resolution: "TO_RESOLVE_FROM_TEAM_DIRECTORY"
                  },
                  {
                    role: "client_site_responsible",
                    name: clientResponsibleName,
                    email: null,
                    resolution: "TO_RESOLVE_FROM_MISSION_CONTACTS"
                  }
                ],
                pbc_item: item
              }
            });
            queued.push({ reference: item.reference, ...result });
          }
        }

        return {
          inspected: true,
          checklist: { file_id: meta.id, name: meta.name, url: meta.webViewLink },
          rule: `Applicable PBC item still missing ${PBC_REMINDER_GRACE_HOURS}h after the end of its expected date.`,
          evaluated_at: now.toISOString(),
          overdue_count: overdue.length,
          overdue,
          unparseable_deadlines: unparseableDeadlines,
          recipients_to_resolve: {
            mission_manager: managerName,
            client_site_responsible: clientResponsibleName
          },
          actions_requested: Boolean(input.create_actions),
          actions: queued,
          email_sent: false,
          note: "No email was sent. Reminder actions remain pending for the future email dispatcher."
        };
      }
    })
  });

  // -------------------------------------------------------------------------
  // Programme -> workstreams -> work products (Mission Controller, phase 2)
  // -------------------------------------------------------------------------

  const prepareSopPbcPlan = tool({
    name: "prepare_sop_pbc_plan",
    description: "Read-only draft: verify programme control -> cycle SOP -> objectives, risks, assertions -> PBC source chain. Read the programme and SOPs first, then provide exact excerpts. Returns deduplicated proposed requests and a manager approval email draft. Never writes a checklist or sends email. Unsupported/truncated/unvalidated sources block planning.",
    parameters: z.object({
      programme_file_id: z.string().min(1),
      programme_validated_confirmed: z.boolean(),
      sops: z.array(z.object({ file_id: z.string().min(1), cycle: z.string().min(1) })).min(1).max(30),
      controls: z.array(z.object({
        name: z.string().min(1), cycle: z.string().min(1),
        programme_excerpt: z.string().min(12), sop_file_id: z.string().min(1),
        sop_excerpt: z.string().min(12), objective_excerpt: z.string().min(12),
        risk_excerpt: z.string().min(12), assertion_excerpt: z.string().min(12),
        documents: z.array(z.object({ name: z.string().min(1), sop_excerpt: z.string().min(12), completeness_criteria: z.string().min(1), after_selection: z.boolean() })).max(30)
      })).min(1).max(60),
      manager: z.string().nullable(), client_recipient: z.string().nullable()
    }),
    execute: async input => {
      const meta = await getDriveFileMetadata(input.programme_file_id);
      const read = await readDriveFileText(meta.id, { maxChars: MISSION_DOCUMENT_MAX_CHARS });
      const state = checkProgrammeState({ meta, read, validatedConfirmed: input.programme_validated_confirmed });
      if (!state.ok) return { status: state.status, reasons: state.reasons, remote_writes: 0 };
      const sops = [];
      for (const source of input.sops) {
        const readSop = await readDriveFileText(source.file_id, { maxChars: MISSION_DOCUMENT_MAX_CHARS });
        sops.push({ ...readSop, ...source });
      }
      return planPbcFromSops({ programmeText: read.text, sops, controls: input.controls, manager: input.manager, clientRecipient: input.client_recipient });
    }
  });

  const loadPbcItemTool = tool({
    name: "load_pbc_item",
    description:
      "Load one PBC request line (by reference, e.g. PBC-012) from a mission PBC checklist with its labelled columns, lifecycle state and mission parameters (client, period, mission reference) so you can compare candidate evidence against the request.",
    parameters: z.object({
      spreadsheet_file_id: z.string().min(1),
      pbc_reference: z.string().min(3)
    }),
    execute: instrument({
      ...ctx,
      toolName: "load_pbc_item",
      execute: async input => {
        const item = await loadPbcItem(driveAdapter, input.spreadsheet_file_id, input.pbc_reference);
        if (!item.found) return { found: false, pbc_reference: input.pbc_reference };
        const params = await getSheetValues(input.spreadsheet_file_id, "PARAMETRES!A1:D80");
        return {
          ...item,
          lifecycle_state: pbcLifecycleState(item.values, pbcColumnsFromHeader(item.header) || undefined),
          mission_parameters: {
            client: parameterValue(params, "Client"),
            exercise: parameterValue(params, "Exercice audité"),
            close_date: parameterValue(params, "Date de clôture"),
            mission_reference: parameterValue(params, "Référence mission"),
            programme: parameterValue(params, "Programme de travail validé (réf. / date)")
          }
        };
      }
    })
  });

  const recordPbcEvaluation = tool({
    name: "record_pbc_evidence_evaluation",
    description:
      "Record YOUR evaluation of a received document against one PBC request. Preconditions enforced for every evidence-based state (RECEIVED, PARTIAL, NON_CONFORME, VERIFIED): the evidence exists, is unchanged since your read, and a fresh read matches your content_fingerprint (from read_drive_document). RECEIVED also needs document_nature MATCH and no MISMATCH on client/mission/scope/period; VERIFIED needs a complete read and MATCH on client, period, completeness and document nature with no failed check. Otherwise the state recorded is REVIEW (EXTRACTOR_REQUIRED when unreadable). Checklist: writes only the manual columns Reçu ? / Date réception / Complet ? / Lien Drive / Commentaire (never Statut automatique, Applicable, Ouvrir or other formulas). NON_CONFORME has no native column: comment + journal, CHECKLIST_STATUS_LIMITATION. Always journals.",
    parameters: z.object({
      spreadsheet_file_id: z.string().min(1),
      pbc_reference: z.string().min(3),
      mission_id: z.string().nullable().optional(),
      programme_file_id: z.string().nullable().optional(),
      evidence_file_id: z.string().min(1),
      evidence_modified_time: z.string().min(1),
      content_fingerprint: z.string().nullable().optional(),
      received_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      read_max_chars: z.number().int().min(1000).max(60000).nullable().optional(),
      proposed_state: z.enum(PBC_STATES),
      checks: z.object(Object.fromEntries(
        EVIDENCE_CHECK_KEYS.map(key => [key, z.enum(CHECK_VALUES)])
      )),
      rationale: z.string().min(3).max(1500),
      write_to_checklist: z.boolean()
    }),
    execute: instrument({
      ...ctx,
      toolName: "record_pbc_evidence_evaluation",
      execute: async input => {
        const item = await loadPbcItem(driveAdapter, input.spreadsheet_file_id, input.pbc_reference);
        if (!item.found) {
          return { recorded: false, status: "PBC_REFERENCE_NOT_FOUND", pbc_reference: input.pbc_reference };
        }

        const evidenceMeta = await getDriveFileMetadata(input.evidence_file_id).catch(() => null);
        const needsRead = ["PARTIAL", "NON_CONFORME", "VERIFIED"].includes(input.proposed_state);
        const read = needsRead && evidenceMeta
          ? await readDriveFileText(input.evidence_file_id, {
              maxChars: input.read_max_chars || 60000
            }).catch(error => ({ supported: false, reason: error.message }))
          : null;

        const decision = decidePbcEvaluation({
          proposed: input.proposed_state,
          checks: input.checks,
          rationale: input.rationale,
          evidenceMeta,
          analysedModifiedTime: input.evidence_modified_time,
          analysedFingerprint: input.content_fingerprint || null,
          read
        });

        const record = {
          kind: "PBC_EVIDENCE_EVALUATION",
          checklist_file_id: input.spreadsheet_file_id,
          pbc_reference: input.pbc_reference,
          row_number: item.row_number,
          mission_id: input.mission_id || null,
          programme_file_id: input.programme_file_id || null,
          evidence_file_id: input.evidence_file_id,
          evidence_name: evidenceMeta?.name || null,
          evidence_url: evidenceMeta?.webViewLink || null,
          evidence_modified_time: evidenceMeta?.modifiedTime || null,
          content_fingerprint: input.content_fingerprint || null,
          content_read: Boolean(read?.supported),
          extractor: read?.extractor || null,
          proposed_state: input.proposed_state,
          final_state: decision.final_state,
          downgraded: decision.downgraded,
          downgrade_reasons: decision.reasons,
          checks: input.checks,
          rationale: input.rationale,
          received_date: input.received_date || null,
          evaluated_at: new Date().toISOString()
        };

        let sheet = { status: "NOT_REQUESTED" };
        if (input.write_to_checklist) {
          const gate = await mappingGate();
          sheet = gate.allowed
            ? await writePbcEvaluation(driveAdapter, input.spreadsheet_file_id, item, record)
                .catch(error => ({ status: "SHEET_WRITE_REVIEW_REQUIRED", reason: error.message }))
            : { status: "MAPPING_REVIEW_REQUIRED", mapping_state: gate.state };
        }

        let followup = null;
        if (["PARTIAL", "NON_CONFORME", "REVIEW"].includes(decision.final_state)) {
          followup = await queueInternalAction(ctx, {
            missionId: input.mission_id || null,
            actionType: "pbc_evidence_followup",
            summary:
              `PBC ${input.pbc_reference}: pièce ${evidenceMeta?.name || input.evidence_file_id} évaluée ${decision.final_state}${decision.reasons.length ? ` (${decision.reasons.join(", ")})` : ""}.`.slice(0, 500),
            idempotencyParts: [
              "pbc-evaluation",
              input.spreadsheet_file_id,
              input.pbc_reference,
              input.evidence_file_id,
              evidenceMeta?.modifiedTime || "",
              decision.final_state
            ],
            evidence: {
              pbc_reference: input.pbc_reference,
              evidence_file_id: input.evidence_file_id,
              final_state: decision.final_state
            },
            payload: { evaluation: record }
          });
        }

        return {
          recorded: true,
          final_state: decision.final_state,
          downgraded: decision.downgraded,
          downgrade_reasons: decision.reasons,
          checklist_write: sheet,
          followup,
          journal_record: record
        };
      }
    })
  });

  return {
    createOrUpdatePbcChecklist,
    inspectPbcChecklist,
    detectOverduePbcReminders,
    prepareSopPbcPlan,
    loadPbcItemTool,
    recordPbcEvaluation
  };
}
