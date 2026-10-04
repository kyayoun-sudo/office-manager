import { createHash } from "node:crypto";
import { tool } from "@openai/agents";
import { z } from "zod";
import {
  clearSheetRange,
  ensureFileCopyFromTemplate,
  getDriveFileMetadata,
  getSheetValues,
  googleConnectionConfigured,
  masterSheetId,
  readDriveFileText,
  searchDriveFiles,
  syncFolderFromTemplate,
  updateSheetValues,
  upsertSheetRow
} from "./google-drive.js";
import {
  createInternalAction,
  finishAgentToolEvent,
  rest,
  startAgentToolEvent
} from "./supabase.js";

const DEFAULT_PBC_MASTER_FILE_ID =
  process.env.TATY_PBC_MASTER_FILE_ID ||
  "1Pg8txPcg_91XzwKXMYBRib-nr3tfP4-aeZwMAzCauBs";

const DEFAULT_MISSION_CONTROL_REGISTRY_ID =
  process.env.TATY_MISSION_CONTROL_REGISTRY_ID ||
  "1e-SikU0wzkVoAzI64LyiWJydo8rM3AQ0C0nKmOOWGQQ";

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

function instrument({ orgId, runId, specialistKey, toolName, execute }) {
  return async input => {
    const event = await startAgentToolEvent({
      orgId,
      runId,
      specialistKey,
      toolName,
      inputSummary: inputSummary(input)
    });

    try {
      const result = await execute(input);
      await finishAgentToolEvent(event?.id, {
        phase: "completed",
        outputSummary: outputSummary(result)
      });
      return asJson(result);
    } catch (error) {
      await finishAgentToolEvent(event?.id, {
        phase: "failed",
        outputSummary: String(error?.message || error).slice(0, 500)
      });
      throw error;
    }
  };
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function dateString(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function planningRowsToObjects(rows) {
  return rows
    .slice(1)
    .filter(row => row.some(cell => String(cell || "").trim()))
    .map(row => ({
      id: String(row[0] || ""),
      collaborateur: String(row[1] || ""),
      mission: String(row[2] || ""),
      dateDebut: String(row[3] || ""),
      dateFin: String(row[4] || ""),
      chargePct: Number(row[5] || 0),
      roleMission: String(row[6] || ""),
      statut: String(row[7] || ""),
      client: String(row[8] || ""),
      cycle: String(row[9] || ""),
      reviewer: String(row[10] || ""),
      sourcePlanUrl: String(row[11] || ""),
      sourcePlanFileId: String(row[12] || ""),
      sourcePlanModifiedAt: String(row[13] || "")
    }))
    .filter(item => item.collaborateur && item.mission);
}

async function staffCache(orgId) {
  return rest(
    `office_staff_profiles?org_id=eq.${encodeURIComponent(orgId)}&active=eq.true&select=id,full_name,email,role_title,grade_title,department,skills,weekly_capacity_hours,profile_status,cv_url,source_directory_url,source_directory_modified_at,last_directory_sync_at&order=full_name.asc&limit=200`
  );
}

async function buildCalendar(windowStart = null, windowEnd = null) {
  const sheetId = masterSheetId();
  const planningRows = await getSheetValues(sheetId, "Planning!A1:P3000");
  let rawAssignments = planningRowsToObjects(planningRows);

  const start = parseDate(windowStart);
  const end = parseDate(windowEnd);

  if (start && end) {
    rawAssignments = rawAssignments.filter(item => {
      const s = parseDate(item.dateDebut);
      const e = parseDate(item.dateFin);
      return s && e && overlap(s, e, start, end);
    });
  }

  // Planning can contain one row per cycle/workstream. For capacity, one
  // person's repeated cycle rows inside the same mission/period must not be
  // mistaken for separate simultaneous missions. Aggregate first.
  const grouped = new Map();
  for (const item of rawAssignments) {
    const key = [
      item.collaborateur.toLowerCase(),
      item.mission.toLowerCase(),
      item.dateDebut,
      item.dateFin
    ].join("|");

    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        ...item,
        ids: [item.id],
        cycles: item.cycle ? [item.cycle] : [],
        reviewers: item.reviewer ? [item.reviewer] : []
      });
      continue;
    }

    current.ids.push(item.id);
    if (item.cycle && !current.cycles.includes(item.cycle)) {
      current.cycles.push(item.cycle);
    }
    if (item.reviewer && !current.reviewers.includes(item.reviewer)) {
      current.reviewers.push(item.reviewer);
    }
    // Treat Charge_Pct as the mission-period allocation repeated on cycle rows.
    // Use the maximum instead of adding duplicate cycle allocations.
    current.chargePct = Math.max(
      Number(current.chargePct || 0),
      Number(item.chargePct || 0)
    );
  }

  const assignments = [...grouped.values()].map(item => ({
    ...item,
    id: item.ids.join("|"),
    cycle: item.cycles.join(" ; "),
    reviewer: item.reviewers.join(" ; ")
  }));

  const rows = assignments.map(item => {
    const itemStart = parseDate(item.dateDebut);
    const itemEnd = parseDate(item.dateFin);

    const concurrent = assignments.filter(other => {
      if (other.id === item.id) return false;
      if (
        other.collaborateur.toLowerCase() !==
        item.collaborateur.toLowerCase()
      ) return false;
      const otherStart = parseDate(other.dateDebut);
      const otherEnd = parseDate(other.dateFin);
      return itemStart && itemEnd && otherStart && otherEnd &&
        overlap(itemStart, itemEnd, otherStart, otherEnd);
    });

    const total = item.chargePct + concurrent.reduce(
      (sum, other) => sum + Number(other.chargePct || 0),
      0
    );

    const available = Math.max(0, 100 - total);
    const conflictNames = [...new Set(concurrent.map(x => x.mission))];
    const status = total > 100
      ? "SURCHARGE"
      : conflictNames.length
        ? "CHEVAUCHEMENT_A_CONTROLER"
        : available === 0
          ? "INDISPONIBLE"
          : "AFFECTE_DISPONIBILITE_PARTIELLE";

    return {
      ...item,
      totalChargePct: total,
      availablePct: available,
      availabilityStatus: status,
      conflict: conflictNames.length > 0,
      conflictWith: conflictNames.join(" | ")
    };
  });

  return rows;
}

async function writeCapacityCalendar(rows) {
  const outputRows = rows.map(item => [
    item.dateDebut,
    item.dateFin,
    item.collaborateur,
    item.mission,
    item.client,
    item.roleMission,
    item.cycle,
    item.chargePct,
    item.totalChargePct,
    item.availablePct,
    item.availabilityStatus,
    item.conflict ? "OUI" : "NON",
    item.sourcePlanUrl,
    new Date().toISOString(),
    item.conflictWith,
    "",
    "",
    item.conflict ? "OUI" : "NON"
  ]);

  await clearSheetRange(
    masterSheetId(),
    "Calendrier_Capacite!A2:R2000"
  );

  if (outputRows.length) {
    await updateSheetValues(
      masterSheetId(),
      `Calendrier_Capacite!A2:R${outputRows.length + 1}`,
      outputRows
    );
  }

  return outputRows.length;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function findParameterRow(rows, label) {
  const wanted = normalizeText(label);
  for (let i = 0; i < rows.length; i += 1) {
    if (normalizeText(rows[i]?.[0]) === wanted) return i + 1;
  }
  return null;
}

async function writeParameterByLabel(spreadsheetId, rows, label, value) {
  const rowNumber = findParameterRow(rows, label);
  if (!rowNumber) return false;
  await updateSheetValues(
    spreadsheetId,
    `PARAMETRES!B${rowNumber}:B${rowNumber}`,
    [[value ?? ""]]
  );
  return true;
}

function pbcRowsToSummary(rows, limit = 100) {
  const body = rows
    .slice(1)
    .filter(row => String(row?.[0] || "").startsWith("PBC-"));

  const applicable = body.filter(
    row => normalizeText(row?.[10]) === "oui"
  );
  const statuses = {};
  const criticalMissing = [];

  for (const row of applicable) {
    const status = String(row?.[18] || "INCONNU").trim() || "INCONNU";
    statuses[status] = (statuses[status] || 0) + 1;
    const critical = normalizeText(row?.[8]) === "oui";
    const received = normalizeText(row?.[15]) === "oui";
    const complete = normalizeText(row?.[17]) === "oui";
    if (critical && (!received || !complete)) {
      criticalMissing.push({
        reference: String(row?.[0] || ""),
        dossier: String(row?.[1] || ""),
        document: String(row?.[2] || ""),
        cycles: String(row?.[4] || ""),
        moment: String(row?.[6] || ""),
        status,
        deadline: String(row?.[14] || "")
      });
    }
  }

  return {
    total_rows: body.length,
    applicable_rows: applicable.length,
    status_counts: statuses,
    critical_missing: criticalMissing.slice(0, limit)
  };
}


function nonEmptyRows(rows) {
  return rows
    .slice(1)
    .filter(row => String(row?.[0] || "").trim());
}

function parseNumber(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function percent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function normalizedStatus(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_");
}

function commonDriveTools({ orgId, runId, specialistKey }) {
  const findDriveDocuments = tool({
    name: "find_drive_documents",
    description:
      "Search the authorised TATY Shared Drive for actual files/folders. Use before claiming a document exists or is missing.",
    parameters: z.object({
      query: z.string().min(1),
      parent_id: z.string().nullable().optional(),
      mime_type: z.string().nullable().optional(),
      limit: z.number().int().min(1).max(50).optional()
    }),
    execute: instrument({
      orgId,
      runId,
      specialistKey,
      toolName: "find_drive_documents",
      execute: async ({ query, parent_id, mime_type, limit }) => ({
        files: await searchDriveFiles({
          query,
          parentId: parent_id || null,
          mimeType: mime_type || null,
          limit: limit || 25
        })
      })
    })
  });

  const readDriveDocument = tool({
    name: "read_drive_document",
    description:
      "Read verified text content from a Drive file when the MIME type is safely supported. For unsupported binary formats, return a review/extraction requirement instead of inventing content.",
    parameters: z.object({
      file_id: z.string().min(1),
      max_chars: z.number().int().min(1000).max(60000).optional()
    }),
    execute: instrument({
      orgId,
      runId,
      specialistKey,
      toolName: "read_drive_document",
      execute: async ({ file_id, max_chars }) =>
        readDriveFileText(file_id, { maxChars: max_chars || 30000 })
    })
  });

  const findIndexedDocuments = tool({
    name: "find_indexed_documents",
    description:
      "Search Orpailleur's durable Drive inventory for indexed TATY documents, paths, versions and mission links.",
    parameters: z.object({
      query: z.string().min(1),
      mission_id: z.string().nullable().optional(),
      limit: z.number().int().min(1).max(50).optional()
    }),
    execute: instrument({
      orgId,
      runId,
      specialistKey,
      toolName: "find_indexed_documents",
      execute: async ({ query, mission_id, limit }) => {
        const safe = query.replace(/[*,()]/g, " ").trim();
        const missionFilter = mission_id
          ? `&office_mission_id=eq.${encodeURIComponent(mission_id)}`
          : "";
        const rows = await rest(
          `orpailleur_inventory?org_id=eq.${encodeURIComponent(orgId)}${missionFilter}&or=(name.ilike.*${encodeURIComponent(safe)}*,folder_path.ilike.*${encodeURIComponent(safe)}*,document_type.ilike.*${encodeURIComponent(safe)}*)&select=file_id,name,folder_path,web_url,mime_type,modified_at,classification,decision_status,client_name,office_mission_id,document_type,document_period,document_version,content_verified_at&order=modified_at.desc&limit=${limit || 25}`
        );
        return { documents: rows };
      }
    })
  });

  return [findDriveDocuments, readDriveDocument, findIndexedDocuments];
}

function grandControleurTools({ orgId, runId }) {
  const specialistKey = "grand-controleur";

  const getTeamDirectory = tool({
    name: "get_team_directory",
    description:
      "Read the cabinet team directory source from Drive/master data and the last technical cache. Use at every global passage before resolving responsible people or email addresses.",
    parameters: z.object({
      name_filter: z.string().nullable().optional()
    }),
    execute: instrument({
      orgId,
      runId,
      specialistKey,
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
              ? "Collaborateurs tab currently has no staff rows. Configure TATY_TEAM_DIRECTORY_FILE_ID when the canonical directory file is identified; cache must not override Drive."
              : null
        };
      }
    })
  });

  const readMasterSheet = tool({
    name: "read_taty_master_sheet",
    description:
      "Read one authorised tab/range from TATY_AI_MASTER_DATA, the Drive operational register. Use this rather than inventing mission/planning/KPI state.",
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
      orgId,
      runId,
      specialistKey,
      toolName: "read_taty_master_sheet",
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
      orgId,
      runId,
      specialistKey,
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
      orgId,
      runId,
      specialistKey,
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
      orgId,
      runId,
      specialistKey,
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
      orgId,
      runId,
      specialistKey,
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
      minimum_available_pct: z.number().min(0).max(100).optional(),
      role_hint: z.string().nullable().optional(),
      required_skill: z.string().nullable().optional()
    }),
    execute: instrument({
      orgId,
      runId,
      specialistKey,
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
      orgId,
      runId,
      specialistKey,
      toolName: "refresh_kpi_snapshot",
      execute: async ({ period_start, period_end }) => {
        const [oppRows, missionRows, calendarRows, pbcRows, wpRows, openActions] =
          await Promise.all([
            getSheetValues(masterSheetId(), "Opportunites!A1:W3000"),
            getSheetValues(masterSheetId(), "Missions!A1:W3000"),
            getSheetValues(masterSheetId(), "Calendrier_Capacite!A1:R3000"),
            getSheetValues(DEFAULT_MISSION_CONTROL_REGISTRY_ID, "PBC_Status!A1:O5000"),
            getSheetValues(DEFAULT_MISSION_CONTROL_REGISTRY_ID, "WP_Status!A1:N5000"),
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

  const createOrUpdatePbcChecklist = tool({
    name: "create_or_update_mission_pbc",
    description:
      "Create or update a mission PBC checklist by copying the approved TATY PBC master and setting mission parameters/cycle applicability from an explicitly validated work programme. Never use an unvalidated/draft programme.",
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
      pbc_template_file_id: z.string().nullable().optional()
    }),
    execute: instrument({
      orgId,
      runId,
      specialistKey,
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
        if (/a[_ -]?valider|draft|brouillon/i.test(planName)) {
          return {
            written: false,
            status: "VALIDATION_CONFLICT",
            reason:
              `The supplied programme is named '${planName}', which still indicates a draft/to-be-validated version. Use the validated version or obtain explicit validation evidence before generating the PBC.`,
            programme: plan
          };
        }

        const checklistName = input.checklist_name ||
          `${input.mission_reference}_PBC_CHECKLIST`;
        const templateFileId = input.pbc_template_file_id ||
          DEFAULT_PBC_MASTER_FILE_ID;

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

        const pbcRows = await getSheetValues(
          spreadsheetId,
          "PBC_MASTER!A4:AB1000"
        );

        return {
          written: true,
          created: ensured.created,
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
      critical_limit: z.number().int().min(1).max(100).optional()
    }),
    execute: instrument({
      orgId,
      runId,
      specialistKey,
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
          getSheetValues(spreadsheet_file_id, "PBC_MASTER!A4:AB1000")
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

  const initializeMission = tool({
    name: "initialize_mission_from_template",
    description:
      "Initialize a real mission folder from an approved Drive template after evidence shows the mission has started, then register/update that mission in the Drive Missions register. The operation is idempotent: existing folders/files with the same names are preserved, not overwritten or deleted.",
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
      orgId,
      runId,
      specialistKey,
      toolName: "initialize_mission_from_template",
      execute: async input => {
        const evidence = await getDriveFileMetadata(
          input.started_evidence_file_id
        );
        const result = await syncFolderFromTemplate({
          templateFolderId: input.template_folder_id,
          destinationParentId: input.destination_parent_id,
          destinationName: input.destination_name
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
          template_sync: result
        };
      }
    })
  });

  const createFollowup = tool({
    name: "create_internal_followup",
    description:
      "Create an internal follow-up/action in the controlled queue for a missing work item, PBC, review, deadline or staffing issue. This does not send an email by itself.",
    parameters: z.object({
      mission_id: z.string().nullable().optional(),
      assigned_staff_profile_id: z.string().nullable().optional(),
      action_type: z.string().min(2),
      summary: z.string().min(3).max(500),
      due_at: z.string().nullable().optional(),
      evidence: z.record(z.string(), z.any()).optional()
    }),
    execute: instrument({
      orgId,
      runId,
      specialistKey,
      toolName: "create_internal_followup",
      execute: async input => {
        const key = `gc-${createHash("sha256")
          .update([
            input.mission_id || "none",
            input.assigned_staff_profile_id || "none",
            input.action_type,
            input.summary
          ].join("|"))
          .digest("hex")
          .slice(0, 24)}`;

        try {
          const action = await createInternalAction({
            org_id: orgId,
            agent_key: "grand-controleur",
            office_mission_id: input.mission_id || null,
            assigned_staff_profile_id:
              input.assigned_staff_profile_id || null,
            action_type: input.action_type,
            idempotency_key: key,
            summary: input.summary,
            evidence: input.evidence || {},
            payload: {},
            status: "proposed",
            work_state: "requested",
            due_at: input.due_at || null,
            requested_at: new Date().toISOString()
          });
          if (!action) {
            return {
              created: false,
              duplicate: true,
              idempotency_key: key
            };
          }
          return { created: true, action };
        } catch (error) {
          throw error;
        }
      }
    })
  });

  return [
    getTeamDirectory,
    readMasterSheet,
    getMissionControls,
    upsertPlanningAssignment,
    syncValidatedProgrammeAssignments,
    refreshCapacityCalendar,
    findAvailableStaff,
    refreshKpiSnapshot,
    createOrUpdatePbcChecklist,
    inspectPbcChecklist,
    initializeMission,
    createFollowup,
    ...commonDriveTools({ orgId, runId, specialistKey })
  ];
}

function orpailleurTools({ orgId, runId }) {
  const specialistKey = "orpailleur";

  const listArchives = tool({
    name: "list_archives",
    description:
      "Search the archive index for archived mission folders/documents that may need to be retrieved. Does not restore or move anything yet.",
    parameters: z.object({
      query: z.string().nullable().optional(),
      status: z.string().nullable().optional()
    }),
    execute: instrument({
      orgId,
      runId,
      specialistKey,
      toolName: "list_archives",
      execute: async ({ query, status }) => {
        const filters = [
          `org_id=eq.${encodeURIComponent(orgId)}`
        ];
        if (status) filters.push(`status=eq.${encodeURIComponent(status)}`);
        if (query) {
          const safe = query.replace(/[*,()]/g, " ").trim();
          filters.push(
            `or=(title.ilike.*${encodeURIComponent(safe)}*,archive_code.ilike.*${encodeURIComponent(safe)}*,archive_location.ilike.*${encodeURIComponent(safe)}*)`
          );
        }
        const rows = await rest(
          `office_archives?${filters.join("&")}&select=id,office_mission_id,archive_code,title,archive_provider,source_folder_id,archive_location,status,retention_until,archived_at,restored_at&order=created_at.desc&limit=100`
        );
        return { archives: rows };
      }
    })
  });

  return [
    listArchives,
    ...commonDriveTools({ orgId, runId, specialistKey })
  ];
}

export function buildSpecialistTools(agentKey, runtime = {}) {
  const { orgId, runId } = runtime;
  if (!orgId) return [];

  if (agentKey === "grand-controleur") {
    return grandControleurTools({ orgId, runId });
  }

  if (agentKey === "orpailleur") {
    return orpailleurTools({ orgId, runId });
  }

  return [];
}
