import { instrument } from "./agent-tool-instrument.js";
import { MISSION_DOCUMENT_MAX_CHARS } from "./document-reading.js";
import { tool } from "@openai/agents";
import { z } from "zod";
import {
  getDriveFileMetadata,
  getSheetValues,
  masterSheetId,
  readDriveFileText,
  syncFolderFromTemplate,
  upsertSheetRow
} from "./google-drive.js";
import {
  LIBRARY_STATUS,
  MISSION_TYPE_KEYS,
  buildRequiredWorkingPapers,
  checkProgrammeState,
  classifyTemplateCandidate,
  TEMPLATE_READ_CHARS,
  contentFingerprint,
  discoverTemplateLibraries,
  indexTemplateLibrary,
  programmeFingerprint,
  programmeNameLooksDraft
} from "./mission-engine.js";
import { rest } from "./supabase.js";
import { driveAdapter } from "./drive-adapter.js";
import {
  gateBlockedResult,
  mappingGate,
  resolveRoleViaMap
} from "./memory-runtime.js";
import {
  configuredTemplateLibraryId,
  evidencePairsToObject,
  queueInternalAction
} from "./agent-tool-helpers.js";

// Tools of the operational catalog (7), extracted from agent-tools.js (audit 2026-10-29).
export function missionTools(ctx) {
  const { orgId } = ctx;

  const initializeMission = tool({
    name: "initialize_mission_from_template",
    description:
      "Create the mission folder SKELETON (folder tree only) from an approved Drive structure template after evidence shows the mission has started, then register/update that mission in the Drive Missions register. No file is copied: work products/Working Papers are created only by build_required_working_papers from the validated programme. Idempotent: existing folders are preserved, nothing is overwritten or deleted.",
    parameters: z.object({
      mission_id: z.string().min(1),
      client: z.string().min(1),
      objet: z.string().min(1),
      mission_type: z.string().min(1),
      date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      date_fin_prevue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      partner: z.string().nullable().optional(),
      manager: z.string().nullable().optional(),
      equipe: z.string().nullable().optional(),
      template_folder_id: z.string().min(1),
      destination_parent_id: z.string().min(1),
      destination_name: z.string().min(3),
      started_evidence_file_id: z.string().min(1),
      started_evidence_reason: z.string().min(3)
    }),
    execute: instrument({
      ...ctx,
      toolName: "initialize_mission_from_template",
      execute: async input => {
        const evidence = await getDriveFileMetadata(
          input.started_evidence_file_id
        );
        const gate = await mappingGate();
        if (!gate.allowed) return gateBlockedResult(gate);

        // Skeleton only: copying every template file would bypass the
        // programme -> required work products rule.
        const result = await syncFolderFromTemplate({
          templateFolderId: input.template_folder_id,
          destinationParentId: input.destination_parent_id,
          destinationName: input.destination_name,
          foldersOnly: true
        });

        const missionRows = await getSheetValues(
          masterSheetId(),
          "Missions!A1:W3000"
        );
        const existing = missionRows
          .slice(1)
          .find(row => String(row?.[0] || "") === input.mission_id) || [];
        const keep = (index, fallback = "") =>
          String(existing[index] ?? "").trim() || fallback;

        const missionRow = [
          input.mission_id,
          input.client,
          input.objet,
          input.mission_type,
          input.date_debut,
          input.date_fin_prevue || keep(5),
          keep(6),
          input.partner || keep(7),
          input.manager || keep(8),
          input.equipe || keep(9),
          keep(10, "INITIALISEE_PLANIFICATION_ATTENDUE"),
          keep(11, "0"),
          keep(12),
          keep(13),
          keep(14),
          keep(15),
          result.root.webViewLink || keep(16),
          keep(17),
          new Date().toISOString(),
          keep(19),
          keep(20),
          keep(21),
          keep(22)
        ];

        const registry = await upsertSheetRow({
          spreadsheetId: masterSheetId(),
          sheetName: "Missions",
          key: input.mission_id,
          rowValues: missionRow
        });

        return {
          initialized: true,
          evidence: {
            file_id: evidence.id,
            name: evidence.name,
            url: evidence.webViewLink,
            reason: input.started_evidence_reason
          },
          mission_register: registry,
          mission_folder: result.root,
          mode: "SKELETON_FOLDERS_ONLY",
          template_sync: result,
          note:
            "Template files were not copied. Create the required work products with build_required_working_papers from the validated programme."
        };
      }
    })
  });

  const createFollowup = tool({
    name: "create_internal_followup",
    description:
      "Create an internal follow-up/action in the controlled queue for a missing work item, PBC, review, deadline, staffing issue or global alert. This does not send an email by itself.",
    parameters: z.object({
      mission_id: z.string().nullable().optional(),
      assigned_staff_profile_id: z.string().nullable().optional(),
      action_type: z.string().min(2),
      summary: z.string().min(3).max(500),
      due_at: z.string().nullable().optional(),
      // Strict structured tools reject free-form objects (z.record / z.any).
      // Evidence keeps its meaning (a key -> value evidence record) but is
      // passed as a list of key/value pairs and rebuilt into an object.
      evidence: z.array(z.object({
        key: z.string().min(1),
        value: z.string()
      })).max(50).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "create_internal_followup",
      execute: async input => {
        const result = await queueInternalAction(ctx, {
          missionId: input.mission_id || null,
          assignedStaffProfileId: input.assigned_staff_profile_id || null,
          actionType: input.action_type,
          summary: input.summary,
          dueAt: input.due_at || null,
          evidence: evidencePairsToObject(input.evidence),
          payload: {}
        });
        return result;
      }
    })
  });

  const listOpenInternalActions = tool({
    name: "list_open_internal_actions",
    description:
      "List open (not yet verified) internal actions and alerts across all missions and agents from the controlled action queue. Read-only global alert view.",
    parameters: z.object({
      mission_id: z.string().nullable().optional(),
      action_type: z.string().nullable().optional(),
      limit: z.number().int().min(1).max(200).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "list_open_internal_actions",
      execute: async ({ mission_id, action_type, limit }) => {
        const filters = [
          `org_id=eq.${encodeURIComponent(orgId)}`,
          "work_state=neq.verified",
          "action_type=neq.PEOPLE_INTELLIGENCE_RECOMMENDATION"
        ];
        if (mission_id) {
          filters.push(`office_mission_id=eq.${encodeURIComponent(mission_id)}`);
        }
        if (action_type) {
          filters.push(`action_type=eq.${encodeURIComponent(action_type)}`);
        }
        const rows = await rest(
          `office_action_queue?${filters.join("&")}&select=id,agent_key,office_mission_id,assigned_staff_profile_id,action_type,summary,status,work_state,due_at,requested_at,created_at,payload&order=created_at.desc&limit=${limit || 100}`
        );
        return { open_actions: rows };
      }
    })
  });

  const analyzeWorkProgramme = tool({
    name: "analyze_work_programme",
    description:
      "Locate-and-read step for a mission work programme / work plan: returns its metadata, validation state, extracted text and a programme_fingerprint. YOU (the agent) then read the text and identify cycles/workstreams, procedures, responsible people, reviewers, dates, deliverables, WP references and explicit PBC needs. Pass programme_fingerprint and programme_modified_at to build_required_working_papers so execution is blocked if the programme changes after your analysis.",
    parameters: z.object({
      programme_file_id: z.string().min(1),
      validated_confirmed: z.boolean(),
      validation_evidence: z.string().nullable().optional(),
      max_chars: z.number().int().min(1000).max(MISSION_DOCUMENT_MAX_CHARS).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "analyze_work_programme",
      execute: async input => {
        const meta = await getDriveFileMetadata(input.programme_file_id);
        const read = meta.mimeType === "application/vnd.google-apps.folder"
          ? { supported: false, reason: "Folder, not a programme file." }
          : await readDriveFileText(input.programme_file_id, {
              maxChars: input.max_chars || MISSION_DOCUMENT_MAX_CHARS
            });
        const state = checkProgrammeState({
          meta,
          read,
          validatedConfirmed: input.validated_confirmed
        });
        return {
          programme: {
            file_id: meta.id,
            name: meta.name,
            url: meta.webViewLink || null,
            mime_type: meta.mimeType,
            modified_at: meta.modifiedTime
          },
          state: state.status,
          state_reasons: state.reasons,
          validation_evidence: input.validation_evidence || null,
          name_looks_draft: programmeNameLooksDraft(meta.name),
          extractor: read.extractor || null,
          read_status: read.supported ? "READ" : "EXTRACTOR_REQUIRED",
          truncated: Boolean(read.truncated),
          programme_fingerprint: read.supported
            ? programmeFingerprint(meta, read.text)
            : null,
          text: read.supported ? read.text : null,
          expected_analysis_output: {
            requirement_fields: [
              "cycle", "workstream", "procedure", "required_wp_type",
              "wp_code", "template_reference", "preparer", "reviewer",
              "planned_start", "planned_end",
              "source_evidence.excerpt (verbatim quote of the programme)",
              "source_evidence.location"
            ],
            rule:
              "One requirement per work product the programme actually requires. Quote the programme verbatim in source_evidence.excerpt (>= 12 characters); unquoted requirements are refused."
          }
        };
      }
    })
  });

  const discoverTemplateLibrariesTool = tool({
    name: "discover_wp_template_libraries",
    description:
      "Resolve the folder playing the role WORKING_PAPER_TEMPLATE_LIBRARY. First checks OFFICE_MANAGER_MAP: an active owner-signed rule returns OWNER_APPROVED_MAP; concurrent rules return REVIEW_REQUIRED. Otherwise discovers candidates in the authorised Drive (CONFIGURED, SINGLE_CANDIDATE, AMBIGUOUS or NONE). When AMBIGUOUS/NONE, nothing may be copied: optionally queue a validation action.",
    parameters: z.object({
      create_validation_action: z.boolean(),
      mission_id: z.string().nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "discover_wp_template_libraries",
      execute: async input => {
        // Owner memory first: an active signed owner rule wins, concurrent
        // rules require review, otherwise normal discovery.
        const mapResolution = await resolveRoleViaMap("WORKING_PAPER_TEMPLATE_LIBRARY");
        if (mapResolution.status === "OWNER_APPROVED") {
          return {
            status: "OWNER_APPROVED_MAP",
            selected: { id: mapResolution.target_file_id, name: mapResolution.targets[0]?.name || null, path: mapResolution.targets[0]?.path || null },
            usable_basis: "OWNER_APPROVED_MAP",
            map_resolution: mapResolution
          };
        }
        if (mapResolution.status === "REVIEW_REQUIRED") {
          return { status: "REVIEW_REQUIRED", usable_basis: null, map_resolution: mapResolution };
        }
        const discovery = await discoverTemplateLibraries(driveAdapter, {
          configuredFolderId: configuredTemplateLibraryId()
        });
        let validationAction = null;
        if (
          input.create_validation_action &&
          [LIBRARY_STATUS.AMBIGUOUS, LIBRARY_STATUS.NONE].includes(discovery.status)
        ) {
          validationAction = await queueInternalAction(ctx, {
            missionId: input.mission_id || null,
            actionType: "wp_template_library_validation",
            summary:
              `Valider la bibliothèque canonique de modèles de work products (${discovery.status}, ${discovery.candidates.length} candidat(s)).`,
            idempotencyParts: [
              "wp-library-validation",
              discovery.status,
              ...discovery.candidates.map(c => c.folder.id).sort()
            ],
            evidence: { status: discovery.status },
            payload: {
              candidates: discovery.candidates.slice(0, 10).map(c => ({
                folder_id: c.folder.id,
                name: c.folder.name,
                url: c.folder.webViewLink,
                score: c.score,
                stats: c.stats
              }))
            }
          });
        }
        return {
          ...discovery,
          usable_basis:
            discovery.status === LIBRARY_STATUS.CONFIGURED
              ? "CONFIGURED"
              : discovery.status === LIBRARY_STATUS.SINGLE_CANDIDATE
                ? "SINGLE_CANDIDATE"
                : null,
          validation_action: validationAction,
          map_resolution: mapResolution,
          rule:
            "Copy nothing unless the basis is CONFIGURED, OWNER_APPROVED_MAP or SINGLE_CANDIDATE. AMBIGUOUS is a safe result: ask Orpailleur to propose the role in MAP so the owner can approve it (signed rule)."
        };
      }
    })
  });

  const inspectTemplateCandidates = tool({
    name: "inspect_wp_template_candidates",
    description:
      "Inventory a template library and classify each file (TEMPLATE_LIKELY, COMPLETED_WP_SUSPECTED, SUPPORTING_DOCUMENT, UNSUPPORTED_TYPE) from metadata, folder path and content. With include_content_excerpts, returns for the first 10 eligible files a content excerpt, template_modified_at and content_fingerprint. YOU choose the template by reading its content; then pass template_file_id, template_modified_at and template_content_fingerprint to build_required_working_papers. Read-only.",
    parameters: z.object({
      template_library_folder_id: z.string().min(1),
      name_filter: z.string().nullable().optional(),
      client: z.string().nullable().optional(),
      include_content_excerpts: z.boolean(),
      limit: z.number().int().min(1).max(60).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "inspect_wp_template_candidates",
      execute: async input => {
        const index = await indexTemplateLibrary(
          driveAdapter,
          input.template_library_folder_id,
          { clientName: input.client || null }
        );
        const filterTokens = String(input.name_filter || "")
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean);
        let entries = index.files.filter(entry => {
          if (!filterTokens.length) return true;
          const hay = `${entry.file.name} ${entry.path.join(" ")}`.toLowerCase();
          return filterTokens.some(token => hay.includes(token));
        });
        entries = entries.slice(0, input.limit || 30);

        const out = [];
        for (const [i, entry] of entries.entries()) {
          const item = {
            file_id: entry.file.id,
            name: entry.file.name,
            mime_type: entry.file.mimeType,
            template_modified_at: entry.file.modifiedTime || null,
            content_fingerprint: null,
            path: entry.path.join(" / "),
            classification: entry.classification,
            eligible: entry.eligible,
            reasons: entry.reasons
          };
          if (input.include_content_excerpts && i < 10 && entry.eligible) {
            const read = await readDriveFileText(entry.file.id, {
              maxChars: TEMPLATE_READ_CHARS
            }).catch(error => ({ supported: false, reason: error.message }));
            if (read.supported) {
              // Pass template_modified_at + content_fingerprint unchanged to
              // build_required_working_papers: it re-verifies them before copy.
              item.template_modified_at = read.file?.modifiedTime || item.template_modified_at;
              item.content_fingerprint = contentFingerprint(read.file || entry.file, read.text);
              item.content_truncated = Boolean(read.truncated);
              const verdict = classifyTemplateCandidate({
                file: entry.file,
                pathNames: entry.path,
                excerpt: read.text,
                clientName: input.client || null
              });
              item.content_excerpt = read.text.slice(0, 1500);
              item.classification = verdict.classification;
              item.eligible = verdict.eligible;
              item.reasons = verdict.reasons;
            } else {
              item.content_excerpt = null;
              item.content_status = "EXTRACTOR_REQUIRED";
            }
          }
          out.push(item);
        }
        return {
          library_folder_id: input.template_library_folder_id,
          total_files_indexed: index.files.length,
          inventory_truncated: index.truncated,
          candidates: out
        };
      }
    })
  });

  const buildWorkingPapers = tool({
    name: "build_required_working_papers",
    description:
      "Create ONLY the work products (Working Papers / work files) required by the validated programme. Each requirement must quote the programme verbatim; the tool re-reads the programme and blocks if it changed or is truncated. The library basis must be CONFIGURED, OWNER_APPROVED_MAP (verified against an active owner-signed rule in OFFICE_MANAGER_MAP) or SINGLE_CANDIDATE. Real creation (dry_run=false) also requires the Drive mapping to be owner-reviewed (MAPPING_REVIEWED). YOU choose each template: give template_file_id + template_modified_at + template_content_fingerprint from inspect_wp_template_candidates; without them the item is REVIEW_REQUIRED with suggestions (nothing is auto-selected). The tool re-reads the template and refuses it if changed, unreadable, outside the library or looking like a completed client file. Idempotent, never overwrites, never deletes. Per item: CREATED, ALREADY_EXISTS, REVIEW_REQUIRED, TEMPLATE_NOT_FOUND, FAILED (PLANNED in dry_run). Run with dry_run=true first.",
    parameters: z.object({
      mission_id: z.string().nullable().optional(),
      mission_type: z.enum(MISSION_TYPE_KEYS),
      mission_reference: z.string().min(2),
      mission_name: z.string().nullable().optional(),
      client: z.string().min(1),
      period: z.string().nullable().optional(),
      programme_file_id: z.string().min(1),
      programme_modified_at: z.string().min(1),
      programme_fingerprint: z.string().min(16),
      programme_validated_confirmed: z.boolean(),
      template_library_folder_id: z.string().min(1),
      library_basis: z.enum(["CONFIGURED", "OWNER_APPROVED_MAP", "SINGLE_CANDIDATE"]),
      mission_root_folder_id: z.string().min(1),
      destination_folder_id: z.string().min(1),
      dry_run: z.boolean(),
      prefill_headers: z.boolean(),
      prefill_prepared_date: z.boolean(),
      requirements: z.array(z.object({
        cycle: z.string().nullable().optional(),
        workstream: z.string().nullable().optional(),
        procedure: z.string().min(3),
        required_wp_type: z.string().min(2),
        wp_code: z.string().nullable().optional(),
        template_reference: z.string().nullable().optional(),
        template_file_id: z.string().nullable().optional(),
        template_modified_at: z.string().nullable().optional(),
        template_content_fingerprint: z.string().nullable().optional(),
        target_name: z.string().nullable().optional(),
        preparer: z.string().nullable().optional(),
        reviewer: z.string().nullable().optional(),
        planned_start: z.string().nullable().optional(),
        planned_end: z.string().nullable().optional(),
        source_evidence: z.object({
          excerpt: z.string().min(12),
          location: z.string().nullable().optional()
        })
      })).min(1).max(60)
    }),
    execute: instrument({
      ...ctx,
      toolName: "build_required_working_papers",
      execute: async input => {
        if (!input.dry_run) {
          const gate = await mappingGate();
          if (!gate.allowed) return gateBlockedResult(gate);
        }
        const result = await buildRequiredWorkingPapers(driveAdapter, input, {
          configuredLibraryId: configuredTemplateLibraryId(),
          resolveRole: role => resolveRoleViaMap(role)
        });
        return {
          ...result,
          journal_record: {
            kind: "WORK_PRODUCTS_BUILD",
            mission_id: input.mission_id || null,
            mission_reference: input.mission_reference,
            programme: result.programme,
            library: result.library,
            dry_run: Boolean(input.dry_run),
            status: result.status,
            items: (result.work_products || []).map(item => ({
              requirement_id: item.requirement_id,
              status: item.status,
              reason: item.reason || null,
              template_file_id: item.template?.file_id || null,
              file_id: item.file?.file_id || null,
              source_excerpt: item.source_evidence?.excerpt?.slice(0, 200) || null
            }))
          }
        };
      }
    })
  });

  // -------------------------------------------------------------------------
  // PBC evidence control (AI judges, the tool checks and records)
  // -------------------------------------------------------------------------

  return {
    initializeMission,
    createFollowup,
    listOpenInternalActions,
    analyzeWorkProgramme,
    discoverTemplateLibrariesTool,
    inspectTemplateCandidates,
    buildWorkingPapers
  };
}
