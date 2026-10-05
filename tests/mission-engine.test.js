// Phase 2 — offline tests of the programme -> work products -> PBC engine.
// A fake in-memory Drive replaces Google: no network, no real client file.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FOLDER_MIME,
  GOOGLE_DOC_MIME,
  GOOGLE_SHEET_MIME,
  DOCX_MIME,
  WP_STATUS,
  applyPbcItemPlan,
  buildRequiredWorkingPapers,
  classifyTemplateCandidate,
  contentFingerprint,
  decidePbcEvaluation,
  discoverTemplateLibraries,
  planHeaderPrefill,
  planPbcItemApplicability,
  prefillHeader,
  programmeFingerprint,
  writePbcEvaluation,
  loadPbcItem
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
    files, texts, copies, writes,
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
      if (range.startsWith("PBC_MASTER")) {
        return /AB4$/.test(range) ? [sheet.pbcRows[0]] : sheet.pbcRows;
      }
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

function seedDrive({ programmeName = "PROGRAMME_TRAVAIL_ABC_VALIDE", extraFiles = [], extraTexts = {} } = {}) {
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
      { id: "M", name: "ABC_2025", mimeType: FOLDER_MIME, parents: ["ROOT"] },
      { id: "D", name: "05_WORKING_PAPERS", mimeType: FOLDER_MIME, parents: ["M"] },
      { id: "P", name: programmeName, mimeType: GOOGLE_DOC_MIME, parents: ["M"], modifiedTime: "2026-10-01T10:00:00Z" },
      ...extraFiles
    ],
    texts: { P: PROGRAMME_TEXT, ...extraTexts },
    sheets: {
      T1: {
        sheetName: "WP",
        rows: [["Client :", ""], ["Exercice", ""], ["Préparé par", "=REF!B2"], ["Revu par", ""], ["Cycle", "TRE"]],
        formulaCells: ["B3"]
      }
    }
  });
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
    requirements: [TRE_REQ],
    ...overrides
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

  // Same modifiedTime but different content -> fingerprint mismatch.
  const drive2 = seedDrive();
  const input2 = await analysedInput(drive2);
  drive2.texts.set("P", PROGRAMME_TEXT + "\nProcédure ajoutée.");
  const r2 = await buildRequiredWorkingPapers(drive2, input2, opts);
  assert.equal(r2.status, "PROGRAMME_CHANGED");
  assert.equal(drive.copies.length + drive2.copies.length, 0);
});

// ---------------------------------------------------------------------------
// Work products
// ---------------------------------------------------------------------------

test("only the work products required by the programme are created", async () => {
  const drive = seedDrive();
  const result = await buildRequiredWorkingPapers(drive, await analysedInput(drive), opts);
  assert.equal(result.status, "COMPLETED");
  assert.equal(drive.copies.length, 1, "exactly one copy for one requirement");
  const [item] = result.work_products;
  assert.equal(item.status, WP_STATUS.CREATED);
  assert.equal(item.template.file_id, "T1", "blank library template, not archive/completed copies");
  assert.equal(drive.copies[0].parentId, "D");
  assert.equal(item.programme_file_id, "P");
  assert.match(item.source_evidence.excerpt, /TRE-01/);
  assert.ok(item.file.file_id);
});

test("no copy-all path: no requirement, untraceable requirement, folder as template, too many", async () => {
  const drive = seedDrive();
  const none = await buildRequiredWorkingPapers(drive, await analysedInput(drive, { requirements: [] }), opts);
  assert.equal(none.status, "BLOCKED");

  const invented = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    requirements: [{ ...TRE_REQ, source_evidence: { excerpt: "Copier tous les modèles de la bibliothèque", location: null } }]
  }), opts);
  assert.equal(invented.work_products[0].status, WP_STATUS.REVIEW_REQUIRED);
  assert.match(invented.work_products[0].reason, /SOURCE_EXCERPT_NOT_FOUND/);

  const folderAsTemplate = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    requirements: [{ ...TRE_REQ, template_file_id: "LIB" }]
  }), opts);
  assert.equal(folderAsTemplate.work_products[0].status, WP_STATUS.REVIEW_REQUIRED);
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

test("ambiguous template -> REVIEW_REQUIRED; absent template -> TEMPLATE_NOT_FOUND", async () => {
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
  assert.equal(ana.reason, "AMBIGUOUS_TEMPLATE_MATCH");
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
    classifyTemplateCandidate({ file: { name: "Modèle WP Caisse", mimeType: GOOGLE_SHEET_MIME }, excerpt: "Client : SOCIETE XYZ SARL\nPréparé par : Jean Dupont" }).classification,
    "COMPLETED_WP_SUSPECTED"
  );
  assert.equal(
    classifyTemplateCandidate({ file: { name: "WP_TRE_ClientX_2023_FINAL", mimeType: GOOGLE_SHEET_MIME } }).classification,
    "COMPLETED_WP_SUSPECTED",
    "underscore-separated names are understood"
  );
  assert.equal(
    classifyTemplateCandidate({ file: { name: "Relevé bancaire janvier.pdf", mimeType: "application/pdf" } }).classification,
    "SUPPORTING_DOCUMENT"
  );
  assert.equal(
    classifyTemplateCandidate({ file: { name: "Modèle WP Caisse", mimeType: GOOGLE_SHEET_MIME }, excerpt: "Client : ............\nPréparé par : [à compléter]" }).classification,
    "TEMPLATE_LIKELY"
  );

  const drive = seedDrive();
  const forced = await buildRequiredWorkingPapers(drive, await analysedInput(drive, {
    requirements: [{ ...TRE_REQ, template_file_id: "T4" }]
  }), opts);
  assert.equal(forced.work_products[0].status, WP_STATUS.REVIEW_REQUIRED);
  assert.equal(forced.work_products[0].reason, "TEMPLATE_NOT_ELIGIBLE");
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
  const noNote = await buildRequiredWorkingPapers(two, await analysedInput(two, { library_basis: "USER_CONFIRMED" }), { now: opts.now });
  assert.equal(noNote.status, "LIBRARY_REVIEW_REQUIRED");
  assert.equal(two.copies.length, 0);
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

  // Created sheet with a formula on "Préparé par": review required, nothing claimed.
  const built = await buildRequiredWorkingPapers(drive, await analysedInput(drive, { prefill_headers: true }), opts);
  assert.equal(built.work_products[0].prefill.status, "HEADER_PREFILL_REVIEW_REQUIRED");
  assert.equal(drive.writes.length, 0);
});

// ---------------------------------------------------------------------------
// PBC refined by the programme
// ---------------------------------------------------------------------------

const PBC_HEADER = ["Référence", "Dossier", "Document demandé", "", "Cycles", "", "Moment", "", "Critique", "", "Applicable", "", "", "", "Date attendue", "Reçu", "", "Complet", "Statut", "Commentaire"];
function pbcRow(ref, cycles, extra = {}) {
  const row = new Array(20).fill("");
  row[0] = ref; row[2] = `Doc ${ref}`; row[4] = cycles; row[10] = "Oui";
  for (const [i, v] of Object.entries(extra)) row[i] = v;
  return row;
}

test("PBC applicability refined by programme procedures, never invented", async () => {
  const rows = [PBC_HEADER, pbcRow("PBC-001", "TRE"), pbcRow("PBC-002", "TRE"), pbcRow("PBC-010", "STK")];
  const plan = planPbcItemApplicability({
    rows,
    retainedCycles: ["TRE", "VEN"],
    programmeText: PROGRAMME_TEXT,
    decisions: [
      { pbc_reference: "PBC-001", applicable: true, programme_procedure: "TRE-01", source_evidence_excerpt: "rapprochements bancaires au 31/12/2025" },
      { pbc_reference: "PBC-002", applicable: false, programme_procedure: "TRE: only bank reconciliations retained", source_evidence_excerpt: "rapprochements bancaires au 31/12/2025" },
      { pbc_reference: "PBC-010", applicable: true, programme_procedure: "STK", source_evidence_excerpt: "inventaire physique des stocks" },
      { pbc_reference: "PBC-999", applicable: true, programme_procedure: "?", source_evidence_excerpt: "rapprochements bancaires au 31/12/2025" },
      { pbc_reference: "PBC-001", applicable: true, programme_procedure: "x", source_evidence_excerpt: "texte qui n'existe pas dans le programme" }
    ]
  });
  assert.deepEqual(plan.map(p => p.status), [
    "PLANNED", "PLANNED", "REJECTED_CYCLE_NOT_RETAINED", "REJECTED_UNKNOWN_REFERENCE", "REJECTED_SOURCE_NOT_IN_PROGRAMME"
  ]);
  assert.equal(plan[0].row_number, 5);

  // Writes only into a non-formula "Applicable" cell; formula -> review.
  const drive = fakeDrive({ files: [], sheets: { S: { sheetName: "PBC_MASTER", pbcRows: rows, formulaCells: ["K6"] } } });
  const applied = await applyPbcItemPlan(drive, "S", plan);
  assert.equal(applied[0].status, "APPLIED");
  assert.equal(applied[1].status, "ITEM_OVERRIDE_REVIEW_REQUIRED");
  assert.ok(drive.writes.some(w => w.range === "PBC_MASTER!K5" && w.rows[0][0] === "Oui"));
  assert.ok(!drive.writes.some(w => w.range === "PBC_MASTER!K6"));
});

// ---------------------------------------------------------------------------
// PBC evidence control
// ---------------------------------------------------------------------------

const EVIDENCE_META = { id: "E1", name: "Bank Statements 2025", modifiedTime: "2026-03-01T00:00:00Z", mimeType: GOOGLE_DOC_MIME };
const EVIDENCE_TEXT = "Relevés BANQUE ATLANTIQUE compte 0123 — ABC SA — janvier à juin 2025";
const ALL_MATCH = { client: "MATCH", mission: "MATCH", scope_account: "MATCH", period: "MATCH", completeness: "MATCH", document_nature: "MATCH" };
const readOk = { supported: true, text: EVIDENCE_TEXT, truncated: false, file: EVIDENCE_META };

test("right file name but incomplete period is never VERIFIED", () => {
  const d = decidePbcEvaluation({
    proposed: "VERIFIED",
    checks: { ...ALL_MATCH, period: "PARTIAL", completeness: "PARTIAL" },
    rationale: "Only January to June 2025 statements, July-December missing.",
    evidenceMeta: EVIDENCE_META,
    analysedModifiedTime: EVIDENCE_META.modifiedTime,
    analysedFingerprint: contentFingerprint(EVIDENCE_META, EVIDENCE_TEXT),
    read: readOk
  });
  assert.equal(d.final_state, "REVIEW");

  const partial = decidePbcEvaluation({
    proposed: "PARTIAL",
    checks: { ...ALL_MATCH, period: "PARTIAL", completeness: "PARTIAL" },
    rationale: "Only January to June 2025 statements, July-December missing.",
    evidenceMeta: EVIDENCE_META,
    analysedModifiedTime: EVIDENCE_META.modifiedTime,
    analysedFingerprint: contentFingerprint(EVIDENCE_META, EVIDENCE_TEXT),
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
    decidePbcEvaluation({ ...base, analysedFingerprint: contentFingerprint(EVIDENCE_META, EVIDENCE_TEXT), read: { ...readOk, truncated: true } }).reasons.at(-1),
    "CONTENT_TRUNCATED_NOT_FULLY_READ"
  );
  assert.equal(
    decidePbcEvaluation({ ...base, analysedFingerprint: contentFingerprint(EVIDENCE_META, EVIDENCE_TEXT), analysedModifiedTime: "2025-01-01T00:00:00Z" }).reasons.at(-1),
    "EVIDENCE_CHANGED_SINCE_ANALYSIS"
  );
  const ok = decidePbcEvaluation({ ...base, analysedFingerprint: contentFingerprint(EVIDENCE_META, EVIDENCE_TEXT) });
  assert.equal(ok.final_state, "VERIFIED");
});

test("evaluation is written only to identified, non-formula checklist columns", async () => {
  const header = [...PBC_HEADER, "Statut contrôle IA", "Lien preuve", "Date vérification"];
  const rows = [header, pbcRow("PBC-001", "TRE")];
  const drive = fakeDrive({ files: [], sheets: { S: { sheetName: "PBC_MASTER", pbcRows: rows, formulaCells: ["T5"] } } });
  const item = await loadPbcItem(drive, "S", "PBC-001");
  assert.equal(item.found, true);
  const out = await writePbcEvaluation(drive, "S", item, {
    final_state: "PARTIAL", evidence_url: "https://drive/E1", evidence_file_id: "E1",
    evaluated_at: "2026-10-05T12:00:00Z", rationale: "Only H1 2025."
  });
  assert.equal(out.status, "PARTIALLY_WRITTEN"); // comment column T5 is a formula
  assert.ok(drive.writes.some(w => w.range === "PBC_MASTER!U5" && w.rows[0][0] === "PARTIAL"));
  assert.ok(!drive.writes.some(w => w.range === "PBC_MASTER!S5"), "automatic status column untouched");
  assert.ok(!drive.writes.some(w => w.range === "PBC_MASTER!T5"));
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
    [row("PBC-1", "Non", "Non", ""), row("PBC-2", "Oui", "Non", "Partiel"), row("PBC-3", "Oui", "Oui", "Non conforme"), row("PBC-4", "Oui", "Oui", "Vérifié")],
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
