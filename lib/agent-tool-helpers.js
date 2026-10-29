import { createHash } from "node:crypto";
import { isTestMode } from "./test-mode.js";
import {
  clearSheetRange,
  getSheetValues,
  masterSheetId,
  updateSheetValues,
  pilotLegacyAllowed
} from "./google-drive.js";
import { createInternalAction, rest } from "./supabase.js";
import { pbcLifecycleState } from "./pbc-lifecycle.js";

// Helpers shared by the agent tool groups, extracted from agent-tools.js (audit 2026-10-29).

// Generic env names first; TATY_* env names are older aliases. The hardcoded IDs are REAL files of the first
// pilot firm: used only by its own deployment (OFFICE_MANAGER_PILOT_LEGACY_IDS=true), never by another firm,
// never in a preview. Without a setting, the tool says what is missing. Do not add more.
export function legacyDriveSetting(names, legacyId) {
  for (const n of names) if (process.env[n]) return process.env[n];
  if (isTestMode()) throw new Error("TEST_MODE_DRIVE_ID_NOT_SET: " + names[0]);
  if (pilotLegacyAllowed()) return legacyId;
  throw new Error("FIRM_FILE_NOT_CONFIGURED: " + names[0]);
}
export const defaultPbcMasterFileId = () =>
  legacyDriveSetting(["PBC_MASTER_FILE_ID", "TATY_PBC_MASTER_FILE_ID"], "1Pg8txPcg_91XzwKXMYBRib-nr3tfP4-aeZwMAzCauBs");
export const defaultMissionControlRegistryId = () =>
  legacyDriveSetting(["MISSION_CONTROL_REGISTRY_ID", "TATY_MISSION_CONTROL_REGISTRY_ID"], "1e-SikU0wzkVoAzI64LyiWJydo8rM3AQ0C0nKmOOWGQQ");

// Optional canonical work-product template library (generic, per deployment).
// When absent, the library is DISCOVERED in Drive, never hardcoded.
export function configuredTemplateLibraryId() {
  return process.env.WP_TEMPLATE_LIBRARY_FOLDER_ID || null;
}

export function parseDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function overlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

export function dateString(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

export function planningRowsToObjects(rows) {
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
    .filter(item => item.collaborateur && item.mission)
    // The Grand Contrôleur's planning: active missions only (cancelled, closed, finished,
    // merged rows are left out).
    .filter(item => !INACTIVE_PLANNING.test(item.statut.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
}
export const INACTIVE_PLANNING = /annul|cancel|clos|ferm|termin|achev|complet|archiv|abandon|fusion|merged|refus|reject|perdu|lost/i;

export async function staffCache(orgId) {
  return rest(
    `office_staff_profiles?org_id=eq.${encodeURIComponent(orgId)}&active=eq.true&select=id,full_name,email,role_title,grade_title,department,skills,weekly_capacity_hours,profile_status,cv_url,source_directory_url,source_directory_modified_at,last_directory_sync_at&order=full_name.asc&limit=200`
  );
}

export async function buildCalendar(windowStart = null, windowEnd = null) {
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

export async function writeCapacityCalendar(rows) {
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

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function findParameterRow(rows, label) {
  const wanted = normalizeText(label);
  for (let i = 0; i < rows.length; i += 1) {
    if (normalizeText(rows[i]?.[0]) === wanted) return i + 1;
  }
  return null;
}

export async function writeParameterByLabel(spreadsheetId, rows, label, value) {
  const rowNumber = findParameterRow(rows, label);
  if (!rowNumber) return false;
  await updateSheetValues(
    spreadsheetId,
    `PARAMETRES!B${rowNumber}:B${rowNumber}`,
    [[value ?? ""]]
  );
  return true;
}

export function pbcRowsToSummary(rows, limit = 100) {
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


export function nonEmptyRows(rows) {
  return rows
    .slice(1)
    .filter(row => String(row?.[0] || "").trim());
}

export function parseNumber(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function percent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export function normalizedStatus(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_");
}

// ---------------------------------------------------------------------------
// Internal action queue (shared by the root Grand Contrôleur and specialists)
// ---------------------------------------------------------------------------

export function evidencePairsToObject(pairs) {
  if (!Array.isArray(pairs)) return {};
  const out = {};
  for (const pair of pairs) {
    const key = String(pair?.key || "").trim();
    if (key) out[key] = pair?.value ?? "";
  }
  return out;
}

export function idempotencyPrefix(storageKey) {
  // "gc-" is the historical prefix of actions created under grand-controleur:
  // keep it so new runs deduplicate against existing queue rows.
  if (storageKey === "grand-controleur") return "gc";
  return String(storageKey || "agent").replace(/[^a-z0-9]+/gi, "").slice(0, 12);
}

export async function queueInternalAction(ctx, {
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

export function parameterValue(rows, label) {
  const rowNumber = findParameterRow(rows || [], label);
  if (!rowNumber) return null;
  const value = String(rows[rowNumber - 1]?.[1] ?? "").trim();
  return value || null;
}
