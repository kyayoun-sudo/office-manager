// Structural tests for the phase-1 agent architecture.
// No network call: agents and tools are only constructed, never run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  AGENTS,
  GRAND_CONTROLEUR_INSTRUCTIONS,
  LEGACY_SETTING_FALLBACK,
  OFFICE_MANAGER_INSTRUCTIONS,
  ROOT_AGENT_KEY,
  ROOT_AGENT_NAME,
  ROOT_ROUTE,
  SPECIALIST_KEYS,
  chooseAgent,
  getAgent,
  normalizeRequestedAgent
} from "../agents/index.js";
import {
  buildRootTools,
  buildSpecialistTools,
  findOverduePbcItems,
  parseSheetDate,
  pbcLifecycleState
} from "../lib/agent-tools.js";
import {
  CONSULT_TOOLS,
  buildManagerAgent
} from "../lib/orchestrator.js";

const runtime = { orgId: "test-org", runId: null };

test("specialists are exactly Mission Controller, Orpailleur, Sika", () => {
  assert.deepEqual(SPECIALIST_KEYS, ["mission-controller", "orpailleur", "sika"]);
  assert.equal(AGENTS["mission-controller"].name, "Mission Controller");
  assert.equal(AGENTS["grand-controleur"], undefined);
  assert.throws(() => getAgent("grand-controleur"), /UNKNOWN_AGENT/);
});

test("root agent is the Grand Contrôleur / Office Manager AI", () => {
  assert.equal(ROOT_AGENT_KEY, "grand-controleur");
  assert.match(ROOT_AGENT_NAME, /Grand Contr[ôo]leur/);
  assert.match(ROOT_AGENT_NAME, /Office Manager AI/);
  assert.equal(OFFICE_MANAGER_INSTRUCTIONS, GRAND_CONTROLEUR_INSTRUCTIONS);
  for (const name of ["Mission Controller", "Orpailleur", "Sika"]) {
    assert.ok(GRAND_CONTROLEUR_INSTRUCTIONS.includes(name), name);
  }
  assert.ok(!GRAND_CONTROLEUR_INSTRUCTIONS.includes("consult_grand_controleur"));
});

test("manager agent consults exactly the three specialists", () => {
  const contexts = { "mission-controller": {}, orpailleur: {}, sika: {} };
  const manager = buildManagerAgent(contexts, runtime, {});
  const names = manager.tools.map(t => t.name);

  assert.equal(manager.name, ROOT_AGENT_NAME);
  assert.ok(names.includes("consult_mission_controller"));
  assert.ok(names.includes("consult_orpailleur"));
  assert.ok(names.includes("consult_sika"));
  assert.ok(!names.includes("consult_grand_controleur"));
  const consults = names.filter(n => n.startsWith("consult_"));
  assert.deepEqual(consults.sort(), Object.values(CONSULT_TOOLS).sort());

  // Root keeps the global tools.
  for (const tool of [
    "refresh_capacity_calendar",
    "find_available_staff",
    "refresh_kpi_snapshot",
    "get_team_directory",
    "list_open_internal_actions"
  ]) {
    assert.ok(names.includes(tool), tool);
  }
});

test("mission controller owns the mission-level tools", () => {
  const names = buildSpecialistTools("mission-controller", runtime).map(t => t.name);
  for (const tool of [
    "get_mission_controls",
    "initialize_mission_from_template",
    "sync_validated_programme_assignments",
    "upsert_confirmed_planning_assignment",
    "create_or_update_mission_pbc",
    "inspect_pbc_checklist",
    "detect_overdue_pbc_reminders",
    "create_internal_followup",
    "find_drive_documents"
  ]) {
    assert.ok(names.includes(tool), tool);
  }
  // Global capacity/KPI belong to the root.
  assert.ok(!names.includes("refresh_kpi_snapshot"));
  assert.ok(!names.includes("refresh_capacity_calendar"));
});

test("no operational tool was lost in the split", () => {
  const before = [
    "get_team_directory", "read_taty_master_sheet", "get_mission_controls",
    "upsert_confirmed_planning_assignment", "sync_validated_programme_assignments",
    "refresh_capacity_calendar", "find_available_staff", "refresh_kpi_snapshot",
    "create_or_update_mission_pbc", "inspect_pbc_checklist",
    "initialize_mission_from_template", "create_internal_followup",
    "find_drive_documents", "read_drive_document", "find_indexed_documents"
  ];
  const after = new Set([
    ...buildSpecialistTools("mission-controller", runtime).map(t => t.name),
    ...buildRootTools(runtime).map(t => t.name)
  ]);
  for (const name of before) assert.ok(after.has(name), name);

  const orp = buildSpecialistTools("orpailleur", runtime).map(t => t.name);
  for (const name of ["list_archives", "find_drive_documents", "read_drive_document", "find_indexed_documents"]) {
    assert.ok(orp.includes(name), name);
  }
});

function assertStrictSchema(schema, path = "$") {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false, `${path} additionalProperties`);
    const props = Object.keys(schema.properties || {});
    assert.deepEqual(
      [...(schema.required || [])].sort(),
      props.sort(),
      `${path} all fields must be required (nullable for optional)`
    );
  }
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === "object") assertStrictSchema(value, `${path}.${key}`);
  }
}

test("every tool schema is valid for strict Agents SDK tools", () => {
  const all = [
    ...buildRootTools(runtime),
    ...SPECIALIST_KEYS.flatMap(key => buildSpecialistTools(key, runtime))
  ];
  assert.ok(all.length > 0);
  for (const t of all) {
    assert.equal(t.strict, true, t.name);
    assertStrictSchema(t.parameters, t.name);
  }
});

test("routing hints", () => {
  assert.equal(chooseAgent("Mets à jour la PBC de la mission ABC"), "mission-controller");
  assert.equal(chooseAgent("Où en est le programme de travail ?"), "mission-controller");
  assert.equal(chooseAgent("Quels working papers manquent pour le cycle ventes ?"), "mission-controller");
  assert.equal(chooseAgent("Retrouve la dernière version du fichier"), "orpailleur");
  assert.equal(chooseAgent("Quelles factures sont impayées ?"), "sika");
  assert.equal(chooseAgent("Facture de la mission ABC"), "sika");
  assert.equal(chooseAgent("Relance le client pour le paiement"), "sika");
  assert.equal(chooseAgent("Relance PBC en retard"), "mission-controller");
  assert.equal(chooseAgent("Qui est surchargé la semaine prochaine ?"), ROOT_ROUTE);
});

test("legacy agent keys resolve safely", () => {
  assert.equal(normalizeRequestedAgent("auto"), ROOT_ROUTE);
  assert.equal(normalizeRequestedAgent(""), ROOT_ROUTE);
  assert.equal(normalizeRequestedAgent("grand-controleur"), ROOT_ROUTE);
  assert.equal(normalizeRequestedAgent("mission-controller"), "mission-controller");
  assert.equal(normalizeRequestedAgent("orpailleur"), "orpailleur");
  assert.equal(normalizeRequestedAgent("nope"), null);
  assert.equal(LEGACY_SETTING_FALLBACK["mission-controller"], "grand-controleur");
});

test("PBC lifecycle state never derives VERIFIED from flags alone", () => {
  const row = (status, received, complete) => {
    const r = new Array(19).fill("");
    r[15] = received; r[17] = complete; r[18] = status;
    return r;
  };
  assert.equal(pbcLifecycleState(row("", "Non", "Non")), "REQUESTED");
  assert.equal(pbcLifecycleState(row("", "Oui", "Non")), "PARTIAL");
  assert.equal(pbcLifecycleState(row("", "Oui", "Oui")), "RECEIVED");
  assert.equal(pbcLifecycleState(row("Vérifié", "Oui", "Oui")), "VERIFIED");
  assert.equal(pbcLifecycleState(row("Non conforme", "Oui", "Oui")), "NON_CONFORME");
  assert.equal(pbcLifecycleState(row("En revue", "Oui", "Oui")), "REVIEW");
  assert.equal(pbcLifecycleState(row("Partiel", "Oui", "Non")), "PARTIAL");
});

test("sheet dates parse ISO and French formats, reject ambiguity", () => {
  assert.equal(parseSheetDate("2026-10-01").toISOString().slice(0, 10), "2026-10-01");
  assert.equal(parseSheetDate("01/10/2026").toISOString().slice(0, 10), "2026-10-01");
  assert.equal(parseSheetDate("31/02/2026"), null);
  assert.equal(parseSheetDate("next week"), null);
  assert.equal(parseSheetDate(""), null);
});

test("PBC external reminder: only after deadline day + 24h, missing items only", () => {
  const pbc = (ref, deadline, received = "Non", status = "", applicable = "Oui") => {
    const r = new Array(19).fill("");
    r[0] = ref; r[2] = `Doc ${ref}`; r[10] = applicable;
    r[14] = deadline; r[15] = received; r[17] = received; r[18] = status;
    return r;
  };
  const rows = [
    pbc("PBC-001", "2026-10-01"),                 // overdue
    pbc("PBC-002", "2026-10-03"),                 // not yet (< end of day + 24h)
    pbc("PBC-003", "2026-10-01", "Oui"),          // received -> no reminder
    pbc("PBC-004", "2026-10-01", "Non", "", "Non"), // not applicable
    pbc("PBC-005", "le 1er octobre"),             // unparseable -> flagged
    pbc("PBC-006", "01/10/2026", "Oui", "Non conforme"), // non-conforme -> reminder
    pbc("PBC-007", "")                            // no expected date
  ];
  // deadline 2026-10-03 -> end of day 2026-10-04T00:00Z -> reminder due 2026-10-05T00:00Z
  const now = new Date("2026-10-04T23:00:00Z");
  const { overdue, unparseableDeadlines } = findOverduePbcItems(rows, now);
  assert.deepEqual(overdue.map(i => i.reference), ["PBC-001", "PBC-006"]);
  assert.deepEqual(unparseableDeadlines.map(i => i.reference), ["PBC-005"]);
  assert.equal(overdue[0].overdue_since, "2026-10-03T00:00:00.000Z");

  const later = findOverduePbcItems(rows, new Date("2026-10-05T00:00:00Z"));
  assert.ok(later.overdue.some(i => i.reference === "PBC-002"));
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "tests") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|ts|html)$/.test(name)) out.push(full);
  }
  return out;
}

test("no source still references the removed consult_grand_controleur tool", async () => {
  const root = (await import("node:url")).fileURLToPath(new URL("..", import.meta.url));
  const offenders = walk(root).filter(file =>
    readFileSync(file, "utf8").includes("consult_grand_controleur")
  );
  assert.deepEqual(offenders, []);
});
