import { firmDriveId } from "./google-connection.js";
import { createHash } from "node:crypto";
import { isTestMode } from "./test-mode.js";
import { inventoryListing } from "./inventory-listing.js";
import { getMissionDossier } from "./mission-dossier.js";
import { planPbcFromSops } from "./pbc-sop-plan.js";
import { MISSION_DOCUMENT_MAX_CHARS } from "./document-reading.js";
import { tool } from "@openai/agents";
import { z } from "zod";
import {
  appendSheetValues,
  clearSheetRange,
  copyDriveFile,
  ensureFileCopyFromTemplate,
  getDriveFileMetadata,
  getSheetFormulaMap,
  getSheetValues,
  googleConnectionConfigured,
  listDriveChildren,
  masterSheetId,
  readDriveFileText,
  searchDriveFiles,
  syncFolderFromTemplate,
  updateSheetValues,
  upsertSheetRow
} from "./google-drive.js";
import {
  CHECK_VALUES,
  EVIDENCE_CHECK_KEYS,
  LIBRARY_STATUS,
  MISSION_TYPE_KEYS,
  PBC_STATES,
  applyPbcItemPlan,
  buildRequiredWorkingPapers,
  checkProgrammeState,
  classifyTemplateCandidate,
  TEMPLATE_READ_CHARS,
  contentFingerprint,
  decidePbcEvaluation,
  discoverTemplateLibraries,
  indexTemplateLibrary,
  loadPbcItem,
  planPbcItemApplicability,
  programmeFingerprint,
  programmeNameLooksDraft,
  writePbcEvaluation
} from "./mission-engine.js";
import {
  createInternalAction,
  finishAgentToolEvent,
  rest,
  startAgentToolEvent
} from "./supabase.js";
import { ROOT_AGENT_KEY } from "../agents/index.js";
import { driveAdapter } from "./drive-adapter.js";
import {
  gateBlockedResult,
  loadMemory,
  mappingGate,
  memoryFolderId,
  ownerSecret,
  resolveRoleViaMap
} from "./memory-runtime.js";
import {
  SEMANTIC_ROLE_KEYS,
  buildMappingReport,
  proposeRole,
  recordUnderstanding,
  runMappingPass,
  saveMemory
} from "./orpailleur-memory.js";
import { configuredDriveId } from "./google-drive.js";

// Generic env names first; TATY_* env names and the hardcoded IDs are LEGACY
// pilot fallbacks kept so the current pilot keeps working. Do not add more.
// Read at call time; in test mode (preview) the legacy REAL-firm IDs are never used.
function legacyDriveSetting(names, legacyId) {
  for (const n of names) if (process.env[n]) return process.env[n];
  if (isTestMode()) throw new Error("TEST_MODE_DRIVE_ID_NOT_SET: " + names[0]);
  return legacyId;
}
const defaultPbcMasterFileId = () =>
  legacyDriveSetting(["PBC_MASTER_FILE_ID", "TATY_PBC_MASTER_FILE_ID"], "1Pg8txPcg_91XzwKXMYBRib-nr3tfP4-aeZwMAzCauBs");
const defaultMissionControlRegistryId = () =>
  legacyDriveSetting(["MISSION_CONTROL_REGISTRY_ID", "TATY_MISSION_CONTROL_REGISTRY_ID"], "1e-SikU0wzkVoAzI64LyiWJydo8rM3AQ0C0nKmOOWGQQ");

// Optional canonical work-product template library (generic, per deployment).
// When absent, the library is DISCOVERED in Drive, never hardcoded.
function configuredTemplateLibraryId() {
  return process.env.WP_TEMPLATE_LIBRARY_FOLDER_ID || null;
}

// Drive adapter: see lib/drive-adapter.js (shared with the owner endpoint).
export { driveAdapter };

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

// Tool execution context.
// - specialistKey: logical agent key (mission-controller, orpailleur, sika, or
//   ROOT "grand-controleur" for the Grand Contrôleur / Office Manager root).
// - storageKey: agent_key written to Supabase technical tables. It equals the
//   logical key, except while a new agent (mission-controller) has no
//   office_agent_settings row yet: then its records are written under the
//   legacy "grand-controleur" key (see resolveStorageKey in api/agent.js), and
//   the logical key is kept in metadata/payload so nothing is lost.
function toolContext({ orgId, runId, specialistKey, storageKey }) {
  return {
    orgId,
    runId,
    specialistKey,
    storageKey: storageKey || specialistKey
  };
}

function instrument({
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
      const result = await execute(input);
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
  const lifecycleStates = {};
  const criticalMissing = [];

  for (const row of applicable) {
    const status = String(row?.[18] || "INCONNU").trim() || "INCONNU";
    statuses[status] = (statuses[status] || 0) + 1;
    const lifecycle = pbcLifecycleState(row);
    lifecycleStates[lifecycle] = (lifecycleStates[lifecycle] || 0) + 1;
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
        lifecycle_state: lifecycle,
        deadline: String(row?.[14] || "")
      });
    }
  }

  return {
    total_rows: body.length,
    applicable_rows: applicable.length,
    status_counts: statuses,
    lifecycle_state_counts: lifecycleStates,
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

// ---------------------------------------------------------------------------
// Internal action queue (shared by the root Grand Contrôleur and specialists)
// ---------------------------------------------------------------------------

function evidencePairsToObject(pairs) {
  if (!Array.isArray(pairs)) return {};
  const out = {};
  for (const pair of pairs) {
    const key = String(pair?.key || "").trim();
    if (key) out[key] = pair?.value ?? "";
  }
  return out;
}

function idempotencyPrefix(storageKey) {
  // "gc-" is the historical prefix of actions created under grand-controleur:
  // keep it so new runs deduplicate against existing queue rows.
  if (storageKey === "grand-controleur") return "gc";
  return String(storageKey || "agent").replace(/[^a-z0-9]+/gi, "").slice(0, 12);
}

async function queueInternalAction(ctx, {
  missionId = null,
  assignedStaffProfileId = null,
  actionType,
  summary,
  dueAt = null,
  evidence = {},
  payload = {},
  idempotencyParts = null
}) {
  const parts = idempotencyParts || [
    missionId || "none",
    assignedStaffProfileId || "none",
    actionType,
    summary
  ];
  const key = `${idempotencyPrefix(ctx.storageKey)}-${createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 24)}`;

  const action = await createInternalAction({
    org_id: ctx.orgId,
    agent_key: ctx.storageKey,
    office_mission_id: missionId,
    assigned_staff_profile_id: assignedStaffProfileId,
    action_type: actionType,
    idempotency_key: key,
    summary,
    evidence: evidence || {},
    payload: {
      ...(payload || {}),
      origin_agent_key: ctx.specialistKey
    },
    status: "proposed",
    work_state: "requested",
    due_at: dueAt,
    requested_at: new Date().toISOString()
  });

  if (!action) {
    return { created: false, duplicate: true, idempotency_key: key };
  }
  return { created: true, idempotency_key: key, action };
}

// ---------------------------------------------------------------------------
// PBC lifecycle and overdue-reminder logic
// ---------------------------------------------------------------------------

export const PBC_LIFECYCLE_STATES = [
  "REQUESTED",
  "RECEIVED",
  "PARTIAL",
  "NON_CONFORME",
  "REVIEW",
  "VERIFIED"
];

export const PBC_REMINDER_GRACE_HOURS = 24;
export const PBC_EXTERNAL_REMINDER_ACTION = "pbc_external_reminder";

// PBC_MASTER column indexes (0-based, row data starting at A4).
const PBC_COL = {
  reference: 0,
  dossier: 1,
  document: 2,
  cycles: 4,
  moment: 6,
  critical: 8,
  applicable: 10,
  deadline: 14,
  received: 15,
  complete: 17,
  status: 18
};

// Maps the checklist row to the lifecycle state. The raw status written in the
// checklist wins when it is explicit; otherwise the state is derived from the
// received/complete flags. VERIFIED is never derived from flags alone: it needs
// an explicit verified status (content actually checked).
export function pbcLifecycleState(row) {
  const raw = normalizeText(row?.[PBC_COL.status]).replace(/[^a-z0-9]+/g, "_");

  if (/^(verifie|verifiee|verified|valide|validee)/.test(raw)) return "VERIFIED";
  if (/non_?conforme|rejete|rejected|non_?compliant/.test(raw)) return "NON_CONFORME";
  if (/revue|review|a_controler|a_verifier/.test(raw)) return "REVIEW";
  if (/partiel|partial|incomplet/.test(raw)) return "PARTIAL";
  if (/^(recu|recue|received|complet|complete)/.test(raw)) return "RECEIVED";
  if (/demande|requested|attente|manquant|missing|a_recevoir|en_retard|retard/.test(raw)) {
    return "REQUESTED";
  }

  // "Reçu ?" (manual) accepts Oui / Partiel / Non.
  const receivedRaw = normalizeText(row?.[PBC_COL.received]);
  if (receivedRaw === "partiel") return "PARTIAL";
  const received = receivedRaw === "oui";
  const complete = normalizeText(row?.[PBC_COL.complete]) === "oui";
  if (!received) return "REQUESTED";
  if (!complete) return "PARTIAL";
  return "RECEIVED";
}

// Parses a formatted Google Sheets date (ISO yyyy-mm-dd, or dd/mm/yyyy,
// dd-mm-yyyy, dd.mm.yyyy as used in French workbooks). Returns a UTC date at
// 00:00 of that day, or null when the value cannot be read unambiguously.
export function parseSheetDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const d = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) {
    const day = +match[1];
    const month = +match[2];
    const year = +match[3];
    const d = new Date(Date.UTC(year, month - 1, day));
    if (
      d.getUTCFullYear() !== year ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day
    ) return null;
    return d;
  }

  return null;
}

const MISSING_PBC_STATES = new Set(["REQUESTED", "PARTIAL", "NON_CONFORME"]);

// An applicable PBC item is overdue for an external reminder when it is still
// missing (REQUESTED / PARTIAL / NON_CONFORME) 24 hours after the END of its
// expected day. Using the end of the day avoids premature reminders when only a
// date (no time) is recorded.
export function findOverduePbcItems(rows, now = new Date()) {
  const overdue = [];
  const unparseableDeadlines = [];

  for (const row of rows || []) {
    const reference = String(row?.[PBC_COL.reference] || "").trim();
    if (!reference.startsWith("PBC-")) continue;
    if (normalizeText(row?.[PBC_COL.applicable]) !== "oui") continue;

    const state = pbcLifecycleState(row);
    if (!MISSING_PBC_STATES.has(state)) continue;

    const rawDeadline = String(row?.[PBC_COL.deadline] || "").trim();
    if (!rawDeadline) continue;

    const deadlineDay = parseSheetDate(rawDeadline);
    if (!deadlineDay) {
      unparseableDeadlines.push({ reference, deadline: rawDeadline });
      continue;
    }

    const endOfDeadlineDay = new Date(deadlineDay.getTime() + 24 * 3600 * 1000);
    const reminderDueAt = new Date(
      endOfDeadlineDay.getTime() + PBC_REMINDER_GRACE_HOURS * 3600 * 1000
    );
    if (now < reminderDueAt) continue;

    overdue.push({
      reference,
      dossier: String(row?.[PBC_COL.dossier] || ""),
      document: String(row?.[PBC_COL.document] || ""),
      cycles: String(row?.[PBC_COL.cycles] || ""),
      moment: String(row?.[PBC_COL.moment] || ""),
      critical: normalizeText(row?.[PBC_COL.critical]) === "oui",
      raw_status: String(row?.[PBC_COL.status] || ""),
      lifecycle_state: state,
      deadline: deadlineDay.toISOString().slice(0, 10),
      overdue_since: reminderDueAt.toISOString()
    });
  }

  return { overdue, unparseableDeadlines };
}

function parameterValue(rows, label) {
  const rowNumber = findParameterRow(rows || [], label);
  if (!rowNumber) return null;
  const value = String(rows[rowNumber - 1]?.[1] ?? "").trim();
  return value || null;
}

function commonDriveTools(ctx) {
  const { orgId } = ctx;
  const findDriveDocuments = tool({
    name: "find_drive_documents",
    description:
      "Search the organisation's authorised Shared Drive for actual files/folders. Use before claiming a document exists or is missing.",
    parameters: z.object({
      query: z.string().min(1),
      parent_id: z.string().nullable().optional(),
      mime_type: z.string().nullable().optional(),
      limit: z.number().int().min(1).max(50).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
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
      "Read verified text content from a Drive file when the MIME type is safely supported. Returns content_fingerprint (proof of read) and the file modifiedTime. For unsupported binary formats, returns read_status EXTRACTOR_REQUIRED instead of inventing content. Use max_chars 60000 when the read supports a PBC evaluation.",
    parameters: z.object({
      file_id: z.string().min(1),
      max_chars: z.number().int().min(1000).max(60000).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "read_drive_document",
      execute: async ({ file_id, max_chars }) => {
        const read = await readDriveFileText(file_id, {
          maxChars: max_chars || 30000
        });
        // content_fingerprint is the proof-of-read required to record a
        // PARTIAL / NON_CONFORME / VERIFIED PBC evaluation.
        return {
          ...read,
          read_status: read.supported ? "READ" : "EXTRACTOR_REQUIRED",
          content_fingerprint: read.supported
            ? contentFingerprint(read.file, read.text)
            : null
        };
      }
    })
  });

  const findIndexedDocuments = tool({
    name: "find_indexed_documents",
    description:
      "Search Orpailleur's durable Drive inventory for indexed documents, paths, versions and mission links.",
    parameters: z.object({
      query: z.string().min(1),
      mission_id: z.string().nullable().optional(),
      limit: z.number().int().min(1).max(50).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
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

// Catalog of operational tools shared by the Grand Contrôleur root and the
// Mission Controller specialist. Each agent receives only its own subset (see
// missionControllerTools / grandControleurRootTools), but the implementation
// is written once.
function operationalToolCatalog(ctx) {
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
              ? "Collaborateurs tab currently has no staff rows. Configure TATY_TEAM_DIRECTORY_FILE_ID when the canonical directory file is identified; cache must not override Drive."
              : null
        };
      }
    })
  });

  const readMasterSheet = tool({
    name: "read_taty_master_sheet",
    description:
      "Read one authorised tab/range from the organisation's master-data workbook (current pilot: TATY_AI_MASTER_DATA), the Drive operational register. Use this rather than inventing mission/planning/KPI state.",
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
            const rowsForPlan = await getSheetValues(
              spreadsheetId,
              "PBC_MASTER!A4:AB1000"
            );
            const itemPlan = planPbcItemApplicability({
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

        const pbcRows = await getSheetValues(
          spreadsheetId,
          "PBC_MASTER!A4:AB1000"
        );

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
          getSheetValues(input.spreadsheet_file_id, "PBC_MASTER!A4:AB1000")
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
          lifecycle_state: pbcLifecycleState(item.values),
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
    listOpenInternalActions,
    detectOverduePbcReminders,
    analyzeWorkProgramme,
    prepareSopPbcPlan,
    discoverTemplateLibrariesTool,
    inspectTemplateCandidates,
    buildWorkingPapers,
    loadPbcItemTool,
    recordPbcEvaluation
  };
}

// MISSION CONTROLLER — lifecycle of one individual mission.
function missionControllerTools(ctx) {
  const t = operationalToolCatalog(ctx);
  const m = memoryToolCatalog(ctx);
  return [
    m.resolveSemanticRoleTool,
    t.getMissionControls,
    t.initializeMission,
    t.readMasterSheet,
    t.getTeamDirectory,
    t.upsertPlanningAssignment,
    t.syncValidatedProgrammeAssignments,
    t.analyzeWorkProgramme,
    t.prepareSopPbcPlan,
    t.discoverTemplateLibrariesTool,
    t.inspectTemplateCandidates,
    t.buildWorkingPapers,
    t.createOrUpdatePbcChecklist,
    t.inspectPbcChecklist,
    t.loadPbcItemTool,
    t.recordPbcEvaluation,
    t.detectOverduePbcReminders,
    t.createFollowup,
    ...commonDriveTools(ctx)
  ];
}

// GRAND CONTRÔLEUR / OFFICE MANAGER AI — global tools of the root agent.
// Document search is delegated to Orpailleur, mission work to Mission
// Controller, finance to Sika.
function grandControleurRootTools(ctx) {
  const t = operationalToolCatalog(ctx);
  const m = memoryToolCatalog(ctx);
  return [
    missionDossierTool(ctx),
    m.getMappingReportTool,
    m.resolveSemanticRoleTool,
    t.getTeamDirectory,
    t.readMasterSheet,
    t.refreshCapacityCalendar,
    t.findAvailableStaff,
    t.refreshKpiSnapshot,
    t.listOpenInternalActions,
    t.createFollowup
  ];
}

// ---------------------------------------------------------------------------
// Orpailleur memory tools (OFFICE_MANAGER_MAP.xlsx / OFFICE_MANAGER_REGISTER.xlsx)
// ---------------------------------------------------------------------------

function semanticRoleEnum() {
  return z.enum(SEMANTIC_ROLE_KEYS);
}

function memoryToolCatalog(ctx) {
  const { orgId } = ctx;

  const resolveSemanticRoleTool = tool({
    name: "resolve_semantic_role",
    description:
      "Resolve which Drive folder/file currently plays a semantic role (e.g. WORKING_PAPER_TEMPLATE_LIBRARY, PBC_MASTER) from OFFICE_MANAGER_MAP. OWNER_APPROVED = an active owner-signed rule (use basis OWNER_APPROVED_MAP); REVIEW_REQUIRED = concurrent owner rules or approved target missing; NO_OWNER_APPROVAL / NO_MAP = use normal discovery. Memory is about roles, not paths.",
    parameters: z.object({ semantic_role: semanticRoleEnum() }),
    execute: instrument({
      ...ctx,
      toolName: "resolve_semantic_role",
      execute: async ({ semantic_role }) => resolveRoleViaMap(semantic_role)
    })
  });

  const runMappingPassTool = tool({
    name: "run_mapping_pass",
    description:
      "Run one Orpailleur mapping pass over the authorised Drive: the first pass is FIRST_MAPPING, later passes are differential against OFFICE_MANAGER_REGISTER (UNCHANGED / NEW / MODIFIED / RENAMED / MOVED / DELETED_OR_MISSING). UNCHANGED files are not re-read; NEW/MODIFIED/RENAMED/MOVED business files are opened and read and queued for YOUR understanding; absent files are re-checked by id and only declared DELETED_OR_MISSING after repeated complete passes. READ-ONLY on business files: it only creates/updates the two memory files in place. Listing source: DRIVE_WALK, or ORPAILLEUR_INVENTORY (latest run of the existing durable scanner).",
    parameters: z.object({
      listing_source: z.enum(["DRIVE_WALK", "ORPAILLEUR_INVENTORY"]),
      max_reads: z.number().int().min(0).max(500).nullable().optional(),
      max_items: z.number().int().min(1).max(50000).nullable().optional()
    }),
    execute: instrument({
      ...ctx,
      toolName: "run_mapping_pass",
      execute: async input => {
        // Works with direct Google credentials or through the Supabase bridge
        // (create_binary_file / update_binary_file); the adapter hides which.
        if (!googleConnectionConfigured()) {
          return {
            status: "GOOGLE_CONNECTION_REQUIRED",
            reason: "No Google connection (direct or bridge) is configured. Nothing was scanned or written."
          };
        }
        let listing = null;
        // A migrated memory must be found in full before any mapping write.
        // Missing files are an operational error, never a new FIRST_MAPPING.
        if (String(process.env.OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY || "").toLowerCase() === "true") {
          await loadMemory(driveAdapter);
        }
        if (input.listing_source === "ORPAILLEUR_INVENTORY") {
          listing = await inventoryListing(orgId);
          if (!listing) return { status: "NO_COMPLETE_INVENTORY_RUN", reason: "No COMPLETE scan for this Drive. Wait for completion or use DRIVE_WALK; nothing was written." };
        }
        const { summary } = await runMappingPass(driveAdapter, {
          memoryFolderId: memoryFolderId(),
          rootFolderId: configuredDriveIdForScan(),
          listing,
          maxReads: input.max_reads ?? 150,
          maxItems: input.max_items || 20000,
          org: orgId
        });
        return { status: "PASS_COMPLETED", ...summary, journal_record: { kind: "MAPPING_PASS", ...summary } };
      }
    })
  });

  const getFilesToUnderstand = tool({
    name: "get_files_to_understand",
    description:
      "Return REGISTER objects waiting for YOUR understanding (NEEDS_UNDERSTANDING): for files, a fresh content excerpt and the content_fingerprint to quote back; for folders, their children names. Read-only.",
    parameters: z.object({
      limit: z.number().int().min(1).max(25).nullable().optional(),
      folders_first: z.boolean()
    }),
    execute: instrument({
      ...ctx,
      toolName: "get_files_to_understand",
      execute: async input => {
        const memory = await loadMemory();
        if (!memory.exists) return { status: "NO_MAP" };
        let pending = memory.register.rows.filter(r => r.status === "PRESENT" && r.understanding_status === "NEEDS_UNDERSTANDING");
        if (input.folders_first) pending = [...pending].sort((a, b) => (a.is_folder === "true" ? -1 : 1) - (b.is_folder === "true" ? -1 : 1));
        const out = [];
        for (const row of pending.slice(0, input.limit || 10)) {
          const base = { file_id: row.file_id, name: row.name, path: row.path, mime_type: row.mime_type, is_folder: row.is_folder === "true", modified_time: row.modified_time, change_type: row.change_type, current_semantic_role: row.semantic_role || null };
          if (row.is_folder === "true") {
            const children = await driveAdapter.listChildren(row.file_id).catch(() => []);
            out.push({ ...base, children: children.slice(0, 40).map(c => ({ name: c.name, mime_type: c.mimeType })) });
            continue;
          }
          const read = await driveAdapter.readText(row.file_id, { maxChars: 30000 }).catch(error => ({ supported: false, reason: error.message }));
          if (!read.supported) {
            out.push({ ...base, read_status: "EXTRACTOR_REQUIRED" });
            continue;
          }
          const fingerprint = contentFingerprint(read.file || { id: row.file_id, modifiedTime: row.modified_time }, read.text);
          out.push({
            ...base,
            content_fingerprint: row.content_fingerprint,
            changed_since_pass: fingerprint !== row.content_fingerprint,
            excerpt: read.text.slice(0, 4000)
          });
        }
        return { pending_total: pending.length, items: out, semantic_roles: SEMANTIC_ROLE_KEYS };
      }
    })
  });

  const recordFileUnderstandingTool = tool({
    name: "record_file_understanding",
    description:
      "Record YOUR understanding of REGISTER objects (semantic_role, classification, client, mission, confidence, rationale). Files require the content_fingerprint returned by get_files_to_understand (stale or unread files are refused). Writes only OFFICE_MANAGER_REGISTER; never moves or renames anything.",
    parameters: z.object({
      items: z.array(z.object({
        file_id: z.string().min(1),
        content_fingerprint: z.string().nullable().optional(),
        semantic_role: semanticRoleEnum(),
        classification: z.string().nullable().optional(),
        client: z.string().nullable().optional(),
        mission: z.string().nullable().optional(),
        confidence: z.number().min(0).max(1),
        rationale: z.string().min(10).max(800)
      })).min(1).max(50)
    }),
    execute: instrument({
      ...ctx,
      toolName: "record_file_understanding",
      execute: async input => {
        const memory = await loadMemory();
        if (!memory.exists) return { status: "NO_MAP" };
        const results = recordUnderstanding(memory, input.items, { now: new Date().toISOString() });
        if (results.some(r => r.status === "RECORDED")) await saveMemory(driveAdapter, memory);
        return { results };
      }
    })
  });

  const proposeMapRoleTool = tool({
    name: "propose_map_role",
    description:
      "PROPOSE (never approve) that a folder/file plays a semantic role. Adds an AI_HYPOTHESIS row in OFFICE_MANAGER_MAP (owner_approval_status PENDING) and queues an owner validation action. Only the owner can approve, through the owner endpoint, which writes a signed rule in RULES.",
    parameters: z.object({
      semantic_role: semanticRoleEnum(),
      target_file_id: z.string().min(1),
      confidence: z.number().min(0).max(1),
      rationale: z.string().min(10).max(1000)
    }),
    execute: instrument({
      ...ctx,
      toolName: "propose_map_role",
      execute: async input => {
        const memory = await loadMemory();
        if (!memory.exists) return { status: "NO_MAP" };
        const now = new Date().toISOString();
        const proposal = proposeRole(memory, {
          semanticRole: input.semantic_role,
          targetFileId: input.target_file_id,
          confidence: input.confidence,
          rationale: input.rationale,
          now
        });
        if (proposal.status !== "PROPOSED" && proposal.status !== "ALREADY_MAPPED") return proposal;
        await saveMemory(driveAdapter, memory);
        const action = await queueInternalAction(ctx, {
          actionType: "map_owner_validation",
          summary: `Valider : ${proposal.map_row.target_name} = ${input.semantic_role} ?`.slice(0, 500),
          idempotencyParts: ["map-owner-validation", input.semantic_role, input.target_file_id],
          evidence: { semantic_role: input.semantic_role, target_file_id: input.target_file_id },
          payload: { map_id: proposal.map_row.map_id, rationale: input.rationale, confidence: input.confidence }
        });
        return { ...proposal, owner_validation_action: action, note: "Proposal only: not an approval." };
      }
    })
  });

  const getMappingReportTool = tool({
    name: "get_mapping_report",
    description:
      "Report of the Drive mapping for the owner: mapping state (FIRST_MAPPING / MAPPING_PENDING_REVIEW / MAPPING_REVIEWED), counts, objects by role, role resolutions and the ONLY questions that need owner validation (ambiguous or unconfirmed SINGLE roles). Use it to explain to the owner how the AI understood the organisation. Read-only.",
    parameters: z.object({}),
    execute: instrument({
      ...ctx,
      toolName: "get_mapping_report",
      execute: async () => {
        const memory = await loadMemory();
        if (!memory.exists) return { status: "NO_MAP", mapping_state: "NO_MAP" };
        return buildMappingReport(memory, ownerSecret());
      }
    })
  });

  return {
    resolveSemanticRoleTool,
    runMappingPassTool,
    getFilesToUnderstand,
    recordFileUnderstandingTool,
    proposeMapRoleTool,
    getMappingReportTool
  };
}

// Scope of the mapping: OFFICE_MANAGER_SCAN_ROOT_ID, else the configured Shared Drive root.
function configuredDriveIdForScan() {
  // The Drive chosen by the firm in the app wins over the server setting.
  return firmDriveId() || process.env.OFFICE_MANAGER_SCAN_ROOT_ID || configuredDriveId();
}

function orpailleurTools(ctx) {
  const { orgId } = ctx;

  const listArchives = tool({
    name: "list_archives",
    description:
      "Search the archive index for archived mission folders/documents that may need to be retrieved. Does not restore or move anything yet.",
    parameters: z.object({
      query: z.string().nullable().optional(),
      status: z.string().nullable().optional()
    }),
    execute: instrument({
      ...ctx,
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

  const m = memoryToolCatalog(ctx);
  return [
    listArchives,
    m.runMappingPassTool,
    m.getFilesToUnderstand,
    m.recordFileUnderstandingTool,
    m.proposeMapRoleTool,
    m.getMappingReportTool,
    m.resolveSemanticRoleTool,
    ...commonDriveTools(ctx)
  ];
}

// Tools of a specialist. runtime.storageKeys optionally maps a logical agent
// key to the agent_key used in Supabase technical tables (legacy fallback).
export function buildSpecialistTools(agentKey, runtime = {}) {
  const { orgId, runId, storageKeys = {} } = runtime;
  if (!orgId) return [];

  const ctx = toolContext({
    orgId,
    runId,
    specialistKey: agentKey,
    storageKey: storageKeys[agentKey]
  });

  if (agentKey === "mission-controller") {
    return [missionDossierTool(ctx), ...missionControllerTools(ctx)];
  }

  if (agentKey === "orpailleur") {
    return orpailleurTools(ctx);
  }

  // Sika has no live tools yet (analysis from its preloaded snapshot).
  return [];
}

function missionDossierTool(ctx) {
  return tool({
    name: 'read_office_mission_dossier',
    description: 'Read the current Supabase Office Manager mission dossier by mission UUID: scope, dates, confirmed assignments, internal actions and document inventory. Use for app-created missions including Nova Services. Does not verify the Drive register and does not return questionnaire profiles. Read-only.',
    parameters: z.object({ mission_id: z.string() }),
    execute: instrument({ ...ctx, toolName:'read_office_mission_dossier',
      execute: async ({mission_id}) => {
        const dossier = await getMissionDossier(ctx.orgId,mission_id);
        return { ...dossier, plans:dossier.plans.slice(0,1),
          plan_history:dossier.plans.map(p=>({id:p.id,version:p.version,created_at:p.created_at})),
          plan_notice:'Only latest draft content included. Saved plans are proposals, never approval or authority to execute.' };
      } })
  });
}

// Global tools of the root Grand Contrôleur / Office Manager AI agent.
export function buildRootTools(runtime = {}) {
  const { orgId, runId, storageKeys = {} } = runtime;
  if (!orgId) return [];

  return grandControleurRootTools(toolContext({
    orgId,
    runId,
    specialistKey: ROOT_AGENT_KEY,
    storageKey: storageKeys[ROOT_AGENT_KEY]
  }));
}
