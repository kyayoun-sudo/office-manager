// Phase 2 — offline tests of the programme -> work products -> PBC engine.
// A fake in-memory Drive replaces Google: no network, no real client file.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FOLDER_MIME,
  GOOGLE_DOC_MIME,
  GOOGLE_SHEET_MIME,
  DOCX_MIME,
  XLSX_MIME,
  TEMPLATE_READ_CHARS,
  WP_STATUS,
  applyPbcItemPlan,
  buildRequiredWorkingPapers,
  checkProgrammeState,
  classifyTemplateCandidate,
  contentFingerprint,
  decidePbcEvaluation,
  discoverTemplateLibraries,
  findPbcColumns,
  loadPbcItem,
  planHeaderPrefill,
  planPbcEvaluationWrites,
  planPbcItemApplicability,
  prefillHeader,
  programmeFingerprint,
  verifyLibraryBasis,
  writePbcEvaluation
} from "../lib/mission-engine.js";
import { findOverduePbcItems, buildSpecialistTools } from "../lib/agent-tools.js";

// ---------------------------------------------------------------------------
// Fake Drive
// ---------------------------------------------------------------------------

function fakeDrive(seed) {
  const files = new Map(seed.files.map(f => [f.id, { modifiedTime: "2026-09-01T00:00:00Z", ...f }]));
  const texts = new Map(Object.entries(seed.texts || {}));
  const sheets = seed.sheets || {};
  const copies = [];
  const writes = [];
  let counter = 0;

  return {
    files, texts, sheets, copies, writes,
    async getMeta(id) {
      const meta = files.get(id);
      if (!meta) throw new Error(`NOT_FOUND ${id}`);
      return { ...meta };
    },
    async listChildren(folderId) {
      return [...files.values()].filter(f => (f.parents || []).includes(folderId)).map(f => ({ ...f }));
    },
    async searchFiles({ query, mimeType }) {
      const q = String(query).toLowerCase();
      return [...files.values()].filter(f =>
        (!mimeType || f.mimeType === mimeType) && f.name.toLowerCase().includes(q)
      );
    },
    async readText(id, { maxChars = 30000 } = {}) {
      const meta = files.get(id);
      if (!texts.has(id)) return { supported: false, file: meta, reason: "No safe extractor" };
      const text = texts.get(id);
      return { supported: true, extractor: "fake", file: { ...meta }, text: text.slice(0, maxChars), truncated: text.length > maxChars };
    },
    async copyFile(id, name, parentId) {
      const source = files.get(id);
      counter += 1;
      const copy = { ...source, id: `copy-${counter}`, name, parents: [parentId], modifiedTime: "2026-10-05T00:00:00Z" };
      files.set(copy.id, copy);
      if (texts.has(id)) texts.set(copy.id, texts.get(id));
      if (sheets[id]) sheets[copy.id] = structuredClone(sheets[id]);
      copies.push({ from: id, to: copy.id, name, parentId });
      return { ...copy };
    },
    async getValues(id, range) {
      const sheet = sheets[id];
      if (!sheet) return [];
      if (range.startsWith("PBC_MASTER")) return sheet.pbcRows;
      return sheet.rows || [];
    },
    async getFormulaMap(id, sheetName) {
      const sheet = sheets[id];
      if (!sheet) throw new Error("NO_SHEET");
      return { sheetNames: [sheet.sheetName], sheetName: sheetName || sheet.sheetName, formulaCells: sheet.formulaCells || [] };
    },
    async updateValues(id, range, rows) {
      writes.push({ id, range, rows });
    }
  };
}

const PROGRAMME_TEXT = [
  "PROGRAMME DE TRAVAIL VALIDÉ — Mission ABC — Exercice 2025",
  "Cycle TRE — Trésorerie : Procédure TRE-01 : rapprochements bancaires au 31/12/2025 pour tous les comptes. Préparateur : A. Kone ; Reviewer : M. Diallo.",
  "Cycle VEN — Ventes : Procédure VEN-02 : test de cut-off des ventes sur les 10 derniers jours.",
  "Cycle ANA : Procédure ANA-01 : revue analytique des comptes de charges.",
  "Cycle STK : Procédure STK-01 : assister à l'inventaire physique des stocks."
].join("\n");

const BLANK_TEMPLATE_TEXT = "Client : ............\nExercice : ............\nPréparé par : [à compléter]\nRevu par : [à compléter]\nObjectif : rapprochement bancaire";

function seedDrive({ programmeName = "PROGRAMME_TRAVAIL_ABC_VALIDE", programmeText = PROGRAMME_TEXT, extraFiles = [], extraTexts = {} } = {}) {
  return fakeDrive({
    files: [
      { id: "ROOT", name: "Shared", mimeType: FOLDER_MIME, parents: [] },
      { id: "LIB", name: "06_MODELES_WORKING_PAPERS", mimeType: FOLDER_MIME, parents: ["ROOT"] },
      { id: "LIB-ARCH", name: "Archives", mimeType: FOLDER_MIME, parents: ["LIB"] },
      { id: "T1", name: "Modèle WP Trésorerie - Rapprochement bancaire", mimeType: GOOGLE_SHEET_MIME, parents: ["LIB"] },
      { id: "T2", name: "Modèle WP Ventes - Cut-off", mimeType: GOOGLE_SHEET_MIME, parents: ["LIB"] },
      { id: "T4", name: "WP Trésorerie Rapprochement bancaire ClientX 2023 final", mimeType: GOOGLE_SHEET_MIME, parents: ["LIB"] },
      { id: "T5", name: "Relevé bancaire janvier.pdf", mimeType: "application/pdf", parents: ["LIB"] },
      { id: "T6", name: "Modèle WP Trésorerie - Rapprochement bancaire", mimeType: GOOGLE_SHEET_MIME, parents: ["LIB-ARCH"] },
      { id: "T7", name: "Modèle Revue analytique A", mimeType: DOCX_MIME, parents: ["LIB"] },
      { id: "T8", name: "Modèle Revue analytique B", mimeType: DOCX_MIME, parents: ["LIB"] },
      { id: "T9", name: "Modèle Synthèse (scan)", mimeType: XLSX_MIME, parents: ["LIB"] },
      { id: "M", name: "ABC_2025", mimeType: FOLDER_MIME, parents: ["ROOT"] },
      { id: "D", name: "05_DOSSIER_TRAVAUX", mimeType: FOLDER_MIME, parents: ["M"] },
      { id: "P", name: programmeName, mimeType: GOOGLE_DOC_MIME, parents: ["M"], modifiedTime: "2026-10-01T10:00:00Z" },
      ...extraFiles
    ],
    texts: {
      P: programmeText,
      T1: BLANK_TEMPLATE_TEXT,
      T2: "Client : ....\nTest de cut-off",
      T4: "Client : SOCIETE CLIENTX SA\nPréparé par : Jean Dupont\nRapprochement bancaire 2023",
      T7: "Revue analytique - modèle A",
      T8: "Revue analytique - modèle B",
      ...extraTexts
    },
    sheets: {
      T1: {
        sheetName: "WP",
        rows: [["Client :", ""], ["Exercice", ""], ["Préparé par", "=REF!B2"], ["Revu par", ""], ["Cycle", "TRE"]],
        formulaCells: ["B3"]
      }
    }
  });
}

// What inspect_wp_template_candidates returns for a template.
async function inspected(drive, id) {
  const meta = await drive.getMeta(id);
  const read = await drive.readText(id, { maxChars: TEMPLATE_READ_CHARS });
  return {
    template_file_id: id,
    template_modified_at: meta.modifiedTime,
    template_content_fingerprint: read.supported ? contentFingerprint(meta, read.text) : null
  };
}

const TRE_REQ = {
  cycle: "TRE",
  workstream: "Trésorerie",
  procedure: "TRE-01 rapprochements bancaires",
  required_wp_type: "Rapprochement bancaire",
  wp_code: null,
  template_reference: null,
  template_file_id: null,
  preparer: "A. Kone",
  reviewer: "M. Diallo",
  source_evidence: { excerpt: "Procédure TRE-01 : rapprochements bancaires au 31/12/2025 pour tous les comptes", location: "Cycle TRE" }
};

async function treReq(drive, id = "T1") {
  return { ...TRE_REQ, ...(await inspected(drive, id)) };
}

async function analysedInput(drive, overrides = {}) {
  const meta = await drive.getMeta("P");
  const read = await drive.readText("P", { maxChars: 60000 });
  return {
    mission_id: "MIS-ABC",
    mission_type: "AUDIT",
    mission_reference: "ABC25",
    mission_name: "Audit ABC 2025",
    client: "ABC SA",
    period: "Exercice 2025",
    programme_file_id: "P",
    programme_modified_at: meta.modifiedTime,
    programme_fingerprint: programmeFingerprint(meta, read.text),
    programme_validated_confirmed: true,
    template_library_folder_id: "LIB",
    library_basis: "CONFIGURED",
    library_confirmation_note: null,
    mission_root_folder_id: "M",
    destination_folder_id: "D",
    dry_run: false,
    prefill_headers: false,
    prefill_prepared_date: false,
    requirements: [await treReq(drive)],
    ...overrides
  };
}

const opts = { configuredLibraryId: "LIB", now: new Date("2026-10-05T12:00:00Z") };

// ---------------------------------------------------------------------------
// Programme gating
// ---------------------------------------------------------------------------

test("a validated programme is required", async () => {
  const drive = seedDrive();
  const r1 = await buildRequiredWorkingPapers(drive, await analysedInput(drive, { programme_validated_confirmed: false }), opts);
  assert.equal(r1.status, "VALIDATION_REQUIRED");

  const draft = seedDrive({ programmeName: "PROGRAMME_TRAVAIL_ABC_A_VALIDER" });
  const r2 = await buildRequiredWorkingPapers(draft, await analysedInput(draft), opts);
  assert.equal(r2.status, "VALIDATION_CONFLICT");

  const noRef = await buildRequiredWorkingPapers(drive, { ...(await analysedInput(drive)), programme_fingerprint: null }, opts);
  assert.equal(noRef.status, "ANALYSIS_REFERENCE_REQUIRED");
  assert.equal(drive.copies.length + draft.copies.length, 0);
});

test("programme changed between analysis and execution blocks everything", async () => {
  const drive = seedDrive();
  const input = await analysedInput(drive);
  drive.files.get("P").modifiedTime = "2026-10-04T09:00:00Z";
  const r1 = await buildRequiredWorkingPapers(drive, input, opts);
  assert.equal(r1.status, "PROGRAMME_CHANGED");

  const drive2 = seedDrive();
  const input2 = await analysedInput(drive2);
  drive2.texts.set("P", PROGRAMME_TEXT + "\nProcédure ajoutée.");
  const r2 = await buildRequiredWorkingPapers(drive2, input2, opts);
  assert.equal(r2.status, "PROGRAMME_CHANGED");
  assert.equal(drive.copies.length + drive2.copies.length, 0);
});

test("truncated programme: state PROGRAMME_TRUNCATED_REVIEW_REQUIRED, generation blocked", async () => {
  const longText = PROGRAMME_TEXT + "\n" + "Procédure détaillée complémentaire. ".repeat(3000);
  assert.ok(longText.length > 60000);
  const drive = seedDrive({ programmeText: longText });
  const meta = await drive.getMeta("P");
  const read = await drive.readText("P", { maxChars: 60000 });
  assert.equal(read.truncated, true);

  const state = checkProgrammeState({ meta, read, validatedConfirmed: true });
  assert.equal(state.ok, false);
  assert.equal(state.status, "PROGRAMME_TRUNCATED_REVIEW_REQUIRED");

  const built = await buildRequiredWorkingPapers(drive, await analysedInput(drive), opts);
  assert.equal(built.status, "PROGRAMME_TRUNCATED_REVIEW_REQUIRED");
  assert.equal(drive.copies.length, 0);
});

// ---------------------------------------------------------------------------
// Work products — the AI decides the template, the engine verifies
// ---------------------------------------------------------------------------

test("only the work products required by the programme are created", async () => {
  const drive = seedDrive();
  const result = await buildRequiredWorkingPapers(drive, await analysedInput(drive), opts);
  assert.equal(result.status, "COMPLETED");
  assert.equal(drive.copies.length, 1, "exactly one copy for one requirement");
  const [item] = result.work_products;
  assert.equal(item.status, WP_STATUS.CREATED);
  assert.equal(item.template.file_id, "T1");
  assert.equal(item.template.selection_basis, "AGENT_SELECTED_REVALIDATED");
  assert.equal(drive.copies[0].parentId, "D");
  assert.equal(item.programme_file_id, "P");
  assert.match(item.source_evidence.excerpt, /TRE-01/);
});

test("template_file_id absent: no automatic copy even with a unique scoring candidate", async () => {
  const drive = seedDrive();
  const result = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    requirements: [{ ...TRE_REQ }] // "Rapprochement bancaire" matches only T1 among eligible files
  }), opts);
  const [item] = result.work_products;
  assert.equal(item.status, WP_STATUS.REVIEW_REQUIRED);
  assert.equal(item.reason, "TEMPLATE_SELECTION_REQUIRED");
  assert.equal(item.template_candidates.length, 1, "unique suggestion");
  assert.equal(item.template_candidates[0].id, "T1");
  assert.equal(drive.copies.length, 0);
});

test("explicit template without inspection reference -> REVIEW_REQUIRED", async () => {
  const drive = seedDrive();
  const r = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    requirements: [{ ...TRE_REQ, template_file_id: "T1" }]
  }), opts);
  assert.equal(r.work_products[0].reason, "TEMPLATE_INSPECTION_REFERENCE_REQUIRED");
  assert.equal(drive.copies.length, 0);
});

test("explicit template modified after inspection -> REVIEW_REQUIRED", async () => {
  const drive = seedDrive();
  const input = await analysedInput(drive);
  drive.files.get("T1").modifiedTime = "2026-10-05T08:00:00Z";
  const r1 = await buildRequiredWorkingPapers(drive, input, opts);
  assert.equal(r1.work_products[0].status, WP_STATUS.REVIEW_REQUIRED);
  assert.equal(r1.work_products[0].reason, "TEMPLATE_CHANGED_SINCE_INSPECTION");

  const drive2 = seedDrive();
  const input2 = await analysedInput(drive2);
  drive2.texts.set("T1", BLANK_TEMPLATE_TEXT + "\nLigne ajoutée");
  const r2 = await buildRequiredWorkingPapers(drive2, input2, opts);
  assert.equal(r2.work_products[0].reason, "TEMPLATE_CONTENT_CHANGED_SINCE_INSPECTION");
  assert.equal(drive.copies.length + drive2.copies.length, 0);
});

test("explicit template that became client-completed -> REVIEW_REQUIRED", async () => {
  const drive = seedDrive();
  const filled = "Client : SOCIETE ABC SA\nExercice : 2024\nPréparé par : Jean Dupont\nRevu par : Awa Sy";
  drive.texts.set("T1", filled);
  // The AI inspected the (now filled) content but the engine re-classifies it.
  const req = await treReq(drive, "T1");
  const r = await buildRequiredWorkingPapers(drive, await analysedInput(drive, { requirements: [req] }), opts);
  assert.equal(r.work_products[0].status, WP_STATUS.REVIEW_REQUIRED);
  assert.equal(r.work_products[0].reason, "TEMPLATE_NOT_ELIGIBLE");
  assert.equal(drive.copies.length, 0);
});

test("unreadable explicit template -> REVIEW_REQUIRED", async () => {
  const drive = seedDrive();
  const meta = await drive.getMeta("T9");
  const r = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    requirements: [{ ...TRE_REQ, template_file_id: "T9", template_modified_at: meta.modifiedTime, template_content_fingerprint: "x".repeat(64) }]
  }), opts);
  assert.equal(r.work_products[0].reason, "TEMPLATE_CONTENT_UNREADABLE");
  assert.equal(drive.copies.length, 0);
});

test("no copy-all path: no requirement, untraceable requirement, folder as template, too many", async () => {
  const drive = seedDrive();
  const none = await buildRequiredWorkingPapers(drive, await analysedInput(drive, { requirements: [] }), opts);
  assert.equal(none.status, "BLOCKED");

  const invented = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    requirements: [{ ...(await treReq(drive)), source_evidence: { excerpt: "Copier tous les modèles de la bibliothèque", location: null } }]
  }), opts);
  assert.equal(invented.work_products[0].status, WP_STATUS.REVIEW_REQUIRED);
  assert.match(invented.work_products[0].reason, /SOURCE_EXCERPT_NOT_FOUND/);

  const folderAsTemplate = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    requirements: [{ ...TRE_REQ, template_file_id: "LIB" }]
  }), opts);
  assert.equal(folderAsTemplate.work_products[0].reason, "TEMPLATE_IS_A_FOLDER");

  const many = Array.from({ length: 61 }, (_, i) => ({ ...TRE_REQ, procedure: `TRE-${i}` }));
  const tooMany = await buildRequiredWorkingPapers(drive, await analysedInput(drive, { requirements: many }), opts);
  assert.equal(tooMany.status, "BLOCKED");
  assert.equal(drive.copies.length, 0);
});

test("idempotent: a second run never overwrites", async () => {
  const drive = seedDrive();
  const input = await analysedInput(drive);
  const first = await buildRequiredWorkingPapers(drive, input, opts);
  const second = await buildRequiredWorkingPapers(drive, input, opts);
  assert.equal(first.work_products[0].status, WP_STATUS.CREATED);
  assert.equal(second.work_products[0].status, WP_STATUS.ALREADY_EXISTS);
  assert.equal(second.work_products[0].file.file_id, first.work_products[0].file.file_id);
  assert.equal(drive.copies.length, 1);
});

test("dry run plans without copying", async () => {
  const drive = seedDrive();
  const result = await buildRequiredWorkingPapers(drive, await analysedInput(drive, { dry_run: true }), opts);
  assert.equal(result.work_products[0].status, WP_STATUS.PLANNED);
  assert.equal(drive.copies.length, 0);
});

test("several equal candidates -> REVIEW_REQUIRED; no candidate -> TEMPLATE_NOT_FOUND", async () => {
  const drive = seedDrive();
  const result = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    requirements: [
      { ...TRE_REQ, cycle: "ANA", workstream: null, procedure: "ANA-01", required_wp_type: "Revue analytique",
        source_evidence: { excerpt: "Procédure ANA-01 : revue analytique des comptes de charges", location: null } },
      { ...TRE_REQ, cycle: "STK", workstream: null, procedure: "STK-01", required_wp_type: "Inventaire physique",
        source_evidence: { excerpt: "assister à l'inventaire physique des stocks", location: null } }
    ]
  }), opts);
  const [ana, stk] = result.work_products;
  assert.equal(ana.status, WP_STATUS.REVIEW_REQUIRED);
  assert.ok(ana.template_candidates.length >= 2);
  assert.equal(stk.status, WP_STATUS.TEMPLATE_NOT_FOUND);
  assert.equal(drive.copies.length, 0);
});

test("an old completed client WP is never used as a template", async () => {
  assert.equal(
    classifyTemplateCandidate({ file: { name: "WP Trésorerie ClientX 2023 final", mimeType: GOOGLE_SHEET_MIME } }).classification,
    "COMPLETED_WP_SUSPECTED"
  );
  assert.equal(
    classifyTemplateCandidate({ file: { name: "PremierFood_SalesAR_Audit_WP_2026.xlsx", mimeType: XLSX_MIME } }).classification,
    "COMPLETED_WP_SUSPECTED"
  );
  assert.equal(
    classifyTemplateCandidate({ file: { name: "Relevé bancaire janvier.pdf", mimeType: "application/pdf" } }).classification,
    "SUPPORTING_DOCUMENT"
  );
  assert.equal(
    classifyTemplateCandidate({ file: { name: "Modèle WP Caisse", mimeType: GOOGLE_SHEET_MIME }, excerpt: BLANK_TEMPLATE_TEXT }).classification,
    "TEMPLATE_LIKELY"
  );

  const drive = seedDrive();
  const forced = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    requirements: [await treReq(drive, "T4")]
  }), opts);
  assert.equal(forced.work_products[0].status, WP_STATUS.REVIEW_REQUIRED);
  assert.equal(forced.work_products[0].reason, "TEMPLATE_NOT_ELIGIBLE");
  assert.equal(drive.copies.length, 0);
});

test("destination must be inside the mission and outside the library", async () => {
  const drive = seedDrive();
  const r = await buildRequiredWorkingPapers(drive, await analysedInput(drive, { destination_folder_id: "LIB" }), opts);
  assert.equal(r.status, "DESTINATION_INVALID");
  assert.equal(drive.copies.length, 0);
});

test("works for non-audit mission types", async () => {
  const drive = seedDrive();
  const r = await buildRequiredWorkingPapers(drive, await analysedInput(drive, { mission_type: "DUE_DILIGENCE" }), opts);
  assert.equal(r.work_products[0].status, WP_STATUS.CREATED);
  assert.equal(r.work_products[0].requirement.mission_type, "DUE_DILIGENCE");
});

// ---------------------------------------------------------------------------
// Template library
// ---------------------------------------------------------------------------

test("USER_CONFIRMED is not executable: OWNER_APPROVAL_MEMORY_REQUIRED, nothing copied", async () => {
  const drive = seedDrive();
  const basis = await verifyLibraryBasis(drive, {
    libraryFolderId: "LIB", basis: "USER_CONFIRMED", confirmationNote: "The owner said this is the right library."
  });
  assert.deepEqual(basis, { ok: false, reason: "OWNER_APPROVAL_MEMORY_REQUIRED" });

  const built = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    library_basis: "USER_CONFIRMED",
    library_confirmation_note: "The owner said this is the right library."
  }), opts);
  assert.equal(built.status, "OWNER_APPROVAL_MEMORY_REQUIRED");
  assert.equal(drive.copies.length, 0);
});

test("template library: discovered, never chosen arbitrarily when ambiguous", async () => {
  const drive = seedDrive();
  const single = await discoverTemplateLibraries(drive, {});
  assert.equal(single.status, "SINGLE_CANDIDATE");
  assert.equal(single.selected.id, "LIB");

  const two = seedDrive({
    extraFiles: [
      { id: "LIB2", name: "Templates WP 2024", mimeType: FOLDER_MIME, parents: ["ROOT"] },
      { id: "L2A", name: "Modèle Lead schedule", mimeType: GOOGLE_SHEET_MIME, parents: ["LIB2"] },
      { id: "L2B", name: "Modèle Revue fiscale", mimeType: GOOGLE_SHEET_MIME, parents: ["LIB2"] },
      { id: "L2C", name: "Modèle Synthèse", mimeType: GOOGLE_SHEET_MIME, parents: ["LIB2"] }
    ]
  });
  const ambiguous = await discoverTemplateLibraries(two, {});
  assert.equal(ambiguous.status, "AMBIGUOUS");
  assert.equal(ambiguous.selected, null);

  const blocked = await buildRequiredWorkingPapers(two, await analysedInput(two, { library_basis: "SINGLE_CANDIDATE" }), { now: opts.now });
  assert.equal(blocked.status, "LIBRARY_REVIEW_REQUIRED");
  assert.equal(two.copies.length, 0);
});

test("pilot-like Drive (03 / 05 / 03 tests / 06 working files) -> AMBIGUOUS, 06 never auto-selected", async () => {
  const drive = fakeDrive({
    files: [
      { id: "ROOT", name: "Shared", mimeType: FOLDER_MIME, parents: [] },
      { id: "F03", name: "03_WORKING_PAPER_TEMPLATES", mimeType: FOLDER_MIME, parents: ["ROOT"] },
      { id: "F03a", name: "Modèle Lead schedule", mimeType: GOOGLE_SHEET_MIME, parents: ["F03"] },
      { id: "F03b", name: "Modèle Rapprochement bancaire", mimeType: GOOGLE_SHEET_MIME, parents: ["F03"] },
      { id: "F03c", name: "Modèle Cut-off ventes", mimeType: GOOGLE_SHEET_MIME, parents: ["F03"] },
      { id: "F05", name: "05_WORKING_PAPERS_CYCLES_SELECTIONNES", mimeType: FOLDER_MIME, parents: ["ROOT"] },
      { id: "F05a", name: "VEN", mimeType: FOLDER_MIME, parents: ["F05"] },
      { id: "F05b", name: "TRE", mimeType: FOLDER_MIME, parents: ["F05"] },
      { id: "F03T", name: "03_WORKING_PAPERS_TESTS", mimeType: FOLDER_MIME, parents: ["ROOT"] },
      { id: "F06", name: "06 Working files par cycle", mimeType: FOLDER_MIME, parents: ["ROOT"] },
      { id: "F06a", name: "Ventes", mimeType: FOLDER_MIME, parents: ["F06"] },
      { id: "F06b", name: "Trésorerie", mimeType: FOLDER_MIME, parents: ["F06"] },
      { id: "F06c", name: "Supporting documents", mimeType: FOLDER_MIME, parents: ["F06"] },
      { id: "F06d", name: "PremierFood_SalesAR_Audit_WP_2026.xlsx", mimeType: XLSX_MIME, parents: ["F06"] }
    ]
  });
  const discovery = await discoverTemplateLibraries(drive, {});
  assert.equal(discovery.status, "AMBIGUOUS");
  assert.equal(discovery.selected, null);
  const f06 = discovery.candidates.find(c => c.folder.id === "F06");
  assert.ok(f06, "06 is listed as a candidate");
  assert.ok(f06.stats.completed_suspected >= 1);
  assert.ok(f06.stats.supporting_subfolders >= 1);
  for (const id of ["F03", "F05", "F03T"]) {
    assert.ok(discovery.candidates.some(c => c.folder.id === id), `${id} reported as a rival`);
  }
  assert.equal(drive.copies.length + drive.writes.length, 0);
});

// ---------------------------------------------------------------------------
// Header pre-fill
// ---------------------------------------------------------------------------

test("header pre-fill: label-based, never over a formula, never claimed on unsupported formats", async () => {
  const plan = planHeaderPrefill(
    [["Client :", ""], ["Préparé par", "=x"], ["Revu par", "Déjà rempli"]],
    ["B2"],
    { client: "ABC SA", preparer: "A. Kone", reviewer: "M. Diallo", cycle: "TRE" }
  );
  assert.deepEqual(plan.writes.map(w => w.cell), ["B1"]);
  assert.deepEqual(plan.review.map(r => r.reason).sort(), ["TARGET_IS_FORMULA", "TARGET_NOT_EMPTY"]);

  const ambiguous = planHeaderPrefill([["Client", ""], ["Client", ""]], [], { client: "ABC" });
  assert.equal(ambiguous.review[0].reason, "LABEL_AMBIGUOUS");

  const drive = seedDrive();
  const docx = await prefillHeader(drive, { id: "T7", mimeType: DOCX_MIME }, { client: "ABC" });
  assert.equal(docx.status, "PREFILL_NOT_SUPPORTED_FOR_FORMAT");
  assert.equal(drive.writes.length, 0);

  const built = await buildRequiredWorkingPapers(drive, await analysedInput(drive, { prefill_headers: true }), opts);
  assert.equal(built.work_products[0].prefill.status, "HEADER_PREFILL_REVIEW_REQUIRED");
  assert.equal(drive.writes.length, 0);
});

// ---------------------------------------------------------------------------
// Real pilot PBC_MASTER header (row 4) — regression guard
// ---------------------------------------------------------------------------

const REAL_PBC_HEADER = [
  "Référence PBC", "Dossier maître", "Document demandé", "Type de document",
  "Cycles utilisateurs", "Procédures utilisatrices", "Moment de la demande",
  "Critère de complétude", "Critique", "Applicabilité (forcer)", "Applicable",
  "Responsable client", "Responsable audit", "Date de demande", "Échéance",
  "Reçu ?", "Date réception", "Complet ?", "Statut automatique", "Jours de retard",
  "Nb relances", "Date dernière relance", "Lien Drive", "Ouvrir", "Commentaire",
  "Source (Manuel / ISA / SYSCOHADA)", "Contrôle doublon", "Rang critique manquant"
];
// Formula / derived columns of the real master: K, S, T, X, AA, AB.
const DERIVED = ["K", "S", "T", "X", "AA", "AB"];
const READ_ONLY_COLUMNS = ["K", "S", "T", "X", "AA", "AB"];

function realRow(ref, cycles, overrides = {}) {
  const row = new Array(28).fill("");
  row[0] = ref; row[2] = `Doc ${ref}`; row[4] = cycles; row[10] = "Oui"; row[18] = "En attente";
  row[23] = "Ouvrir"; row[24] = overrides.comment || "";
  if (overrides.link) row[22] = overrides.link;
  return row;
}

function realSheet(rows, extraFormulaCells = []) {
  const formulaCells = [];
  for (let r = 5; r <= 4 + rows.length - 1; r += 1) {
    for (const col of DERIVED) formulaCells.push(`${col}${r}`);
  }
  return { sheetName: "PBC_MASTER", pbcRows: rows, formulaCells: [...formulaCells, ...extraFormulaCells] };
}

function writtenColumns(drive) {
  return drive.writes.map(w => w.range.replace(/^PBC_MASTER!/, "").replace(/\d+$/, ""));
}

test("real PBC header: roles mapped exactly; J is the override, K/S/X are read-only outputs", () => {
  const { columns, ambiguous, missing } = findPbcColumns(REAL_PBC_HEADER);
  assert.deepEqual(ambiguous, {});
  assert.deepEqual(missing, []);
  assert.equal(columns.applicability_override, 9); // J
  assert.equal(columns.effective_applicable, 10); // K
  assert.equal(columns.received, 15); // P
  assert.equal(columns.received_date, 16); // Q
  assert.equal(columns.complete, 17); // R
  assert.equal(columns.auto_status, 18); // S
  assert.equal(columns.drive_link, 22); // W
  assert.equal(columns.open_link, 23); // X
  assert.equal(columns.comment, 24); // Y
});

test("real PBC header: fine applicability writes J only, never K/S/X", async () => {
  const rows = [REAL_PBC_HEADER, realRow("PBC-001", "TRE"), realRow("PBC-002", "TRE")];
  const plan = planPbcItemApplicability({
    rows,
    retainedCycles: ["TRE"],
    programmeText: PROGRAMME_TEXT,
    decisions: [
      { pbc_reference: "PBC-001", applicable: true, programme_procedure: "TRE-01", source_evidence_excerpt: "rapprochements bancaires au 31/12/2025" },
      { pbc_reference: "PBC-002", applicable: false, programme_procedure: "Only TRE-01 retained", source_evidence_excerpt: "rapprochements bancaires au 31/12/2025" }
    ]
  });
  const drive = fakeDrive({ files: [], sheets: { S: realSheet(rows) } });
  const applied = await applyPbcItemPlan(drive, "S", plan);
  assert.deepEqual(applied.map(a => a.status), ["APPLIED", "APPLIED"]);
  assert.ok(drive.writes.some(w => w.range === "PBC_MASTER!J5" && w.rows[0][0] === "Oui"));
  assert.ok(drive.writes.some(w => w.range === "PBC_MASTER!J6" && w.rows[0][0] === "Non"));
  for (const col of writtenColumns(drive)) {
    assert.ok(!READ_ONLY_COLUMNS.includes(col), `never writes ${col}`);
  }

  // If J itself holds a formula -> review, nothing written.
  const drive2 = fakeDrive({ files: [], sheets: { S: realSheet(rows, ["J5"]) } });
  const applied2 = await applyPbcItemPlan(drive2, "S", plan.slice(0, 1));
  assert.equal(applied2[0].status, "ITEM_OVERRIDE_REVIEW_REQUIRED");
  assert.ok(!drive2.writes.some(w => w.range === "PBC_MASTER!J5"));
});

test("PBC applicability refined by programme procedures, never invented", () => {
  const rows = [REAL_PBC_HEADER, realRow("PBC-001", "TRE"), realRow("PBC-010", "STK")];
  const plan = planPbcItemApplicability({
    rows,
    retainedCycles: ["TRE", "VEN"],
    programmeText: PROGRAMME_TEXT,
    decisions: [
      { pbc_reference: "PBC-001", applicable: true, programme_procedure: "TRE-01", source_evidence_excerpt: "rapprochements bancaires au 31/12/2025" },
      { pbc_reference: "PBC-010", applicable: true, programme_procedure: "STK", source_evidence_excerpt: "inventaire physique des stocks" },
      { pbc_reference: "PBC-999", applicable: true, programme_procedure: "?", source_evidence_excerpt: "rapprochements bancaires au 31/12/2025" },
      { pbc_reference: "PBC-001", applicable: true, programme_procedure: "x", source_evidence_excerpt: "texte qui n'existe pas dans le programme" }
    ]
  });
  assert.deepEqual(plan.map(p => p.status), [
    "PLANNED", "REJECTED_CYCLE_NOT_RETAINED", "REJECTED_UNKNOWN_REFERENCE", "REJECTED_SOURCE_NOT_IN_PROGRAMME"
  ]);
  assert.equal(plan[0].row_number, 5);
});

// ---------------------------------------------------------------------------
// PBC evidence evaluation
// ---------------------------------------------------------------------------

const EVIDENCE_META = { id: "E1", name: "Bank Statements 2025", modifiedTime: "2026-03-01T00:00:00Z", mimeType: GOOGLE_DOC_MIME, webViewLink: "https://drive/E1" };
const EVIDENCE_TEXT = "Relevés BANQUE ATLANTIQUE compte 0123 — ABC SA — janvier à juin 2025";
const ALL_MATCH = { client: "MATCH", mission: "MATCH", scope_account: "MATCH", period: "MATCH", completeness: "MATCH", document_nature: "MATCH" };
const readOk = { supported: true, text: EVIDENCE_TEXT, truncated: false, file: EVIDENCE_META };
const FP = contentFingerprint(EVIDENCE_META, EVIDENCE_TEXT);
const RATIONALE = "Statements of account 0123 for ABC SA read and compared with the request.";

test("RECEIVED without content_fingerprint / real read -> REVIEW", () => {
  const base = {
    proposed: "RECEIVED",
    checks: { ...ALL_MATCH, completeness: "NOT_CHECKED" },
    rationale: RATIONALE,
    evidenceMeta: EVIDENCE_META,
    analysedModifiedTime: EVIDENCE_META.modifiedTime
  };
  assert.deepEqual(decidePbcEvaluation({ ...base, analysedFingerprint: null, read: readOk }).reasons, ["NO_PROOF_OF_CONTENT_READ"]);
  assert.deepEqual(decidePbcEvaluation({ ...base, analysedFingerprint: FP, read: { supported: false } }).reasons, ["EXTRACTOR_REQUIRED"]);
  assert.deepEqual(decidePbcEvaluation({ ...base, analysedFingerprint: FP, read: null }).reasons, ["EXTRACTOR_REQUIRED"]);
  assert.deepEqual(decidePbcEvaluation({ ...base, analysedFingerprint: "forged", read: readOk }).reasons, ["CONTENT_FINGERPRINT_MISMATCH"]);
  assert.deepEqual(decidePbcEvaluation({ ...base, analysedFingerprint: FP, analysedModifiedTime: null, read: readOk }).reasons, ["EVIDENCE_CHANGED_SINCE_ANALYSIS"]);
  assert.deepEqual(decidePbcEvaluation({ ...base, evidenceMeta: null, analysedFingerprint: FP, read: readOk }).reasons, ["EVIDENCE_FILE_NOT_FOUND"]);
  for (const outcome of [
    decidePbcEvaluation({ ...base, analysedFingerprint: null, read: readOk }),
    decidePbcEvaluation({ ...base, analysedFingerprint: FP, read: { supported: false } })
  ]) assert.equal(outcome.final_state, "REVIEW");
});

test("RECEIVED with a real read and correct nature is allowed, never auto-VERIFIED", () => {
  const ok = decidePbcEvaluation({
    proposed: "RECEIVED",
    checks: { ...ALL_MATCH, completeness: "NOT_CHECKED" },
    rationale: RATIONALE,
    evidenceMeta: EVIDENCE_META,
    analysedModifiedTime: EVIDENCE_META.modifiedTime,
    analysedFingerprint: FP,
    read: readOk
  });
  assert.equal(ok.final_state, "RECEIVED");

  const wrongNature = decidePbcEvaluation({
    proposed: "RECEIVED",
    checks: { ...ALL_MATCH, document_nature: "MISMATCH" },
    rationale: RATIONALE,
    evidenceMeta: EVIDENCE_META,
    analysedModifiedTime: EVIDENCE_META.modifiedTime,
    analysedFingerprint: FP,
    read: readOk
  });
  assert.equal(wrongNature.final_state, "REVIEW");

  const wrongClient = decidePbcEvaluation({
    proposed: "RECEIVED",
    checks: { ...ALL_MATCH, client: "MISMATCH" },
    rationale: RATIONALE,
    evidenceMeta: EVIDENCE_META,
    analysedModifiedTime: EVIDENCE_META.modifiedTime,
    analysedFingerprint: FP,
    read: readOk
  });
  assert.equal(wrongClient.final_state, "REVIEW");

  const plan = planPbcEvaluationWrites(findPbcColumns(REAL_PBC_HEADER).columns, realRow("PBC-001", "TRE"), {
    final_state: "RECEIVED", evidence_url: EVIDENCE_META.webViewLink, evidence_file_id: "E1",
    evidence_name: EVIDENCE_META.name, content_fingerprint: FP, rationale: RATIONALE,
    evaluated_at: "2026-10-05T12:00:00Z", received_date: "2026-10-03"
  });
  const roles = plan.writes.map(w => w.key);
  assert.ok(roles.includes("received"));
  assert.ok(!roles.includes("complete"), "completeness not validated: R untouched");
  assert.equal(plan.writes.find(w => w.key === "received").value, "Oui");
});

test("right file name but incomplete period is never VERIFIED", () => {
  const d = decidePbcEvaluation({
    proposed: "VERIFIED",
    checks: { ...ALL_MATCH, period: "PARTIAL", completeness: "PARTIAL" },
    rationale: "Only January to June 2025 statements, July-December missing.",
    evidenceMeta: EVIDENCE_META,
    analysedModifiedTime: EVIDENCE_META.modifiedTime,
    analysedFingerprint: FP,
    read: readOk
  });
  assert.equal(d.final_state, "REVIEW");

  const partial = decidePbcEvaluation({
    proposed: "PARTIAL",
    checks: { ...ALL_MATCH, period: "PARTIAL", completeness: "PARTIAL" },
    rationale: "Only January to June 2025 statements, July-December missing.",
    evidenceMeta: EVIDENCE_META,
    analysedModifiedTime: EVIDENCE_META.modifiedTime,
    analysedFingerprint: FP,
    read: readOk
  });
  assert.equal(partial.final_state, "PARTIAL");
});

test("unreadable format -> REVIEW / EXTRACTOR_REQUIRED, never VERIFIED", () => {
  const d = decidePbcEvaluation({
    proposed: "VERIFIED",
    checks: ALL_MATCH,
    rationale: "Looks complete according to the file name.",
    evidenceMeta: { ...EVIDENCE_META, mimeType: "application/pdf" },
    analysedModifiedTime: EVIDENCE_META.modifiedTime,
    analysedFingerprint: "anything",
    read: { supported: false, reason: "No safe extractor" }
  });
  assert.equal(d.final_state, "REVIEW");
  assert.deepEqual(d.reasons, ["EXTRACTOR_REQUIRED"]);
});

test("VERIFIED requires proof of a real, complete, unchanged read", () => {
  const base = {
    proposed: "VERIFIED",
    checks: ALL_MATCH,
    rationale: "All twelve monthly statements of account 0123 for ABC SA, Jan-Dec 2025.",
    evidenceMeta: EVIDENCE_META,
    analysedModifiedTime: EVIDENCE_META.modifiedTime,
    read: readOk
  };
  assert.equal(decidePbcEvaluation({ ...base, analysedFingerprint: null }).reasons.at(-1), "NO_PROOF_OF_CONTENT_READ");
  assert.equal(decidePbcEvaluation({ ...base, analysedFingerprint: "forged" }).reasons.at(-1), "CONTENT_FINGERPRINT_MISMATCH");
  assert.equal(
    decidePbcEvaluation({ ...base, analysedFingerprint: FP, read: { ...readOk, truncated: true } }).reasons.at(-1),
    "CONTENT_TRUNCATED_NOT_FULLY_READ"
  );
  assert.equal(
    decidePbcEvaluation({ ...base, analysedFingerprint: FP, analysedModifiedTime: "2025-01-01T00:00:00Z" }).reasons.at(-1),
    "EVIDENCE_CHANGED_SINCE_ANALYSIS"
  );
  assert.equal(decidePbcEvaluation({ ...base, analysedFingerprint: FP }).final_state, "VERIFIED");
});

async function writeEval(state, rowOverrides = {}) {
  const rows = [REAL_PBC_HEADER, realRow("PBC-001", "TRE", rowOverrides)];
  const drive = fakeDrive({ files: [], sheets: { S: realSheet(rows) } });
  const item = await loadPbcItem(drive, "S", "PBC-001");
  const out = await writePbcEvaluation(drive, "S", item, {
    final_state: state, evidence_url: EVIDENCE_META.webViewLink, evidence_file_id: "E1",
    evidence_name: EVIDENCE_META.name, content_fingerprint: FP, rationale: RATIONALE,
    evaluated_at: "2026-10-05T12:00:00Z", received_date: "2026-10-03"
  });
  const byCol = Object.fromEntries(drive.writes.map(w => [w.range.replace(/^PBC_MASTER!/, "").replace(/\d+$/, ""), w.rows[0][0]]));
  return { out, drive, byCol };
}

test("real header: evaluation writes manual P/Q/R/W/Y only, never S (or K/X/T/AA/AB)", async () => {
  const verified = await writeEval("VERIFIED");
  assert.equal(verified.out.status, "WRITTEN");
  assert.equal(verified.byCol.P, "Oui");
  assert.equal(verified.byCol.R, "Oui");
  assert.equal(verified.byCol.Q, "2026-10-03");
  assert.equal(verified.byCol.W, "https://drive/E1");
  assert.match(verified.byCol.Y, /VERIFIED/);

  const partial = await writeEval("PARTIAL");
  assert.equal(partial.byCol.P, "Partiel");
  assert.equal(partial.byCol.R, "Non");

  const received = await writeEval("RECEIVED");
  assert.equal(received.byCol.P, "Oui");
  assert.equal(received.byCol.R, undefined);

  const nonConforme = await writeEval("NON_CONFORME");
  assert.equal(nonConforme.out.checklist_status_limitation, "CHECKLIST_STATUS_LIMITATION");
  assert.equal(nonConforme.out.status, "CHECKLIST_STATUS_LIMITATION");
  assert.deepEqual(Object.keys(nonConforme.byCol), ["Y"]);
  assert.match(nonConforme.byCol.Y, /NON_CONFORME/);

  const review = await writeEval("REVIEW");
  assert.deepEqual(Object.keys(review.byCol), ["Y"]);

  for (const run of [verified, partial, received, nonConforme, review]) {
    for (const col of writtenColumns(run.drive)) {
      assert.ok(!READ_ONLY_COLUMNS.includes(col), `never writes ${col}`);
    }
  }
});

test("evaluation keeps human data: existing link kept, comment appended, idempotent", async () => {
  const { byCol, out } = await writeEval("VERIFIED", { link: "https://drive/OTHER", comment: "Note de l'auditeur" });
  assert.equal(byCol.W, undefined, "existing different link is not overwritten");
  assert.deepEqual(out.kept.map(k => k.role), ["drive_link"]);
  assert.match(byCol.Y, /^Note de l'auditeur\n\[OM-AI VERIFIED/);

  const again = await writeEval("VERIFIED", { comment: byCol.Y });
  assert.equal(again.byCol.Y, undefined, "same marker already present: comment not duplicated");
});

// ---------------------------------------------------------------------------
// Reminders keep working, PARTIAL / NON_CONFORME included
// ---------------------------------------------------------------------------

test("PBC reminder still works and keeps PARTIAL / NON_CONFORME remindable", () => {
  const row = (ref, received, complete, status) => {
    const r = new Array(19).fill("");
    r[0] = ref; r[10] = "Oui"; r[14] = "2026-10-01"; r[15] = received; r[17] = complete; r[18] = status;
    return r;
  };
  const { overdue } = findOverduePbcItems(
    [
      row("PBC-1", "Non", "Non", ""),
      row("PBC-2", "Partiel", "Non", ""), // manual "Reçu ? = Partiel"
      row("PBC-3", "Oui", "Oui", "Non conforme"),
      row("PBC-4", "Oui", "Oui", "Vérifié")
    ],
    new Date("2026-10-05T00:00:00Z")
  );
  assert.deepEqual(overdue.map(i => [i.reference, i.lifecycle_state]), [
    ["PBC-1", "REQUESTED"], ["PBC-2", "PARTIAL"], ["PBC-3", "NON_CONFORME"]
  ]);
});

test("Mission Controller exposes the phase-2 tools", () => {
  const names = buildSpecialistTools("mission-controller", { orgId: "x", runId: null }).map(t => t.name);
  for (const name of [
    "analyze_work_programme",
    "discover_wp_template_libraries",
    "inspect_wp_template_candidates",
    "build_required_working_papers",
    "load_pbc_item",
    "record_pbc_evidence_evaluation",
    "create_or_update_mission_pbc",
    "detect_overdue_pbc_reminders"
  ]) {
    assert.ok(names.includes(name), name);
  }
});
