import { instrument } from "./agent-tool-instrument.js";
import { createHash } from "node:crypto";
import { tool } from "@openai/agents";
import { z } from "zod";
import {
  appendSheetValues,
  getDriveFileMetadata,
  getSheetValues,
  googleConnectionConfigured,
  masterSheetId,
  searchDriveFiles,
  upsertSheetRow
} from "./google-drive.js";
import { rest } from "./supabase.js";
import {
  defaultMissionControlRegistryId,
  staffCache,
  buildCalendar,
  writeCapacityCalendar,
  normalizeText,
  nonEmptyRows,
  parseNumber,
  percent,
  normalizedStatus
} from "./agent-tool-helpers.js";

// Tools of the operational catalog (8), extracted from agent-tools.js (audit 2026-10-29).
export function planningTools(ctx) {
  const { orgId } = ctx;

  const getTeamDirectory = tool({
    name: "get_team_directory",
    description:
      "Read the cabinet team directory source from Drive/master data and the last technical cache. Use at every global passage before resolving responsible people or email addresses.",
    parameters: z.object({
      name_filter: z.string().nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "get_team_directory",
      execute: async ({ name_filter }) => {
        const cache = await staffCache(orgId);
        const needle = String(name_filter || "").toLowerCase();
        const filteredCache = needle
          ? cache.filter(item =>
              String(item.full_name || "").toLowerCase().includes(needle)
            )
          : cache;

        if (!googleConnectionConfigured()) {
          return {
            drive_connected: false,
            drive_master_data_rows: [],
            technical_cache: filteredCache,
            directory_candidates: [],
            warning:
              "Google Drive is not configured in the Vercel runtime yet. Returning the technical cache only; do not treat it as fresher than Drive."
          };
        }

        const sheetRows = await getSheetValues(
          masterSheetId(),
          "Collaborateurs!A1:T1000"
        );
        const candidates = sheetRows.length > 1
          ? []
          : await searchDriveFiles({ query: "annuaire", limit: 20 });

        return {
          drive_connected: true,
          drive_master_data_rows: sheetRows,
          technical_cache: filteredCache,
          directory_candidates: candidates,
          warning:
            sheetRows.length <= 1
              ? "Collaborateurs tab currently has no staff rows. Configure the firm's team directory file when it is identified; cache must not override Drive."
              : null
        };
      }
    })
  });

  const readMasterSheet = tool({
    name: "read_master_sheet",
    description:
      "Read one authorised tab/range from the organisation's master-data workbook (its Drive operational register), when the firm has one. Use this rather than inventing mission/planning/KPI state.",
    parameters: z.object({
      tab: z.enum([
        "Collaborateurs",
        "Opportunites",
        "Missions",
        "Planning",
        "Clients",
        "Facturation",
        "Relances",
        "Calendrier_Capacite",
        "KPI_Historique",
        "Dossiers_Opportunites",
        "Bibliotheque_Modeles"
      ]),
      range: z.string().nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "read_master_sheet",
      execute: async ({ tab, range }) => {
        const safeRange = range && /^[A-Z]{1,2}\d+:[A-Z]{1,2}\d+$/.test(range)
          ? range
          : "A1:Z2000";
        const rows = await getSheetValues(
          masterSheetId(),
          `${tab}!${safeRange}`
        );
        return { tab, range: safeRange, rows };
      }
    })
  });

  const getMissionControls = tool({
    name: "get_mission_controls",
    description:
      "Read structured mission controls, standards, expected evidence and open control status from Supabase technical memory for a specific mission.",
    parameters: z.object({
      mission_id: z.string().min(1)
    }),
    execute: instrument({
      ...ctx,
      toolName: "get_mission_controls",
      execute: async ({ mission_id }) => {
        const rows = await rest(
          `office_mission_controls?org_id=eq.${encodeURIComponent(orgId)}&office_mission_id=eq.${encodeURIComponent(mission_id)}&select=id,control_code,control_area,title,standard_reference,work_program_reference,expected_evidence,accountable_staff_profile_id,due_at,status,evidence,rationale,last_checked_at&order=due_at.asc&limit=200`
        );
        return { controls: rows };
      }
    })
  });

  const upsertPlanningAssignment = tool({
    name: "upsert_confirmed_planning_assignment",
    description:
      "Write or update one assignment in the Drive Planning register ONLY when that assignment is explicitly supported by a validated work programme/plan. Never use this tool for an AI-only staffing suggestion.",
    parameters: z.object({
      id_affectation: z.string().nullable().optional(),
      collaborateur: z.string().min(1),
      mission: z.string().min(1),
      client: z.string().min(1),
      cycle_workstream: z.string().min(1),
      date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      charge_pct: z.number().min(0).max(100),
      role_mission: z.string().min(1),
      reviewer: z.string().nullable().optional(),
      source_plan_url: z.string().min(1),
      source_plan_file_id: z.string().min(1),
      source_plan_modified_at: z.string().nullable().optional(),
      source_confirmed: z.boolean()
    }),
    execute: instrument({
      ...ctx,
      toolName: "upsert_confirmed_planning_assignment",
      execute: async input => {
        if (!input.source_confirmed) {
          return {
            written: false,
            status: "VALIDATION_REQUIRED",
            reason:
              "Only assignments explicitly stated in a validated work programme may be synchronized automatically."
          };
        }

        const key = input.id_affectation ||
          `SRC-${createHash("sha256")
            .update([
              input.collaborateur,
              input.mission,
              input.cycle_workstream,
              input.date_debut,
              input.date_fin,
              input.source_plan_file_id
            ].join("|"))
            .digest("hex")
            .slice(0, 18)}`;

        const row = [
          key,
          input.collaborateur,
          input.mission,
          input.date_debut,
          input.date_fin,
          input.charge_pct,
          input.role_mission,
          "SOURCE_CONFIRMEE",
          input.client,
          input.cycle_workstream,
          input.reviewer || "",
          input.source_plan_url,
          input.source_plan_file_id,
          input.source_plan_modified_at || "",
          "",
          ""
        ];

        const result = await upsertSheetRow({
          spreadsheetId: masterSheetId(),
          sheetName: "Planning",
          key,
          rowValues: row
        });

        return { written: true, key, ...result };
      }
    })
  });

  const syncValidatedProgrammeAssignments = tool({
    name: "sync_validated_programme_assignments",
    description:
      "Synchronize multiple staff/cycle/workstream assignments explicitly stated in one validated work programme into the Drive Planning register, then recalculate capacity conflicts. Do not use for AI-inferred staffing suggestions.",
    parameters: z.object({
      source_plan_file_id: z.string().min(1),
      source_plan_url: z.string().nullable().optional(),
      source_confirmed: z.boolean(),
      mission: z.string().min(1),
      client: z.string().min(1),
      assignments: z.array(z.object({
        collaborateur: z.string().min(1),
        cycle_workstream: z.string().min(1),
        date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        charge_pct: z.number().min(0).max(100),
        role_mission: z.string().min(1),
        reviewer: z.string().nullable().optional()
      })).min(1).max(100)
    }),
    execute: instrument({
      ...ctx,
      toolName: "sync_validated_programme_assignments",
      execute: async input => {
        if (!input.source_confirmed) {
          return {
            written: false,
            status: "VALIDATED_PLAN_REQUIRED",
            reason:
              "Assignments can only be synchronized automatically when they are explicitly supported by a validated work programme."
          };
        }

        const plan = await getDriveFileMetadata(input.source_plan_file_id);
        const planName = String(plan.name || "");
        if (/a[_ -]?valider|draft|brouillon/i.test(planName)) {
          return {
            written: false,
            status: "VALIDATION_CONFLICT",
            reason:
              `The supplied programme '${planName}' still indicates a draft/to-be-validated version.`,
            programme: plan
          };
        }

        const results = [];
        for (const assignment of input.assignments) {
          const key = `SRC-${createHash("sha256")
            .update([
              assignment.collaborateur,
              input.mission,
              assignment.cycle_workstream,
              assignment.date_debut,
              assignment.date_fin,
              input.source_plan_file_id
            ].join("|"))
            .digest("hex")
            .slice(0, 18)}`;

          const row = [
            key,
            assignment.collaborateur,
            input.mission,
            assignment.date_debut,
            assignment.date_fin,
            assignment.charge_pct,
            assignment.role_mission,
            "SOURCE_CONFIRMEE",
            input.client,
            assignment.cycle_workstream,
            assignment.reviewer || "",
            input.source_plan_url || plan.webViewLink || "",
            input.source_plan_file_id,
            plan.modifiedTime || "",
            "",
            ""
          ];

          const result = await upsertSheetRow({
            spreadsheetId: masterSheetId(),
            sheetName: "Planning",
            key,
            rowValues: row
          });
          results.push({ key, ...result });
        }

        const calendar = await buildCalendar();
        const calendarRowsWritten = await writeCapacityCalendar(calendar);
        const missionRows = await getSheetValues(
          masterSheetId(),
          "Missions!A1:W3000"
        );
        const matchingMission = missionRows
          .slice(1)
          .find(row =>
            String(row?.[0] || "") === input.mission ||
            normalizeText(row?.[1]) === normalizeText(input.client)
          );
        if (matchingMission) {
          const missionId = String(matchingMission[0] || "");
          const row = [...matchingMission];
          while (row.length < 23) row.push("");
          row[17] = input.source_plan_url || plan.webViewLink || "";
          row[18] = new Date().toISOString();
          await upsertSheetRow({
            spreadsheetId: masterSheetId(),
            sheetName: "Missions",
            key: missionId,
            rowValues: row.slice(0, 23)
          });
        }

        return {
          written: true,
          programme: {
            file_id: plan.id,
            name: planName,
            url: plan.webViewLink,
            modified_at: plan.modifiedTime
          },
          assignments_written: results.length,
          calendar_rows_written: calendarRowsWritten,
          results,
          conflicts: calendar.filter(item => item.conflict),
          overloaded: calendar.filter(item => item.totalChargePct > 100)
        };
      }
    })
  });

  const refreshCapacityCalendar = tool({
    name: "refresh_capacity_calendar",
    description:
      "Recalculate the Drive capacity calendar from confirmed Planning rows, identify overlapping missions and total allocation, then rewrite the derived Calendrier_Capacite view. This does not change mission assignments.",
    parameters: z.object({
      window_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      window_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "refresh_capacity_calendar",
      execute: async ({ window_start, window_end }) => {
        const rows = await buildCalendar(window_start || null, window_end || null);
        const rowsWritten = await writeCapacityCalendar(rows);

        return {
          rows_written: rowsWritten,
          conflicts: rows.filter(item => item.conflict),
          overloaded: rows.filter(item => item.totalChargePct > 100)
        };
      }
    })
  });

  const findAvailableStaff = tool({
    name: "find_available_staff",
    description:
      "Find possible staff capacity for a proposed mission period. Returns candidates only; it never changes an assignment. Use CV/skills and human validation before proposing replacement staff.",
    parameters: z.object({
      date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      minimum_available_pct: z.number().min(0).max(100).nullable().optional(),
      role_hint: z.string().nullable().optional(),
      required_skill: z.string().nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "find_available_staff",
      execute: async input => {
        const planning = await buildCalendar(
          input.date_debut,
          input.date_fin
        );
        const staff = await staffCache(orgId);
        const min = input.minimum_available_pct ?? 20;
        const roleNeedle = String(input.role_hint || "").toLowerCase();
        const skillNeedle = String(input.required_skill || "").toLowerCase();

        const candidates = staff.map(person => {
          const assignments = planning.filter(
            item => item.collaborateur.toLowerCase() ===
              String(person.full_name || "").toLowerCase()
          );
          const maxCharge = assignments.length
            ? Math.max(...assignments.map(item => item.totalChargePct))
            : 0;
          const available = Math.max(0, 100 - maxCharge);
          return {
            ...person,
            current_missions: [...new Set(assignments.map(x => x.mission))],
            available_pct: available
          };
        }).filter(person => {
          if (person.available_pct < min) return false;
          if (roleNeedle &&
            !`${person.role_title || ""} ${person.grade_title || ""}`
              .toLowerCase()
              .includes(roleNeedle)) return false;
          if (skillNeedle &&
            !(person.skills || []).some(skill =>
              String(skill).toLowerCase().includes(skillNeedle)
            )) return false;
          return true;
        });

        return {
          candidates,
          warning:
            "Availability is a planning aid. Final assignment requires human validation and should be confirmed in the validated work programme."
        };
      }
    })
  });

  const refreshKpiSnapshot = tool({
    name: "refresh_kpi_snapshot",
    description:
      "Calculate cabinet operational KPI from the Drive registers and append one evidence-based snapshot to KPI_Historique. Unknown/unprovable KPI stay blank rather than being invented as zero.",
    parameters: z.object({
      period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "refresh_kpi_snapshot",
      execute: async ({ period_start, period_end }) => {
        const [oppRows, missionRows, calendarRows, pbcRows, wpRows, openActions] =
          await Promise.all([
            getSheetValues(masterSheetId(), "Opportunites!A1:W3000"),
            getSheetValues(masterSheetId(), "Missions!A1:W3000"),
            getSheetValues(masterSheetId(), "Calendrier_Capacite!A1:R3000"),
            getSheetValues(defaultMissionControlRegistryId(), "PBC_Status!A1:O5000"),
            getSheetValues(defaultMissionControlRegistryId(), "WP_Status!A1:N5000"),
            rest(
              `office_action_queue?org_id=eq.${encodeURIComponent(orgId)}&work_state=neq.verified&select=id&limit=1000`
            )
          ]);

        const opportunities = nonEmptyRows(oppRows);
        const missions = nonEmptyRows(missionRows);
        const calendar = nonEmptyRows(calendarRows);
        const pbc = nonEmptyRows(pbcRows);
        const wp = nonEmptyRows(wpRows);

        const opportunitiesEmail = opportunities.filter(row =>
          String(row?.[18] || "").trim() ||
          String(row?.[19] || "").trim() ||
          [row?.[1], row?.[20]].some(v =>
            normalizeText(v).includes("email")
          )
        ).length;

        const submitted = opportunities.filter(row =>
          String(row?.[15] || "").trim()
        ).length;

        const won = opportunities.filter(row => {
          const result = normalizedStatus(row?.[16]);
          const acceptanceDate = String(row?.[21] || "").trim();
          return Boolean(acceptanceDate) || [
            "gagne", "gagnee", "accepte", "acceptee", "won", "accepted"
          ].includes(result);
        }).length;

        const activeMissionStatuses = new Set([
          "active", "actif", "en_cours", "initialisee", "initialise",
          "planification", "execution", "en_revue", "review"
        ]);
        const activeMissions = missions.filter(row =>
          activeMissionStatuses.has(normalizedStatus(row?.[10]))
        );

        const nowDate = new Date().toISOString().slice(0, 10);
        const lateMissions = activeMissions.filter(row => {
          const lateDays = parseNumber(row?.[19]);
          if (lateDays !== null && lateDays > 0) return true;
          const plannedEnd = String(row?.[5] || "").slice(0, 10);
          return Boolean(plannedEnd && plannedEnd < nowDate);
        });

        const pbcWithEvidence = pbc.filter(row =>
          String(row?.[8] || "").trim() || String(row?.[9] || "").trim()
        );
        const pbcConform = pbcWithEvidence.filter(row =>
          ["conforme", "oui", "complet", "complete"].includes(
            normalizedStatus(row?.[9])
          )
        ).length;
        const pbcPct = pbcWithEvidence.length
          ? percent(pbcConform, pbcWithEvidence.length)
          : null;

        // WP_Status has no reliable review timestamp column today. Do not invent
        // an "on-time review" rate; leave it blank until review timestamps exist.
        const wpReviewed = wp.filter(row =>
          ["oui", "yes", "revu", "reviewed"].includes(
            normalizedStatus(row?.[9])
          )
        ).length;
        const wpOnTimePct = null;

        const overloadedNames = new Set(
          calendar
            .filter(row => {
              const total = parseNumber(row?.[8]);
              return (total !== null && total > 100) ||
                normalizedStatus(row?.[10]) === "surcharge";
            })
            .map(row => String(row?.[2] || "").trim())
            .filter(Boolean)
        );

        const snapshot = {
          date_calcul: new Date().toISOString(),
          periode_debut: period_start || "",
          periode_fin: period_end || "",
          opportunites_recues_total: opportunities.length,
          opportunites_recues_email: opportunitiesEmail,
          missions_postulees: submitted,
          missions_acceptees: won,
          taux_succes_pct: percent(won, submitted),
          missions_actives: activeMissions.length,
          missions_en_retard: lateMissions.length,
          respect_delai_pct: activeMissions.length
            ? percent(activeMissions.length - lateMissions.length, activeMissions.length)
            : null,
          pbc_conformes_pct: pbcPct,
          wp_revus_dans_delai_pct: wpOnTimePct,
          alertes_ouvertes: openActions.length,
          personnes_surchargees: overloadedNames.size,
          evidence_gaps: [
            ...(wp.length && wpReviewed >= 0
              ? ["WP_Status does not currently contain a reliable review timestamp; WP reviewed-on-time KPI left blank."]
              : []),
            ...(!pbcWithEvidence.length
              ? ["No populated PBC receipt/conformity rows; PBC compliance KPI left blank."]
              : [])
          ]
        };

        await appendSheetValues(
          masterSheetId(),
          "KPI_Historique!A:O",
          [[
            snapshot.date_calcul,
            snapshot.periode_debut,
            snapshot.periode_fin,
            snapshot.opportunites_recues_total,
            snapshot.opportunites_recues_email,
            snapshot.missions_postulees,
            snapshot.missions_acceptees,
            snapshot.taux_succes_pct ?? "",
            snapshot.missions_actives,
            snapshot.missions_en_retard,
            snapshot.respect_delai_pct ?? "",
            snapshot.pbc_conformes_pct ?? "",
            snapshot.wp_revus_dans_delai_pct ?? "",
            snapshot.alertes_ouvertes,
            snapshot.personnes_surchargees
          ]]
        );

        return snapshot;
      }
    })
  });

  return {
    getTeamDirectory,
    readMasterSheet,
    getMissionControls,
    upsertPlanningAssignment,
    syncValidatedProgrammeAssignments,
    refreshCapacityCalendar,
    findAvailableStaff,
    refreshKpiSnapshot
  };
}
