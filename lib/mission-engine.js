// Mission engine — deterministic layer of the Mission Controller.
//
//   mission documents -> understanding -> VALIDATED work programme
//   -> cycles/workstreams -> procedures -> required work products (WP)
//   -> required PBC -> received documents -> content control -> status/reminder
//
// Division of labour:
// - The Mission Controller AI READS the programme / templates / evidence and
//   REASONS (which procedures, which WP, which template, is the evidence
//   compliant). This file never decides that by regex.
// - This file EXECUTES what the AI identified, after checking preconditions:
//   programme validated and unchanged, every requirement traceable to a quoted
//   excerpt of the programme, templates inside an established library and
//   eligible, no overwrite, no deletion, VERIFIED only after a real read.
//
// Every function takes a `drive` adapter so the engine is testable offline:
//   getMeta(id)                    -> { id, name, mimeType, parents, modifiedTime, size, webViewLink }
//   listChildren(folderId)         -> [meta]
//   searchFiles({ query, mimeType, limit }) -> [meta]
//   readText(id, { maxChars })     -> { supported, text, truncated, file, extractor, reason }
//   copyFile(id, name, parentId)   -> meta
//   getValues(spreadsheetId, range)-> rows
//   getFormulaMap(spreadsheetId, sheetName|null) -> { sheetNames, sheetName, formulaCells }
//   updateValues(spreadsheetId, range, rows)

import { createHash } from "node:crypto";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const TEMPLATE_FILE_MIMES = new Set([
  GOOGLE_SHEET_MIME,
  GOOGLE_DOC_MIME,
  XLSX_MIME,
  DOCX_MIME,
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/vnd.ms-excel",
  "application/msword"
]);

// The engine is not audit-specific. "Working Paper" is the audit name of a
// mission work product; other mission types use other words.
export const MISSION_TYPES = {
  AUDIT: { workProduct: "Working Paper" },
  DUE_DILIGENCE: { workProduct: "work file" },
  ACCOUNTING_REPORTING: { workProduct: "work file" },
  TAX: { workProduct: "work file" },
  VALUATION_ADVISORY: { workProduct: "work product" },
  ESG: { workProduct: "work product" },
  OTHER: { workProduct: "work product" }
};
export const MISSION_TYPE_KEYS = Object.keys(MISSION_TYPES);

export const WP_STATUS = {
  CREATED: "CREATED",
  ALREADY_EXISTS: "ALREADY_EXISTS",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  TEMPLATE_NOT_FOUND: "TEMPLATE_NOT_FOUND",
  FAILED: "FAILED",
  PLANNED: "PLANNED" // dry run only: would be created
};

export const MAX_REQUIREMENTS_PER_RUN = 60;
const MIN_EVIDENCE_EXCERPT_CHARS = 12;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Normalization used to locate a quoted excerpt inside extracted text:
// accents, case, punctuation spacing and whitespace are ignored.
export function normalizeForMatch(value) {
  return normalizeText(value)
    .replace(/[’'`"«»]/g, " ")
    .replace(/[^a-z0-9%.,;:/()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// File/folder names often use "_" "-" "." as separators ("06_MODELES_WP"):
// turn them into spaces so word-boundary markers work.
export function normalizeName(value) {
  return normalizeText(value).replace(/[_.\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 2);
}

function slug(value, max = 40) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, max);
}

export function sanitizeFileName(value) {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

// ---------------------------------------------------------------------------
// Programme: validation, change detection, traceability
// ---------------------------------------------------------------------------

const DRAFT_NAME_PATTERN =
  /a[_ -]?valider|draft|brouillon|provisoire|en[_ -]?cours[_ -]?de[_ -]?validation/i;

export function programmeNameLooksDraft(name) {
  return DRAFT_NAME_PATTERN.test(String(name || ""));
}

// Fingerprint of the programme as it was read: identity + version + content.
export function programmeFingerprint(meta, text) {
  return sha256([
    meta?.id || "",
    meta?.modifiedTime || "",
    meta?.size || "",
    sha256(text || "")
  ].join("|"));
}

// Fingerprint of a piece of evidence as read (identity + version + content).
export function contentFingerprint(meta, text) {
  return sha256([meta?.id || "", meta?.modifiedTime || "", text || ""].join("|"));
}

// Status of a programme for a run:
// VALIDATED | VALIDATION_REQUIRED | VALIDATION_CONFLICT | PROGRAMME_CHANGED |
// NOT_A_FILE | EXTRACTOR_REQUIRED
export function checkProgrammeState({
  meta,
  read,
  validatedConfirmed,
  expectedModifiedAt = null,
  expectedFingerprint = null
}) {
  const reasons = [];

  if (!meta || meta.mimeType === FOLDER_MIME) {
    return { ok: false, status: "NOT_A_FILE", reasons: ["Programme must be a file."] };
  }

  if (!validatedConfirmed) {
    return {
      ok: false,
      status: "VALIDATION_REQUIRED",
      reasons: ["The work programme is not confirmed as validated."]
    };
  }

  if (programmeNameLooksDraft(meta.name)) {
    return {
      ok: false,
      status: "VALIDATION_CONFLICT",
      reasons: [`Programme '${meta.name}' still indicates a draft / to-be-validated version.`]
    };
  }

  if (expectedModifiedAt && meta.modifiedTime !== expectedModifiedAt) {
    reasons.push(
      `Programme modified since analysis (analysed ${expectedModifiedAt}, now ${meta.modifiedTime}).`
    );
    return { ok: false, status: "PROGRAMME_CHANGED", reasons };
  }

  if (!read?.supported) {
    return {
      ok: false,
      status: "EXTRACTOR_REQUIRED",
      reasons: [read?.reason || "Programme content cannot be extracted safely."]
    };
  }

  if (expectedFingerprint) {
    const current = programmeFingerprint(meta, read.text);
    if (current !== expectedFingerprint) {
      return {
        ok: false,
        status: "PROGRAMME_CHANGED",
        reasons: ["Programme content/version differs from the analysed version."]
      };
    }
  }

  return {
    ok: true,
    status: "VALIDATED",
    reasons,
    fingerprint: programmeFingerprint(meta, read.text),
    truncated: Boolean(read.truncated)
  };
}

// A requirement is traceable only if its quoted excerpt is actually present in
// the extracted programme text.
export function excerptFoundIn(excerpt, text) {
  const needle = normalizeForMatch(excerpt);
  if (needle.length < MIN_EVIDENCE_EXCERPT_CHARS) return false;
  return normalizeForMatch(text).includes(needle);
}

export function requirementId(programmeFileId, req) {
  return `WPR-${sha256([
    programmeFileId,
    normalizeText(req.cycle),
    normalizeText(req.workstream),
    normalizeText(req.procedure),
    normalizeText(req.required_wp_type),
    normalizeText(req.wp_code)
  ].join("|")).slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Template classification (metadata + optional content excerpt)
// ---------------------------------------------------------------------------

const TEMPLATE_MARKERS =
  /\b(modele|model|template|vierge|blank|master|canevas|trame|standard|gabarit)\b/;
const SUPPORTING_MARKERS =
  /\b(facture|invoice|releve|statement|contrat|contract|scan|scanne|justificatif|piece|attestation|bon de commande|purchase order|recu|receipt|grand livre|balance generale|fec)\b/;
const COMPLETED_NAME_MARKERS =
  /\b(final|signe|signed|revu|reviewed|complete|completed|valide|approved|v\d+_client)\b/;
const NON_LIBRARY_PATH_MARKERS =
  /\b(clients?|missions? en cours|dossiers? clients?|archives?|old|ancien|backup|sauvegarde|travaux realises)\b/;
const PLACEHOLDER_VALUE =
  /^(|\.{2,}|_{2,}|-{2,}|x{2,}|\[.*\]|<.*>|\{.*\}|a completer|to be completed|tbd|n\/a)$/i;

function filledFieldSignals(excerpt) {
  const text = normalizeText(excerpt);
  const signals = [];
  const fieldPattern =
    /(prepare par|preparer|prepared by|revu par|reviewed by|reviewer|client|entite|entity)\s*[:\-]\s*([^\n\t|]{0,60})/g;
  let match;
  while ((match = fieldPattern.exec(text))) {
    const value = match[2].trim();
    if (value && !PLACEHOLDER_VALUE.test(value) && /[a-z]{3,}/.test(value)) {
      signals.push(`${match[1]} filled ('${value.slice(0, 30)}')`);
    }
  }
  return signals;
}

// classification: TEMPLATE_LIKELY | COMPLETED_WP_SUSPECTED |
// SUPPORTING_DOCUMENT | UNSUPPORTED_TYPE | FOLDER
export function classifyTemplateCandidate({
  file,
  pathNames = [],
  excerpt = null,
  clientName = null
}) {
  if (!file || file.mimeType === FOLDER_MIME) {
    return { classification: "FOLDER", eligible: false, reasons: ["Folder, not a template file."] };
  }

  const name = normalizeName(file.name);
  const path = normalizeName(pathNames.join(" / "));
  const reasons = [];
  const templateMarker = TEMPLATE_MARKERS.test(name);

  if (!TEMPLATE_FILE_MIMES.has(file.mimeType)) {
    const supporting = /pdf|image\//.test(String(file.mimeType || ""));
    return {
      classification: supporting ? "SUPPORTING_DOCUMENT" : "UNSUPPORTED_TYPE",
      eligible: false,
      reasons: [`MIME type ${file.mimeType} is not a work-product template format.`]
    };
  }

  if (SUPPORTING_MARKERS.test(name) && !templateMarker) {
    return {
      classification: "SUPPORTING_DOCUMENT",
      eligible: false,
      reasons: ["File name indicates supporting evidence, not a template."]
    };
  }

  const completed = [];
  if (/\b(19|20)\d{2}\b/.test(name) && !templateMarker) {
    completed.push("name contains a year without template marker");
  }
  if (COMPLETED_NAME_MARKERS.test(name) && !templateMarker) {
    completed.push("name indicates a finalised/reviewed file");
  }
  if (NON_LIBRARY_PATH_MARKERS.test(path)) completed.push("located in a client/mission/archive sub-folder");
  if (excerpt) {
    completed.push(...filledFieldSignals(excerpt));
    if (clientName && normalizeText(excerpt).includes(normalizeText(clientName))) {
      completed.push("content already names the current client");
    }
  }

  if (completed.length) {
    return {
      classification: "COMPLETED_WP_SUSPECTED",
      eligible: false,
      reasons: completed
    };
  }

  if (templateMarker) reasons.push("template marker in name");
  return { classification: "TEMPLATE_LIKELY", eligible: true, reasons };
}

// ---------------------------------------------------------------------------
// Drive structure helpers
// ---------------------------------------------------------------------------

export async function isDescendantOf(drive, fileId, ancestorId, { maxDepth = 15, cache = new Map() } = {}) {
  if (!fileId || !ancestorId) return false;
  if (fileId === ancestorId) return true;
  let frontier = [fileId];
  const seen = new Set();
  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const next = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      let meta = cache.get(id);
      if (!meta) {
        try {
          meta = await drive.getMeta(id);
        } catch {
          meta = null;
        }
        cache.set(id, meta);
      }
      for (const parent of meta?.parents || []) {
        if (parent === ancestorId) return true;
        next.push(parent);
      }
    }
    frontier = next;
  }
  return false;
}

// Recursive inventory of a template library (files only, with their path).
export async function indexTemplateLibrary(drive, libraryFolderId, { maxItems = 600, maxDepth = 6, clientName = null } = {}) {
  const files = [];
  const queue = [{ id: libraryFolderId, path: [], depth: 0 }];
  let visited = 0;
  let truncated = false;

  while (queue.length) {
    const { id, path, depth } = queue.shift();
    const children = await drive.listChildren(id);
    for (const child of children) {
      visited += 1;
      if (visited > maxItems) {
        truncated = true;
        break;
      }
      if (child.mimeType === FOLDER_MIME) {
        if (depth + 1 <= maxDepth) {
          queue.push({ id: child.id, path: [...path, child.name], depth: depth + 1 });
        }
        continue;
      }
      files.push({
        file: child,
        path,
        ...classifyTemplateCandidate({ file: child, pathNames: path, clientName })
      });
    }
    if (truncated) break;
  }

  return { libraryFolderId, files, truncated };
}

// ---------------------------------------------------------------------------
// Template library discovery (no hardcoded folder: role = WORKING_PAPER_TEMPLATE_LIBRARY)
// ---------------------------------------------------------------------------

export const LIBRARY_SEARCH_QUERIES = [
  "template",
  "templates",
  "modele",
  "modèles",
  "working paper",
  "working papers",
  "feuilles de travail",
  "work papers",
  "work products",
  "bibliotheque"
];

const LIBRARY_NAME_MARKERS =
  /\b(templates?|modeles?|models?|working papers?|work ?papers?|feuilles? de travail|wp|bibliotheque|library|work products?|canevas)\b/;

export const LIBRARY_STATUS = {
  CONFIGURED: "CONFIGURED",
  SINGLE_CANDIDATE: "SINGLE_CANDIDATE",
  AMBIGUOUS: "AMBIGUOUS",
  NONE: "NONE"
};

const LIBRARY_MIN_SCORE = 4;

async function scoreLibraryCandidate(drive, folder) {
  const children = await drive.listChildren(folder.id);
  const files = children.filter(child => child.mimeType !== FOLDER_MIME);
  const subfolders = children.filter(child => child.mimeType === FOLDER_MIME);
  const classified = files.map(file => classifyTemplateCandidate({ file, pathNames: [] }));
  const eligible = classified.filter(item => item.eligible).length;
  const completed = classified.filter(item => item.classification === "COMPLETED_WP_SUSPECTED").length;
  const supporting = classified.filter(item => item.classification === "SUPPORTING_DOCUMENT").length;
  const nameMarker = LIBRARY_NAME_MARKERS.test(normalizeName(folder.name));
  const subfolderMarkers = subfolders.filter(sub => LIBRARY_NAME_MARKERS.test(normalizeName(sub.name))).length;
  const ratio = files.length ? eligible / files.length : 0;

  let score = 0;
  if (nameMarker) score += 3;
  score += Math.round(ratio * 3);
  if (files.length >= 3 || subfolders.length >= 2) score += 1;
  if (subfolderMarkers) score += 1;
  if (files.length) score -= Math.round(((completed + supporting) / files.length) * 4);

  return {
    folder: { id: folder.id, name: folder.name, webViewLink: folder.webViewLink || null, parents: folder.parents || [] },
    score,
    stats: {
      files: files.length,
      subfolders: subfolders.length,
      template_likely: eligible,
      completed_suspected: completed,
      supporting_documents: supporting
    },
    sample: children.slice(0, 15).map(child => ({ name: child.name, mimeType: child.mimeType }))
  };
}

export async function discoverTemplateLibraries(drive, { configuredFolderId = null, queries = LIBRARY_SEARCH_QUERIES, limitPerQuery = 20 } = {}) {
  if (configuredFolderId) {
    const meta = await drive.getMeta(configuredFolderId);
    if (meta?.mimeType === FOLDER_MIME) {
      const scored = await scoreLibraryCandidate(drive, meta);
      return { status: LIBRARY_STATUS.CONFIGURED, selected: scored.folder, candidates: [scored] };
    }
  }

  const found = new Map();
  for (const query of queries) {
    const results = await drive.searchFiles({ query, mimeType: FOLDER_MIME, limit: limitPerQuery });
    for (const folder of results || []) {
      if (folder?.mimeType === FOLDER_MIME && !found.has(folder.id)) found.set(folder.id, folder);
    }
  }

  const scored = [];
  for (const folder of found.values()) scored.push(await scoreLibraryCandidate(drive, folder));
  scored.sort((a, b) => b.score - a.score);

  // A sub-folder of a stronger candidate is part of that library, not a rival.
  const strong = scored.filter(item => item.score >= LIBRARY_MIN_SCORE);
  const independent = [];
  for (const item of strong) {
    let nested = false;
    for (const other of independent) {
      if (await isDescendantOf(drive, item.folder.id, other.folder.id)) nested = true;
    }
    if (!nested) independent.push(item);
  }

  if (independent.length === 1) {
    return { status: LIBRARY_STATUS.SINGLE_CANDIDATE, selected: independent[0].folder, candidates: scored };
  }
  if (independent.length > 1) {
    return { status: LIBRARY_STATUS.AMBIGUOUS, selected: null, candidates: scored };
  }
  return { status: LIBRARY_STATUS.NONE, selected: null, candidates: scored };
}

// The library used to create work products must be certain:
// CONFIGURED (env), USER_CONFIRMED (explicit human validation cited by the
// agent) or SINGLE_CANDIDATE (re-checked by a fresh discovery).
export async function verifyLibraryBasis(drive, { libraryFolderId, basis, configuredFolderId = null, confirmationNote = null }) {
  const meta = await drive.getMeta(libraryFolderId).catch(() => null);
  if (!meta || meta.mimeType !== FOLDER_MIME) {
    return { ok: false, reason: "LIBRARY_NOT_A_FOLDER" };
  }

  if (basis === "CONFIGURED") {
    return configuredFolderId && configuredFolderId === libraryFolderId
      ? { ok: true, library: meta }
      : { ok: false, reason: "LIBRARY_NOT_CONFIGURED" };
  }

  if (basis === "USER_CONFIRMED") {
    return String(confirmationNote || "").trim().length >= 10
      ? { ok: true, library: meta }
      : { ok: false, reason: "USER_CONFIRMATION_NOTE_REQUIRED" };
  }

  if (basis === "SINGLE_CANDIDATE") {
    const discovery = await discoverTemplateLibraries(drive, { configuredFolderId: null });
    return discovery.status === LIBRARY_STATUS.SINGLE_CANDIDATE &&
      discovery.selected?.id === libraryFolderId
      ? { ok: true, library: meta }
      : { ok: false, reason: `LIBRARY_NOT_SINGLE_CANDIDATE (${discovery.status})`, discovery };
  }

  return { ok: false, reason: "UNKNOWN_LIBRARY_BASIS" };
}

// ---------------------------------------------------------------------------
// Template resolution for one requirement
// ---------------------------------------------------------------------------

function templateMatchScore(req, entry) {
  const haystack = new Set(tokens(`${entry.file.name} ${entry.path.join(" ")}`));
  let score = 0;
  let strong = false;
  for (const key of [req.wp_code, req.template_reference]) {
    const keyTokens = tokens(key);
    if (keyTokens.length && keyTokens.every(token => haystack.has(token))) {
      score += 5;
      strong = true;
    }
  }
  const typeTokens = tokens(req.required_wp_type).filter(token => token.length >= 3);
  const typeHits = typeTokens.filter(token => haystack.has(token)).length;
  score += typeHits * 2;
  if (typeTokens.length && typeHits >= Math.min(2, typeTokens.length)) strong = true;
  for (const token of tokens(`${req.cycle || ""} ${req.workstream || ""}`)) {
    if (token.length >= 3 && haystack.has(token)) score += 1;
  }
  return { score, strong };
}

export async function resolveTemplate(drive, req, libraryIndex, { cache = new Map() } = {}) {
  const library = libraryIndex.libraryFolderId;

  if (req.template_file_id) {
    const entry = libraryIndex.files.find(item => item.file.id === req.template_file_id);
    if (entry) {
      return entry.eligible
        ? { status: "SELECTED", template: entry.file, basis: "AGENT_SELECTED", classification: entry.classification }
        : {
            status: WP_STATUS.REVIEW_REQUIRED,
            reason: "TEMPLATE_NOT_ELIGIBLE",
            classification: entry.classification,
            details: entry.reasons
          };
    }
    const meta = await drive.getMeta(req.template_file_id).catch(() => null);
    if (!meta) return { status: WP_STATUS.TEMPLATE_NOT_FOUND, reason: "TEMPLATE_FILE_NOT_FOUND" };
    if (meta.mimeType === FOLDER_MIME) {
      return { status: WP_STATUS.REVIEW_REQUIRED, reason: "TEMPLATE_IS_A_FOLDER" };
    }
    const inside = await isDescendantOf(drive, meta.id, library, { cache });
    if (!inside) return { status: WP_STATUS.REVIEW_REQUIRED, reason: "TEMPLATE_OUTSIDE_LIBRARY" };
    const verdict = classifyTemplateCandidate({ file: meta });
    return verdict.eligible
      ? { status: "SELECTED", template: meta, basis: "AGENT_SELECTED", classification: verdict.classification }
      : { status: WP_STATUS.REVIEW_REQUIRED, reason: "TEMPLATE_NOT_ELIGIBLE", classification: verdict.classification, details: verdict.reasons };
  }

  const scored = libraryIndex.files
    .filter(entry => entry.eligible)
    .map(entry => ({ entry, ...templateMatchScore(req, entry) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { status: WP_STATUS.TEMPLATE_NOT_FOUND, reason: "NO_ELIGIBLE_TEMPLATE_MATCH" };
  }

  const [best, second] = scored;
  const candidates = scored.slice(0, 5).map(item => ({
    id: item.entry.file.id,
    name: item.entry.file.name,
    path: item.entry.path.join(" / "),
    score: item.score
  }));

  if (best.strong && (!second || best.score > second.score)) {
    return { status: "SELECTED", template: best.entry.file, basis: "UNIQUE_MATCH", classification: best.entry.classification, candidates };
  }
  return { status: WP_STATUS.REVIEW_REQUIRED, reason: "AMBIGUOUS_TEMPLATE_MATCH", candidates };
}

// ---------------------------------------------------------------------------
// Header pre-fill (native Google Sheets only, label-based, never over formulas)
// ---------------------------------------------------------------------------

const HEADER_FIELDS = {
  client: ["client", "nom du client", "entite", "entity", "societe", "company"],
  mission: ["mission", "engagement", "intitule de la mission", "projet", "project"],
  period: ["periode", "exercice", "exercice audite", "period", "fiscal year", "year end", "date de cloture"],
  mission_reference: ["reference mission", "ref mission", "ref. mission", "engagement reference", "reference"],
  cycle: ["cycle", "workstream", "section", "domaine"],
  preparer: ["prepare par", "preparer", "prepared by", "etabli par"],
  reviewer: ["revu par", "reviewer", "reviewed by", "supervise par"],
  prepared_date: ["date de preparation", "prepared on", "date preparation"]
};

function columnLetter(number) {
  let n = number;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

export function a1(rowIndex0, colIndex0) {
  return `${columnLetter(colIndex0 + 1)}${rowIndex0 + 1}`;
}

function quoteSheet(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

// Pure planner: finds, for each field with a value, a unique label cell and
// an empty, non-formula value cell immediately to its right.
export function planHeaderPrefill(rows, formulaCells, values) {
  const formulas = new Set(formulaCells || []);
  const writes = [];
  const review = [];
  const notFound = [];

  for (const [field, labels] of Object.entries(HEADER_FIELDS)) {
    const value = values[field];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const wanted = new Set(labels.map(normalizeText));
    const hits = [];
    rows.forEach((row, r) => {
      (row || []).forEach((cell, c) => {
        const label = normalizeText(cell).replace(/\s*[:：]\s*$/, "").trim();
        if (wanted.has(label)) hits.push({ r, c });
      });
    });

    if (!hits.length) {
      notFound.push(field);
      continue;
    }
    if (hits.length > 1) {
      review.push({ field, reason: "LABEL_AMBIGUOUS", cells: hits.map(h => a1(h.r, h.c)) });
      continue;
    }
    const { r, c } = hits[0];
    const target = a1(r, c + 1);
    const current = String(rows[r]?.[c + 1] ?? "").trim();
    if (formulas.has(target)) {
      review.push({ field, reason: "TARGET_IS_FORMULA", cell: target });
      continue;
    }
    if (!PLACEHOLDER_VALUE.test(current)) {
      review.push({ field, reason: "TARGET_NOT_EMPTY", cell: target });
      continue;
    }
    writes.push({ field, cell: target, value: String(value) });
  }

  return { writes, review, notFound };
}

export async function prefillHeader(drive, file, values) {
  if (file.mimeType !== GOOGLE_SHEET_MIME) {
    return {
      status: "PREFILL_NOT_SUPPORTED_FOR_FORMAT",
      reason: `The Drive layer cannot safely edit ${file.mimeType}; nothing was pre-filled.`
    };
  }

  let formulaMap;
  try {
    formulaMap = await drive.getFormulaMap(file.id, null);
  } catch (error) {
    return { status: "HEADER_PREFILL_REVIEW_REQUIRED", reason: `FORMULA_CHECK_UNAVAILABLE: ${error.message}` };
  }
  if (!formulaMap?.sheetName) {
    return { status: "HEADER_PREFILL_REVIEW_REQUIRED", reason: "SHEET_NOT_IDENTIFIED" };
  }

  const range = `${quoteSheet(formulaMap.sheetName)}!A1:Z60`;
  const rows = await drive.getValues(file.id, range);
  const plan = planHeaderPrefill(rows, formulaMap.formulaCells, values);

  if (!plan.writes.length || plan.review.length) {
    return {
      status: "HEADER_PREFILL_REVIEW_REQUIRED",
      sheet: formulaMap.sheetName,
      written: [],
      review: plan.review,
      not_found: plan.notFound,
      reason: plan.review.length ? "AMBIGUOUS_OR_UNSAFE_TARGETS" : "NO_IDENTIFIABLE_HEADER_FIELD"
    };
  }

  for (const write of plan.writes) {
    await drive.updateValues(file.id, `${quoteSheet(formulaMap.sheetName)}!${write.cell}`, [[write.value]]);
  }
  return {
    status: "PREFILLED",
    sheet: formulaMap.sheetName,
    written: plan.writes,
    not_found: plan.notFound
  };
}

// ---------------------------------------------------------------------------
// build_required_working_papers
// ---------------------------------------------------------------------------

export function defaultWorkProductName({ missionReference, req }) {
  const code = req.wp_code ? slug(req.wp_code, 20) : slug(req.required_wp_type, 30);
  const scope = slug(req.cycle || req.workstream || "", 20);
  return sanitizeFileName([missionReference, code, scope].filter(Boolean).join("_"));
}

export async function buildRequiredWorkingPapers(drive, input, { configuredLibraryId = null, now = new Date() } = {}) {
  const result = {
    status: "BLOCKED",
    programme: null,
    library: null,
    destination: null,
    dry_run: Boolean(input.dry_run),
    work_products: [],
    duplicates_ignored: [],
    reasons: []
  };

  // 1. Hard limits — there is no "copy everything" path.
  const requirements = Array.isArray(input.requirements) ? input.requirements : [];
  if (!requirements.length) {
    result.reasons.push("NO_REQUIREMENTS: a work product is only created for a programme requirement.");
    return result;
  }
  if (requirements.length > MAX_REQUIREMENTS_PER_RUN) {
    result.reasons.push(`TOO_MANY_REQUIREMENTS (${requirements.length} > ${MAX_REQUIREMENTS_PER_RUN}).`);
    return result;
  }

  // 2. Programme validated and unchanged since analysis. The fingerprint comes
  //    from analyze_work_programme: without it there is no proof of analysis.
  if (!input.programme_fingerprint) {
    result.status = "ANALYSIS_REFERENCE_REQUIRED";
    result.reasons.push("programme_fingerprint from analyze_work_programme is required.");
    return result;
  }
  const programmeMeta = await drive.getMeta(input.programme_file_id).catch(() => null);
  const programmeRead = programmeMeta
    ? await drive.readText(input.programme_file_id, { maxChars: 60000 })
    : null;
  const programmeState = checkProgrammeState({
    meta: programmeMeta,
    read: programmeRead,
    validatedConfirmed: input.programme_validated_confirmed,
    expectedModifiedAt: input.programme_modified_at,
    expectedFingerprint: input.programme_fingerprint
  });
  result.programme = {
    file_id: programmeMeta?.id || input.programme_file_id,
    name: programmeMeta?.name || null,
    modified_at: programmeMeta?.modifiedTime || null,
    state: programmeState.status,
    fingerprint: programmeState.fingerprint || null
  };
  if (!programmeState.ok) {
    result.status = programmeState.status;
    result.reasons.push(...programmeState.reasons);
    return result;
  }

  // 3. Library certainty.
  const libraryCheck = await verifyLibraryBasis(drive, {
    libraryFolderId: input.template_library_folder_id,
    basis: input.library_basis,
    configuredFolderId: configuredLibraryId,
    confirmationNote: input.library_confirmation_note
  });
  if (!libraryCheck.ok) {
    result.status = "LIBRARY_REVIEW_REQUIRED";
    result.reasons.push(libraryCheck.reason);
    return result;
  }
  result.library = { folder_id: libraryCheck.library.id, name: libraryCheck.library.name, basis: input.library_basis };

  // 4. Destination: a folder inside the mission, never inside the library.
  const cache = new Map();
  const destination = await drive.getMeta(input.destination_folder_id).catch(() => null);
  const destinationValid =
    destination?.mimeType === FOLDER_MIME &&
    (await isDescendantOf(drive, destination.id, input.mission_root_folder_id, { cache })) &&
    !(await isDescendantOf(drive, destination.id, input.template_library_folder_id, { cache }));
  if (!destinationValid) {
    result.status = "DESTINATION_INVALID";
    result.reasons.push("Destination must be a folder inside the mission folder and outside the template library.");
    return result;
  }
  result.destination = { folder_id: destination.id, name: destination.name };

  const libraryIndex = await indexTemplateLibrary(drive, input.template_library_folder_id, {
    clientName: input.client || null
  });

  let destinationChildren = await drive.listChildren(destination.id);
  const seen = new Set();

  for (const raw of requirements) {
    const req = { ...raw };
    const id = requirementId(input.programme_file_id, req);
    if (seen.has(id)) {
      result.duplicates_ignored.push(id);
      continue;
    }
    seen.add(id);

    const item = {
      requirement_id: id,
      requirement: {
        mission_id: input.mission_id || null,
        mission_type: input.mission_type || "OTHER",
        cycle: req.cycle || null,
        workstream: req.workstream || null,
        procedure: req.procedure,
        required_wp_type: req.required_wp_type,
        wp_code: req.wp_code || null,
        template_reference: req.template_reference || null,
        preparer: req.preparer || null,
        reviewer: req.reviewer || null,
        planned_start: req.planned_start || null,
        planned_end: req.planned_end || null
      },
      programme_file_id: programmeMeta.id,
      programme_modified_at: programmeMeta.modifiedTime,
      source_evidence: req.source_evidence || null,
      status: null,
      reason: null
    };

    // Traceability: the quoted excerpt must exist in the validated programme.
    if (!excerptFoundIn(req.source_evidence?.excerpt, programmeRead.text)) {
      item.status = WP_STATUS.REVIEW_REQUIRED;
      item.reason = programmeRead.truncated
        ? "SOURCE_EXCERPT_NOT_FOUND (programme text truncated by extractor)"
        : "SOURCE_EXCERPT_NOT_FOUND_IN_PROGRAMME";
      result.work_products.push(item);
      continue;
    }

    const resolved = await resolveTemplate(drive, req, libraryIndex, { cache });
    if (resolved.status !== "SELECTED") {
      item.status = resolved.status;
      item.reason = resolved.reason;
      item.template_candidates = resolved.candidates || [];
      if (resolved.details) item.details = resolved.details;
      result.work_products.push(item);
      continue;
    }
    item.template = {
      file_id: resolved.template.id,
      name: resolved.template.name,
      mime_type: resolved.template.mimeType,
      selection_basis: resolved.basis
    };

    const targetName = sanitizeFileName(req.target_name) ||
      defaultWorkProductName({ missionReference: input.mission_reference, req });
    item.target_name = targetName;

    const existing = destinationChildren.find(
      child => child.mimeType !== FOLDER_MIME && child.name === targetName
    );
    if (existing) {
      item.status = WP_STATUS.ALREADY_EXISTS;
      item.file = { file_id: existing.id, name: existing.name, url: existing.webViewLink || null };
      result.work_products.push(item);
      continue;
    }

    if (input.dry_run) {
      item.status = WP_STATUS.PLANNED;
      result.work_products.push(item);
      continue;
    }

    try {
      const copy = await drive.copyFile(resolved.template.id, targetName, destination.id);
      const confirmed = copy?.id ? await drive.getMeta(copy.id).catch(() => null) : null;
      if (
        !confirmed ||
        confirmed.name !== targetName ||
        !(confirmed.parents || []).includes(destination.id)
      ) {
        item.status = WP_STATUS.FAILED;
        item.reason = "COPY_NOT_CONFIRMED_BY_METADATA";
        if (copy?.id) item.file = { file_id: copy.id };
        result.work_products.push(item);
        continue;
      }
      item.status = WP_STATUS.CREATED;
      item.file = {
        file_id: confirmed.id,
        name: confirmed.name,
        url: confirmed.webViewLink || null,
        mime_type: confirmed.mimeType,
        created_at: now.toISOString()
      };
      destinationChildren = [...destinationChildren, confirmed];

      if (input.prefill_headers) {
        item.prefill = await prefillHeader(drive, confirmed, {
          client: input.client,
          mission: input.mission_name,
          period: input.period,
          mission_reference: input.mission_reference,
          cycle: req.cycle || req.workstream,
          preparer: req.preparer,
          reviewer: req.reviewer,
          prepared_date: input.prefill_prepared_date ? now.toISOString().slice(0, 10) : null
        }).catch(error => ({
          status: "HEADER_PREFILL_REVIEW_REQUIRED",
          reason: `PREFILL_ERROR: ${error.message}`
        }));
      }
    } catch (error) {
      item.status = WP_STATUS.FAILED;
      item.reason = String(error?.message || error).slice(0, 300);
    }
    result.work_products.push(item);
  }

  const counts = {};
  for (const item of result.work_products) counts[item.status] = (counts[item.status] || 0) + 1;
  result.counts = counts;
  result.status = "COMPLETED";
  return result;
}

// ---------------------------------------------------------------------------
// PBC: header-driven sheet access, programme-driven item applicability
// ---------------------------------------------------------------------------

export const PBC_HEADER_ROW = 4; // PBC_MASTER!A4 holds the column headers.

const PBC_COLUMN_LABELS = {
  applicable: [/applicab/],
  evaluation_status: [/statut.*(controle|evaluation|verification|ia)/, /(controle|evaluation|verification).*(contenu|ia|statut)/],
  evidence_link: [/lien.*(preuve|piece|fichier|document)/, /(preuve|evidence).*(lien|link|fichier|file)/, /^lien$/],
  verification_date: [/date.*(verification|controle|evaluation)/, /(verifie|controle) le/],
  comment: [/commentaire/, /observation/, /remarque/, /rationale/, /justification/]
};

export function findPbcColumns(headerRow) {
  const out = {};
  const ambiguous = {};
  for (const [key, patterns] of Object.entries(PBC_COLUMN_LABELS)) {
    const hits = [];
    (headerRow || []).forEach((cell, index) => {
      const label = normalizeText(cell);
      if (label && patterns.some(pattern => pattern.test(label))) hits.push(index);
    });
    if (hits.length === 1) out[key] = hits[0];
    else if (hits.length > 1) ambiguous[key] = hits;
  }
  return { columns: out, ambiguous };
}

export function parseCycleCodes(value) {
  return [...new Set(
    String(value || "")
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter(code => /^[A-Z]{3}$/.test(code))
  )];
}

// Item-level applicability inside retained cycles. Nothing is ever invented:
// a decision must target an existing master reference and quote the programme.
export function planPbcItemApplicability({ rows, retainedCycles, decisions, programmeText }) {
  const retained = new Set((retainedCycles || []).map(code => String(code).trim().toUpperCase()));
  const plan = [];
  for (const decision of decisions || []) {
    const index = rows.findIndex((row, i) => i > 0 && String(row?.[0] || "").trim() === decision.pbc_reference);
    const entry = { pbc_reference: decision.pbc_reference, applicable: Boolean(decision.applicable) };
    if (index < 0) {
      plan.push({ ...entry, status: "REJECTED_UNKNOWN_REFERENCE" });
      continue;
    }
    const cycles = parseCycleCodes(rows[index]?.[4]);
    entry.row_number = PBC_HEADER_ROW + index;
    entry.item_cycles = cycles;
    if (decision.applicable && cycles.length && !cycles.some(code => retained.has(code))) {
      plan.push({ ...entry, status: "REJECTED_CYCLE_NOT_RETAINED" });
      continue;
    }
    if (!excerptFoundIn(decision.source_evidence_excerpt, programmeText)) {
      plan.push({ ...entry, status: "REJECTED_SOURCE_NOT_IN_PROGRAMME" });
      continue;
    }
    entry.rationale = String(decision.programme_procedure || "").slice(0, 300);
    plan.push({ ...entry, status: "PLANNED" });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// PBC evidence evaluation (AI judges; this layer checks preconditions)
// ---------------------------------------------------------------------------

export const PBC_STATES = ["REQUESTED", "RECEIVED", "PARTIAL", "NON_CONFORME", "REVIEW", "VERIFIED"];
export const CHECK_VALUES = ["MATCH", "MISMATCH", "PARTIAL", "NOT_APPLICABLE", "NOT_CHECKED"];
export const EVIDENCE_CHECK_KEYS = ["client", "mission", "scope_account", "period", "completeness", "document_nature"];
const VERIFIED_REQUIRED_MATCH = ["client", "period", "completeness", "document_nature"];

// proposed: state the AI concluded. read: a FRESH read done by the recording
// tool. Returns the state that may be recorded (never higher than proposed).
export function decidePbcEvaluation({
  proposed,
  checks = {},
  rationale = "",
  evidenceMeta,
  analysedModifiedTime,
  analysedFingerprint,
  read
}) {
  const reasons = [];
  const review = reason => ({ final_state: "REVIEW", downgraded: proposed !== "REVIEW", reasons: [...reasons, reason] });

  if (!PBC_STATES.includes(proposed)) return review("UNKNOWN_STATE");
  if (proposed === "REQUESTED" || proposed === "REVIEW") {
    return { final_state: proposed, downgraded: false, reasons };
  }
  if (!evidenceMeta) return review("EVIDENCE_FILE_NOT_FOUND");
  if (analysedModifiedTime && evidenceMeta.modifiedTime !== analysedModifiedTime) {
    return review("EVIDENCE_CHANGED_SINCE_ANALYSIS");
  }
  if (proposed === "RECEIVED") {
    return { final_state: "RECEIVED", downgraded: false, reasons };
  }

  // PARTIAL, NON_CONFORME and VERIFIED are content judgements: they require
  // proof that the content was really read, and that it is the same content.
  if (!read?.supported) return review("EXTRACTOR_REQUIRED");
  if (!analysedFingerprint) return review("NO_PROOF_OF_CONTENT_READ");
  if (contentFingerprint(evidenceMeta, read.text) !== analysedFingerprint) {
    return review("CONTENT_FINGERPRINT_MISMATCH");
  }
  if (String(rationale || "").trim().length < 20) return review("RATIONALE_REQUIRED");

  const values = Object.fromEntries(EVIDENCE_CHECK_KEYS.map(key => [key, checks[key] || "NOT_CHECKED"]));

  if (proposed === "VERIFIED") {
    if (read.truncated) return review("CONTENT_TRUNCATED_NOT_FULLY_READ");
    for (const key of VERIFIED_REQUIRED_MATCH) {
      if (values[key] !== "MATCH") return review(`CHECK_${key.toUpperCase()}_NOT_MATCH`);
    }
    for (const key of EVIDENCE_CHECK_KEYS) {
      if (!["MATCH", "NOT_APPLICABLE"].includes(values[key])) {
        return review(`CHECK_${key.toUpperCase()}_${values[key]}`);
      }
    }
    return { final_state: "VERIFIED", downgraded: false, reasons };
  }

  if (proposed === "PARTIAL") {
    const hasGap = Object.values(values).some(v => v === "PARTIAL" || v === "MISMATCH");
    return hasGap ? { final_state: "PARTIAL", downgraded: false, reasons } : review("PARTIAL_WITHOUT_FAILED_CHECK");
  }

  // NON_CONFORME
  return Object.values(values).includes("MISMATCH")
    ? { final_state: "NON_CONFORME", downgraded: false, reasons }
    : review("NON_CONFORME_WITHOUT_MISMATCH");
}

// ---------------------------------------------------------------------------
// PBC sheet operations (header-driven, never over formulas)
// ---------------------------------------------------------------------------

export const PBC_SHEET = "PBC_MASTER";
const PBC_RANGE = `${PBC_SHEET}!A${PBC_HEADER_ROW}:AB1000`;

export async function loadPbcItem(drive, spreadsheetId, reference) {
  const rows = await drive.getValues(spreadsheetId, PBC_RANGE);
  const header = rows[0] || [];
  const index = rows.findIndex((row, i) => i > 0 && String(row?.[0] || "").trim() === reference);
  if (index < 0) return { found: false, reference };
  const row = rows[index];
  const labelled = {};
  header.forEach((label, col) => {
    const key = String(label || "").trim() || a1(0, col).replace(/\d+$/, "");
    labelled[key] = row?.[col] ?? "";
  });
  return {
    found: true,
    reference,
    row_number: PBC_HEADER_ROW + index,
    header,
    values: row,
    labelled,
    ...findPbcColumns(header)
  };
}

async function safeCellWrites(drive, spreadsheetId, rowNumber, writes) {
  // writes: [{ key, col, value }]
  if (!writes.length) return { written: [], skipped: [] };
  let formulaMap;
  try {
    formulaMap = await drive.getFormulaMap(spreadsheetId, PBC_SHEET);
  } catch (error) {
    return { written: [], skipped: writes.map(w => ({ key: w.key, reason: `FORMULA_CHECK_UNAVAILABLE: ${error.message}` })) };
  }
  const formulas = new Set(formulaMap?.formulaCells || []);
  const written = [];
  const skipped = [];
  for (const write of writes) {
    const cell = a1(rowNumber - 1, write.col);
    if (formulas.has(cell)) {
      skipped.push({ key: write.key, cell, reason: "TARGET_IS_FORMULA" });
      continue;
    }
    await drive.updateValues(spreadsheetId, `${PBC_SHEET}!${cell}`, [[write.value]]);
    written.push({ key: write.key, cell });
  }
  return { written, skipped };
}

// Applies a planned item-level applicability (see planPbcItemApplicability).
export async function applyPbcItemPlan(drive, spreadsheetId, plan) {
  const rows = await drive.getValues(spreadsheetId, `${PBC_SHEET}!A${PBC_HEADER_ROW}:AB${PBC_HEADER_ROW}`);
  const { columns, ambiguous } = findPbcColumns(rows[0] || []);
  const results = [];
  for (const entry of plan) {
    if (entry.status !== "PLANNED") {
      results.push(entry);
      continue;
    }
    if (columns.applicable === undefined) {
      results.push({ ...entry, status: "ITEM_OVERRIDE_REVIEW_REQUIRED", reason: ambiguous.applicable ? "APPLICABLE_COLUMN_AMBIGUOUS" : "APPLICABLE_COLUMN_NOT_FOUND" });
      continue;
    }
    const writes = [{ key: "applicable", col: columns.applicable, value: entry.applicable ? "Oui" : "Non" }];
    if (columns.comment !== undefined) {
      writes.push({ key: "comment", col: columns.comment, value: `Programme: ${entry.rationale || "décision programme"}` });
    }
    const outcome = await safeCellWrites(drive, spreadsheetId, entry.row_number, writes);
    const applied = outcome.written.some(w => w.key === "applicable");
    results.push({
      ...entry,
      status: applied ? "APPLIED" : "ITEM_OVERRIDE_REVIEW_REQUIRED",
      written: outcome.written,
      skipped: outcome.skipped
    });
  }
  return results;
}

// Records an evaluation decided by decidePbcEvaluation into the checklist
// columns that can be identified unambiguously by their header label.
export async function writePbcEvaluation(drive, spreadsheetId, item, record) {
  const writes = [];
  const { columns } = item;
  if (columns.evaluation_status !== undefined) writes.push({ key: "evaluation_status", col: columns.evaluation_status, value: record.final_state });
  if (columns.evidence_link !== undefined) writes.push({ key: "evidence_link", col: columns.evidence_link, value: record.evidence_url || record.evidence_file_id });
  if (columns.verification_date !== undefined) writes.push({ key: "verification_date", col: columns.verification_date, value: record.evaluated_at.slice(0, 10) });
  if (columns.comment !== undefined) writes.push({ key: "comment", col: columns.comment, value: `[${record.final_state}] ${record.rationale}`.slice(0, 500) });
  if (!writes.length) {
    return { status: "SHEET_WRITE_REVIEW_REQUIRED", reason: "NO_EVALUATION_COLUMN_IDENTIFIED", written: [] };
  }
  const outcome = await safeCellWrites(drive, spreadsheetId, item.row_number, writes);
  return {
    status: outcome.written.length === writes.length ? "WRITTEN" : outcome.written.length ? "PARTIALLY_WRITTEN" : "SHEET_WRITE_REVIEW_REQUIRED",
    ...outcome
  };
}
