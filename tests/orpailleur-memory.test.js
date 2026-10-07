// Phase 3 — offline tests of the Orpailleur memory (MAP / RULES / REGISTER).
// Fake Drive with real xlsx bytes (ExcelJS round-trips); no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FOLDER_MIME,
  GOOGLE_DOC_MIME,
  GOOGLE_SHEET_MIME,
  TEMPLATE_READ_CHARS,
  buildRequiredWorkingPapers,
  contentFingerprint,
  programmeFingerprint
} from "../lib/mission-engine.js";
import {
  MEMORY_FILE_NAMES,
  MAPPING_STATES,
  buildMappingReport,
  documentaryActionsAllowed,
  listingFromInventory,
  openMemory,
  ownerApproveRole,
  ownerMarkMappingReviewed,
  proposeRole,
  recordUnderstanding,
  resolveSemanticRole,
  runMappingPass,
  saveMemory,
  signRule
} from "../lib/orpailleur-memory.js";

const SECRET = "test-owner-secret";

function fakeDrive() {
  const files = new Map();
  const texts = new Map();
  const blobs = new Map();
  const reads = [];
  const created = [];
  const updated = [];
  const copies = [];
  const businessWrites = [];
  let counter = 0;
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 9, 5, 12, 0, ++clock)).toISOString();

  const drive = {
    files, texts, blobs, reads, created, updated, copies, businessWrites,
    add(meta, text) {
      files.set(meta.id, { modifiedTime: "2026-09-01T00:00:00Z", size: "100", parents: [], ...meta });
      if (text !== undefined) texts.set(meta.id, text);
    },
    async getMeta(id) {
      const meta = files.get(id);
      if (!meta) throw new Error(`NOT_FOUND ${id}`);
      return { ...meta };
    },
    async listChildren(folderId) {
      return [...files.values()].filter(f => !f.trashed && (f.parents || []).includes(folderId)).map(f => ({ ...f }));
    },
    async searchFiles({ query, mimeType }) {
      return [...files.values()].filter(f => !f.trashed && (!mimeType || f.mimeType === mimeType) && f.name.toLowerCase().includes(String(query).toLowerCase()));
    },
    async readText(id, { maxChars = 30000 } = {}) {
      reads.push(id);
      const meta = files.get(id);
      if (!texts.has(id)) return { supported: false, file: meta, reason: "No safe extractor" };
      const text = texts.get(id);
      return { supported: true, file: { ...meta }, text: text.slice(0, maxChars), truncated: text.length > maxChars };
    },
    async copyFile(id, name, parentId) {
      const source = files.get(id);
      const copy = { ...source, id: `copy-${++counter}`, name, parents: [parentId], modifiedTime: tick() };
      files.set(copy.id, copy);
      copies.push(copy.id);
      return { ...copy };
    },
    async getValues() { return []; },
    async getFormulaMap() { return { sheetNames: ["WP"], sheetName: "WP", formulaCells: [] }; },
    async updateValues(id, range, rows) { businessWrites.push({ id, range, rows }); },
    async findFilesByExactName(name, parentId) {
      return [...files.values()].filter(f => !f.trashed && f.name === name && (f.parents || []).includes(parentId)).map(f => ({ ...f }));
    },
    async downloadBuffer(id) {
      if (!blobs.has(id)) throw new Error("NO_BLOB");
      return blobs.get(id);
    },
    async createBinary({ name, parentId, buffer, mimeType }) {
      const meta = { id: `mem-${++counter}`, name, parents: [parentId], mimeType, modifiedTime: tick() };
      files.set(meta.id, meta);
      blobs.set(meta.id, buffer);
      created.push(meta.id);
      return { ...meta };
    },
    async updateBinary(id, { buffer }) {
      const meta = files.get(id);
      meta.modifiedTime = tick();
      blobs.set(id, buffer);
      updated.push(id);
      return { ...meta };
    }
  };
  return drive;
}

// A small organisation Drive. ROOT is the scan root; memory lives in ROOT too.
function orgDrive() {
  const d = fakeDrive();
  d.add({ id: "ROOT", name: "Shared", mimeType: FOLDER_MIME });
  d.add({ id: "F-ACTIVE", name: "01_MISSIONS_EN_COURS", mimeType: FOLDER_MIME, parents: ["ROOT"] });
  d.add({ id: "F-LIB", name: "06 Working files par cycle", mimeType: FOLDER_MIME, parents: ["ROOT"] });
  d.add({ id: "F-LIB2", name: "03_WORKING_PAPER_TEMPLATES", mimeType: FOLDER_MIME, parents: ["ROOT"] });
  d.add({ id: "F-ARCH", name: "99_ARCHIVES", mimeType: FOLDER_MIME, parents: ["ROOT"] });
  d.add({ id: "T1", name: "Modèle WP Trésorerie", mimeType: GOOGLE_SHEET_MIME, parents: ["F-LIB2"] },
    "Client : ............\nPréparé par : [à compléter]\nRapprochement bancaire");
  d.add({ id: "DOC1", name: "Lettre de mission ABC.docx", mimeType: GOOGLE_DOC_MIME, parents: ["F-ACTIVE"] },
    "Lettre de mission — ABC SA — audit des comptes 2025");
  d.add({ id: "PDF1", name: "Contrat signé.pdf", mimeType: "application/pdf", parents: ["F-ACTIVE"] });
  d.add({ id: "SYS1", name: "~$Budget.xlsx", mimeType: "application/octet-stream", parents: ["F-ACTIVE"] });
  return d;
}

const pass = (drive, now = "2026-10-05T12:00:00Z", extra = {}) =>
  runMappingPass(drive, { memoryFolderId: "ROOT", rootFolderId: "ROOT", now: new Date(now), org: "org-1", ...extra });

async function reopen(drive) {
  return openMemory(drive, { memoryFolderId: "ROOT" });
}

function row(memory, id) {
  return memory.register.rows.find(r => r.file_id === id);
}

// ---------------------------------------------------------------------------

test("first scan maps before any action (read-only, memory files only)", async () => {
  const drive = orgDrive();
  const { summary } = await pass(drive);
  assert.equal(summary.pass_mode, "FIRST_MAPPING");
  assert.equal(summary.mapping_state, MAPPING_STATES.MAPPING_PENDING_REVIEW);
  assert.equal(summary.business_actions_performed, 0);
  assert.equal(drive.copies.length, 0);
  assert.equal(drive.businessWrites.length, 0);
  assert.deepEqual(drive.created.length, 2, "only the two memory files are created");
  const memory = await reopen(drive);
  assert.equal(documentaryActionsAllowed(memory, SECRET).allowed, false);
  assert.equal(row(memory, "SYS1").understanding_status, "METADATA_ONLY");
  assert.equal(row(memory, "PDF1").understanding_status, "EXTRACTOR_REQUIRED");
  assert.equal(row(memory, "DOC1").understanding_status, "NEEDS_UNDERSTANDING");
});

test("an incomplete first scan stays FIRST_MAPPING", async () => {
  const drive = orgDrive();
  const { summary } = await pass(drive, undefined, { maxItems: 3 });
  assert.equal(summary.listing_complete, false);
  assert.equal(summary.mapping_state, MAPPING_STATES.FIRST_MAPPING);
});

test("same MAP / REGISTER updated in place across runs (no new files)", async () => {
  const drive = orgDrive();
  const first = await pass(drive);
  await pass(drive, "2026-10-06T12:00:00Z");
  await pass(drive, "2026-10-07T12:00:00Z");
  assert.equal(drive.created.length, 2);
  const memoryFiles = [...drive.files.values()].filter(f => Object.values(MEMORY_FILE_NAMES).includes(f.name));
  assert.equal(memoryFiles.length, 2);
  const again = await reopen(drive);
  assert.equal(again.map.fileId, first.summary.map_file_id);
  assert.equal(again.register.fileId, first.summary.register_file_id);
  assert.equal(drive.updated.length, 4);
});

test("a duplicated memory file is never resolved by creating a third one", async () => {
  const drive = orgDrive();
  await pass(drive);
  drive.add({ id: "DUP", name: MEMORY_FILE_NAMES.map, mimeType: "x", parents: ["ROOT"] });
  await assert.rejects(pass(drive, "2026-10-06T12:00:00Z"), /MEMORY_FILE_DUPLICATE/);
  assert.equal(drive.created.length, 2);
});

test("REGISTER keeps file_id as stable identity", async () => {
  const drive = orgDrive();
  await pass(drive);
  drive.files.get("DOC1").name = "Lettre de mission ABC - signée.docx";
  await pass(drive, "2026-10-06T12:00:00Z");
  const memory = await reopen(drive);
  const rows = memory.register.rows.filter(r => r.file_id === "DOC1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Lettre de mission ABC - signée.docx");
  const ids = memory.register.rows.map(r => r.file_id);
  assert.equal(new Set(ids).size, ids.length);
});

test("unchanged file is not re-read; modified file is re-read", async () => {
  const drive = orgDrive();
  await pass(drive);
  drive.reads.length = 0;
  const second = await pass(drive, "2026-10-06T12:00:00Z");
  assert.equal(second.summary.counts.UNCHANGED > 0, true);
  assert.deepEqual(drive.reads, [], "nothing re-read");

  drive.files.get("DOC1").modifiedTime = "2026-10-06T09:00:00Z";
  drive.texts.set("DOC1", "Lettre de mission — ABC SA — audit des comptes 2025 — avenant");
  const third = await pass(drive, "2026-10-07T12:00:00Z");
  assert.equal(third.summary.counts.MODIFIED, 1);
  assert.deepEqual(drive.reads, ["DOC1"]);
  const memory = await reopen(drive);
  assert.equal(row(memory, "DOC1").change_type, "MODIFIED");
  assert.equal(row(memory, "DOC1").understanding_status, "NEEDS_UNDERSTANDING");
});

test("renamed and moved files are detected and re-evaluated", async () => {
  const drive = orgDrive();
  await pass(drive);
  drive.reads.length = 0;
  drive.files.get("DOC1").name = "LM_ABC_2025.docx";
  drive.files.get("T1").parents = ["F-LIB"];
  const { summary } = await pass(drive, "2026-10-06T12:00:00Z");
  assert.equal(summary.counts.RENAMED, 1);
  assert.equal(summary.counts.MOVED, 1);
  const memory = await reopen(drive);
  assert.equal(row(memory, "DOC1").change_type, "RENAMED");
  assert.equal(row(memory, "T1").change_type, "MOVED");
  assert.equal(row(memory, "T1").path, "/06 Working files par cycle/Modèle WP Trésorerie");
  assert.deepEqual(drive.reads.sort(), ["DOC1", "T1"]);
});

test("new file is read, then understood by the AI (fingerprint-checked)", async () => {
  const drive = orgDrive();
  await pass(drive);
  drive.add({ id: "NEW1", name: "PBC_MASTER.gsheet", mimeType: GOOGLE_SHEET_MIME, parents: ["ROOT"] }, "Référence PBC\tDocument demandé");
  const { summary } = await pass(drive, "2026-10-06T12:00:00Z");
  assert.equal(summary.counts.NEW, 1);
  assert.ok(drive.reads.includes("NEW1"));
  const memory = await reopen(drive);
  const r = row(memory, "NEW1");
  assert.equal(r.read_status, "READ");
  assert.equal(r.understanding_status, "NEEDS_UNDERSTANDING");

  const stale = recordUnderstanding(memory, [{ file_id: "NEW1", content_fingerprint: "old", semantic_role: "PBC_MASTER", confidence: 0.9, rationale: "PBC master columns" }], { now: "x" });
  assert.equal(stale[0].status, "STALE_FINGERPRINT");
  const ok = recordUnderstanding(memory, [{ file_id: "NEW1", content_fingerprint: r.content_fingerprint, semantic_role: "PBC_MASTER", confidence: 0.9, rationale: "PBC master columns" }], { now: "x" });
  assert.equal(ok[0].status, "RECORDED");
  assert.equal(row(memory, "NEW1").understanding_status, "UNDERSTOOD");
});

test("a missing file is not immediately declared deleted", async () => {
  const drive = orgDrive();
  await pass(drive);
  drive.files.delete("DOC1"); // gone, not found by id
  drive.files.get("T1").trashed = true; // trashed
  drive.files.get("PDF1").parents = ["ELSEWHERE"]; // moved outside the scanned scope

  const second = await pass(drive, "2026-10-06T12:00:00Z");
  let memory = await reopen(drive);
  assert.equal(row(memory, "DOC1").status, "MISSING_PENDING_CHECK");
  assert.equal(row(memory, "T1").status, "TRASHED");
  assert.equal(row(memory, "PDF1").status, "MOVED_OUT_OF_SCOPE");
  assert.equal(second.summary.counts.DELETED_OR_MISSING, 0);

  await pass(drive, "2026-10-07T12:00:00Z");
  memory = await reopen(drive);
  assert.equal(row(memory, "DOC1").status, "DELETED_OR_MISSING");
});

test("an incomplete listing never concludes that a file is missing", async () => {
  const drive = orgDrive();
  await pass(drive);
  const listing = listingFromInventory([], { runId: "run-2", runStatus: "PARTIAL" });
  await pass(drive, "2026-10-06T12:00:00Z", { listing });
  const memory = await reopen(drive);
  assert.equal(row(memory, "DOC1").status, "PRESENT");
});

test("the existing orpailleur_inventory scanner can feed the pass", async () => {
  const drive = orgDrive();
  const inventory = [
    { file_id: "F-ACTIVE", parent_id: "ROOT", folder_path: "/", name: "01_MISSIONS_EN_COURS", mime_type: FOLDER_MIME, modified_at: "2026-09-01T00:00:00Z", drive_version: "3", size_bytes: null, web_url: "", last_scan_id: "run-1" },
    { file_id: "DOC1", parent_id: "F-ACTIVE", folder_path: "/01_MISSIONS_EN_COURS/", name: "Lettre de mission ABC.docx", mime_type: GOOGLE_DOC_MIME, modified_at: "2026-09-01T00:00:00Z", drive_version: "7", size_bytes: 100, web_url: "", last_scan_id: "run-1" },
    { file_id: "OLD", parent_id: "ROOT", folder_path: "/", name: "old", mime_type: GOOGLE_DOC_MIME, modified_at: "2026-01-01T00:00:00Z", drive_version: "1", size_bytes: 1, web_url: "", last_scan_id: "run-0" }
  ];
  const listing = listingFromInventory(inventory, { runId: "run-1", runStatus: "COMPLETE" });
  const { summary } = await pass(drive, undefined, { listing });
  assert.equal(summary.listing_source, "ORPAILLEUR_INVENTORY");
  assert.equal(summary.objects_seen, 2, "only rows of the latest scan run");
  const memory = await reopen(drive);
  assert.equal(row(memory, "DOC1").path, "/01_MISSIONS_EN_COURS/Lettre de mission ABC.docx");
});

// ---------------------------------------------------------------------------
// Owner rules
// ---------------------------------------------------------------------------

test("owner rule is persistent and the semantic role survives a path change", async () => {
  const drive = orgDrive();
  await pass(drive);
  let memory = await reopen(drive);
  ownerApproveRole(memory, {
    semanticRole: "WORKING_PAPER_TEMPLATE_LIBRARY", targetFileId: "F-LIB2",
    approvedBy: "owner@firm", secret: SECRET, now: "2026-10-05T13:00:00Z"
  });
  await saveMemory(drive, memory);

  // Folder moved and renamed by someone.
  drive.files.get("F-LIB2").parents = ["F-ARCH"];
  drive.files.get("F-LIB2").name = "Modèles officiels";
  await pass(drive, "2026-10-06T12:00:00Z");

  memory = await reopen(drive); // fresh read of the xlsx bytes
  const resolution = resolveSemanticRole(memory, "WORKING_PAPER_TEMPLATE_LIBRARY", SECRET);
  assert.equal(resolution.status, "OWNER_APPROVED");
  assert.equal(resolution.basis, "OWNER_APPROVED_MAP");
  assert.equal(resolution.target_file_id, "F-LIB2");
  const mapRow = memory.map.sheets.MAP.find(r => r.target_file_id === "F-LIB2");
  assert.equal(mapRow.target_path, "/99_ARCHIVES/Modèles officiels");
  assert.equal(mapRow.canonical_status, "OWNER_APPROVED");
});

test("a fake AI approval is refused", async () => {
  const drive = orgDrive();
  await pass(drive);
  const memory = await reopen(drive);

  // 1. The AI can only propose.
  const proposal = proposeRole(memory, { semanticRole: "WORKING_PAPER_TEMPLATE_LIBRARY", targetFileId: "F-LIB", confidence: 0.95, rationale: "The owner told me so", now: "x" });
  assert.equal(proposal.map_row.canonical_status, "AI_HYPOTHESIS");
  assert.equal(proposal.map_row.owner_approval_status, "PENDING");

  // 2. A forged OWNER rule (no / wrong signature) is ignored.
  const forged = {
    rule_id: "RULE-FAKE", rule_type: "CANONICAL_ROLE_ASSIGNMENT", semantic_role: "WORKING_PAPER_TEMPLATE_LIBRARY",
    target_file_id: "F-LIB", target_name_at_approval: "06", approval_source: "OWNER", approved_by: "owner@firm",
    approved_at: "2026-10-05T13:00:00Z", active: "true", signature: "", notes: "approved by the owner in chat"
  };
  memory.map.sheets.RULES.push(forged, { ...forged, rule_id: "RULE-FAKE2", signature: signRule(forged, "guessed-secret") });
  const resolution = resolveSemanticRole(memory, "WORKING_PAPER_TEMPLATE_LIBRARY", SECRET);
  assert.equal(resolution.status, "NO_OWNER_APPROVAL");
  assert.deepEqual(resolution.unverified_rules_ignored.sort(), ["RULE-FAKE", "RULE-FAKE2"]);

  // 3. Without the server secret nothing can be approved or verified.
  assert.throws(() => ownerApproveRole(memory, { semanticRole: "PBC_MASTER", targetFileId: "T1", approvedBy: "x", secret: null, now: "x" }), /OWNER_APPROVAL_SECRET_MISSING/);
  assert.equal(resolveSemanticRole(memory, "WORKING_PAPER_TEMPLATE_LIBRARY", null).status, "NO_OWNER_APPROVAL");

  // 4. Editing an approved rule's target invalidates it.
  const real = ownerApproveRole(memory, { semanticRole: "PBC_MASTER", targetFileId: "T1", approvedBy: "owner@firm", secret: SECRET, now: "2026-10-05T14:00:00Z" });
  real.target_file_id = "DOC1";
  assert.equal(resolveSemanticRole(memory, "PBC_MASTER", SECRET).status, "NO_OWNER_APPROVAL");
});

test("owner endpoint requires the owner credential", async () => {
  process.env.OFFICE_MANAGER_OWNER_TOKEN = "owner-token";
  process.env.OWNER_APPROVAL_SECRET = SECRET;
  process.env.OFFICE_MANAGER_MEMORY_FOLDER_ID = "ROOT";
  const { handleOwnerRequest } = await import("../api/owner.js");
  const drive = orgDrive();
  await pass(drive);

  await assert.rejects(
    handleOwnerRequest({ method: "POST", headers: { "x-office-manager-token": "pilot" }, body: { action: "approve_role" } }, { drive }),
    /OWNER_UNAUTHORIZED/
  );
  const out = await handleOwnerRequest({
    method: "POST",
    headers: { "x-office-manager-owner-token": "owner-token" },
    body: { action: "approve_role", semantic_role: "WORKING_PAPER_TEMPLATE_LIBRARY", target_file_id: "F-LIB2", approved_by: "owner@firm" }
  }, { drive });
  assert.equal(out.recorded, true);
  const memory = await reopen(drive);
  assert.equal(resolveSemanticRole(memory, "WORKING_PAPER_TEMPLATE_LIBRARY", SECRET).status, "OWNER_APPROVED");

  const reviewed = await handleOwnerRequest({
    method: "POST", headers: { "x-office-manager-owner-token": "owner-token" },
    body: { action: "mark_mapping_reviewed", approved_by: "owner@firm" }
  }, { drive });
  assert.equal(reviewed.recorded, true);
  assert.equal(documentaryActionsAllowed(await reopen(drive), SECRET).allowed, true);
});

test("documentary actions start only after an owner-signed MAPPING_REVIEWED", async () => {
  const drive = orgDrive();
  await pass(drive);
  const memory = await reopen(drive);
  assert.deepEqual(documentaryActionsAllowed(memory, SECRET), { allowed: false, state: "MAPPING_PENDING_REVIEW", reason: "MAPPING_NOT_REVIEWED" });
  // Writing the state cell by hand is not enough: the signed rule is required.
  memory.map.sheets.STATE.find(r => r.key === "mapping_state").value = "MAPPING_REVIEWED";
  assert.equal(documentaryActionsAllowed(memory, SECRET).allowed, false, "hand-edited STATE is not trusted");
  await saveMemory(drive, memory);

  // Same through the runtime gate used by the business-write tools.
  process.env.OFFICE_MANAGER_MEMORY_FOLDER_ID = "ROOT";
  process.env.OWNER_APPROVAL_SECRET = SECRET;
  delete process.env.OFFICE_MANAGER_REQUIRE_MAPPING;
  const { mappingGate } = await import("../lib/memory-runtime.js");
  assert.equal((await mappingGate(drive)).allowed, false);

  const reviewedMemory = await reopen(drive);
  ownerMarkMappingReviewed(reviewedMemory, { approvedBy: "owner@firm", secret: SECRET, now: "2026-10-05T15:00:00Z" });
  await saveMemory(drive, reviewedMemory);
  assert.equal(documentaryActionsAllowed(reviewedMemory, SECRET).allowed, true);
  assert.equal((await mappingGate(drive)).allowed, true);

  // Legacy escape hatch (pilot before its first mapping) is explicit.
  const unmapped = orgDrive();
  assert.equal((await mappingGate(unmapped)).reason, "MAPPING_REQUIRED");
  process.env.OFFICE_MANAGER_REQUIRE_MAPPING = "false";
  assert.equal((await mappingGate(unmapped)).state, "LEGACY_MAPPING_NOT_REQUIRED");
  delete process.env.OFFICE_MANAGER_REQUIRE_MAPPING;
  assert.equal(documentaryActionsAllowed({ exists: false }, SECRET).reason, "MAPPING_REQUIRED");

  const fresh = orgDrive();
  await pass(fresh, undefined, { maxItems: 2 }); // incomplete: still FIRST_MAPPING
  const freshMemory = await reopen(fresh);
  assert.throws(() => ownerMarkMappingReviewed(freshMemory, { approvedBy: "o", secret: SECRET, now: "x" }), /FIRST_MAPPING_NOT_COMPLETE/);
});

// ---------------------------------------------------------------------------
// Mission Controller integration
// ---------------------------------------------------------------------------

const PROGRAMME = "PROGRAMME VALIDÉ — Procédure TRE-01 : rapprochements bancaires au 31/12/2025 pour tous les comptes.";

async function missionInput(drive, overrides = {}) {
  drive.add({ id: "M", name: "ABC_2025", mimeType: FOLDER_MIME, parents: ["F-ACTIVE"] });
  drive.add({ id: "D", name: "TRAVAUX", mimeType: FOLDER_MIME, parents: ["M"] });
  drive.add({ id: "P", name: "PROGRAMME_ABC_VALIDE", mimeType: GOOGLE_DOC_MIME, parents: ["M"], modifiedTime: "2026-10-01T10:00:00Z" }, PROGRAMME);
  const p = await drive.getMeta("P");
  const t = await drive.getMeta("T1");
  const tRead = await drive.readText("T1", { maxChars: TEMPLATE_READ_CHARS });
  return {
    mission_type: "AUDIT", mission_reference: "ABC25", client: "ABC SA",
    programme_file_id: "P", programme_modified_at: p.modifiedTime,
    programme_fingerprint: programmeFingerprint(p, PROGRAMME), programme_validated_confirmed: true,
    template_library_folder_id: "F-LIB2", library_basis: "OWNER_APPROVED_MAP",
    mission_root_folder_id: "M", destination_folder_id: "D",
    dry_run: false, prefill_headers: false, prefill_prepared_date: false,
    requirements: [{
      cycle: "TRE", procedure: "TRE-01", required_wp_type: "Rapprochement bancaire",
      template_file_id: "T1", template_modified_at: t.modifiedTime,
      template_content_fingerprint: contentFingerprint(t, tRead.text),
      source_evidence: { excerpt: "Procédure TRE-01 : rapprochements bancaires au 31/12/2025", location: null }
    }],
    ...overrides
  };
}

const resolverFor = drive => async role =>
  resolveSemanticRole(await reopen(drive), role, SECRET);

test("OWNER_APPROVED_MAP is usable by Mission Controller", async () => {
  const drive = orgDrive();
  await pass(drive);
  const memory = await reopen(drive);
  ownerApproveRole(memory, { semanticRole: "WORKING_PAPER_TEMPLATE_LIBRARY", targetFileId: "F-LIB2", approvedBy: "owner@firm", secret: SECRET, now: "2026-10-05T13:00:00Z" });
  await saveMemory(drive, memory);

  const input = await missionInput(drive);
  const built = await buildRequiredWorkingPapers(drive, input, { resolveRole: resolverFor(drive) });
  assert.equal(built.status, "COMPLETED");
  assert.equal(built.library.basis, "OWNER_APPROVED_MAP");
  assert.equal(built.work_products[0].status, "CREATED");

  const other = await buildRequiredWorkingPapers(drive, { ...input, template_library_folder_id: "F-LIB" }, { resolveRole: resolverFor(drive) });
  assert.equal(other.status, "LIBRARY_REVIEW_REQUIRED");
  assert.match(other.reasons[0], /LIBRARY_DIFFERS_FROM_OWNER_APPROVED_MAP/);
});

test("ambiguous MAP -> no automatic action", async () => {
  const drive = orgDrive();
  await pass(drive);
  const memory = await reopen(drive);
  proposeRole(memory, { semanticRole: "WORKING_PAPER_TEMPLATE_LIBRARY", targetFileId: "F-LIB", confidence: 0.6, rationale: "Contains working files by cycle", now: "x" });
  proposeRole(memory, { semanticRole: "WORKING_PAPER_TEMPLATE_LIBRARY", targetFileId: "F-LIB2", confidence: 0.7, rationale: "Name says templates", now: "x" });
  await saveMemory(drive, memory);

  const resolution = resolveSemanticRole(await reopen(drive), "WORKING_PAPER_TEMPLATE_LIBRARY", SECRET);
  assert.equal(resolution.status, "NO_OWNER_APPROVAL");
  assert.equal(resolution.ambiguous, true);
  const report = buildMappingReport(await reopen(drive), SECRET);
  assert.ok(report.owner_questions.some(q => q.semantic_role === "WORKING_PAPER_TEMPLATE_LIBRARY" && q.question === "WHICH_ONE_IS_CANONICAL"));

  const input = await missionInput(drive);
  const built = await buildRequiredWorkingPapers(drive, input, { resolveRole: resolverFor(drive) });
  assert.equal(built.status, "LIBRARY_REVIEW_REQUIRED");
  assert.equal(drive.copies.length, 0);

  // Concurrent signed owner rules on a SINGLE role -> REVIEW_REQUIRED.
  const m2 = await reopen(drive);
  const base = { rule_type: "CANONICAL_ROLE_ASSIGNMENT", semantic_role: "WORKING_PAPER_TEMPLATE_LIBRARY", target_name_at_approval: "", approval_source: "OWNER", approved_by: "owner@firm", approved_at: "2026-10-05T13:00:00Z", active: "true", notes: "" };
  for (const [id, target] of [["R1", "F-LIB"], ["R2", "F-LIB2"]]) {
    const rule = { ...base, rule_id: id, target_file_id: target };
    rule.signature = signRule(rule, SECRET);
    m2.map.sheets.RULES.push(rule);
  }
  assert.equal(resolveSemanticRole(m2, "WORKING_PAPER_TEMPLATE_LIBRARY", SECRET).status, "REVIEW_REQUIRED");
});

test("approved target that disappeared -> REVIEW_REQUIRED, not silently used", async () => {
  const drive = orgDrive();
  await pass(drive);
  const memory = await reopen(drive);
  ownerApproveRole(memory, { semanticRole: "PBC_MASTER", targetFileId: "T1", approvedBy: "owner@firm", secret: SECRET, now: "2026-10-05T13:00:00Z" });
  await saveMemory(drive, memory);
  drive.files.get("T1").trashed = true;
  await pass(drive, "2026-10-06T12:00:00Z");
  const resolution = resolveSemanticRole(await reopen(drive), "PBC_MASTER", SECRET);
  assert.equal(resolution.status, "REVIEW_REQUIRED");
  assert.equal(resolution.reason, "APPROVED_TARGET_MISSING");
});

// ---------------------------------------------------------------------------
// Fix of 2026-10-07 (test on the real TATY Drive): partial / empty listings
// ---------------------------------------------------------------------------

import { getState } from "../lib/orpailleur-memory.js";
import { inventoryListing } from "../lib/agent-tools.js";

test("replay TATY 2026-10-07: an empty listing is refused, the memory is not overwritten", async () => {
  const drive = orgDrive();
  await pass(drive);
  const writesBefore = drive.updated.length;
  const empty = listingFromInventory([], { runId: "run-2", runStatus: "PARTIAL" });
  const { summary } = await pass(drive, "2026-10-07T00:45:00Z", { listing: empty });
  assert.equal(summary.status, "LISTING_EMPTY_REFUSED");
  assert.equal(summary.memory_written, false);
  assert.ok(summary.register_objects > 0);
  assert.equal(drive.updated.length, writesBefore, "MAP / REGISTER untouched");
  const memory = await reopen(drive);
  assert.equal(getState(memory, "scan_count"), "1", "the refused pass is not counted");
  assert.equal(row(memory, "DOC1").status, "PRESENT");
});

test("an incomplete listing is written with an explicit warning", async () => {
  const drive = orgDrive();
  const { summary } = await pass(drive, undefined, { maxItems: 3 });
  assert.match(summary.warning, /^LISTING_INCOMPLETE: 3 objects/);
  const memory = await reopen(drive);
  assert.match(getState(memory, "last_pass_warning"), /LISTING_INCOMPLETE/);
  const full = await pass(drive, "2026-10-06T12:00:00Z");
  assert.equal(full.summary.warning, undefined);
  assert.equal(getState(await reopen(drive), "last_pass_warning"), "");
});

test("inventory: latest COMPLETE run + rows re-tagged by a later partial run; no COMPLETE run = refused", async () => {
  const runs = [
    { id: "run-1", status: "COMPLETE", started_at: "2026-10-05T20:00:00Z" },
    { id: "run-2", status: "PARTIAL", started_at: "2026-10-07T00:40:00Z" }
  ];
  const inventory = [
    { file_id: "A", parent_id: "ROOT", folder_path: "/", name: "A", mime_type: FOLDER_MIME, last_scan_id: "run-1" },
    { file_id: "B", parent_id: "A", folder_path: "/A/", name: "B.docx", mime_type: GOOGLE_DOC_MIME, last_scan_id: "run-2" },
    { file_id: "OLD", parent_id: "ROOT", folder_path: "/", name: "old", mime_type: GOOGLE_DOC_MIME, last_scan_id: "run-0" }
  ];
  const fetchRows = async path => {
    if (path.startsWith("orpailleur_scan_runs") && path.includes("status=eq.COMPLETE")) return runs.filter(r => r.status === "COMPLETE");
    if (path.startsWith("orpailleur_scan_runs")) return runs.filter(r => r.started_at >= "2026-10-05T20:00:00Z");
    const ids = decodeURIComponent(path).match(/last_scan_id=in\.\(([^)]*)\)/)[1].split(",").map(s => s.replace(/"/g, ""));
    return inventory.filter(r => ids.includes(r.last_scan_id));
  };
  const listing = await inventoryListing("org-1", { fetchRows });
  assert.equal(listing.complete, true);
  assert.deepEqual(listing.items.map(i => i.id).sort(), ["A", "B"], "B was re-tagged by the partial run but still belongs to the Drive");
  assert.equal(await inventoryListing("org-1", { fetchRows: async () => [] }), null);
});
