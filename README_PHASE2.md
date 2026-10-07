# Office Manager AI — Phase 2: programme → work products → PBC

Branch `feature/mission-programme-wp-pbc-phase2`, started from `fb51324` (phase 1). Not merged, not deployed.

## Flow

```
mission documents → understanding → VALIDATED programme → cycles/workstreams
→ procedures → required work products (WP) → required PBC
→ received documents → content control → status / reminder
```

**Division of labour.** The Mission Controller AI reads and reasons: which procedures, which work products, which template, whether a piece of evidence complies. `lib/mission-engine.js` executes what the AI identified, after checking these preconditions:

- the programme is validated and unchanged since the analysis;
- every requirement quotes the programme verbatim;
- the template library is certain;
- each template is an eligible blank template;
- nothing is overwritten or deleted;
- VERIFIED only after a real, complete read.

The engine takes a Drive adapter, so it is tested offline. Nothing in it decides by regex what the programme requires.

## New / changed tools (Mission Controller)

| Tool | Role |
|---|---|
| `analyze_work_programme` (new) | Reads the programme: metadata, validation state, extracted text, `programme_fingerprint`. |
| `discover_wp_template_libraries` (new) | Discovers the folder(s) playing the role WORKING_PAPER_TEMPLATE_LIBRARY. Returns CONFIGURED / SINGLE_CANDIDATE / AMBIGUOUS / NONE, plus an optional validation action. |
| `inspect_wp_template_candidates` (new) | Inventory and classification of templates (metadata, path, content excerpt). |
| `build_required_working_papers` (new) | Creates only the required work products. Supports `dry_run` and optional header pre-fill. |
| `load_pbc_item` (new) | Loads one PBC line with its labelled columns and the mission parameters. |
| `record_pbc_evidence_evaluation` (new) | Records the AI's evaluation after enforcing the preconditions, then journals it. |
| `read_drive_document` | Now also returns `content_fingerprint` and `read_status`. |
| `create_or_update_mission_pbc` | Adds `pbc_item_applicability` (applicability per PBC item, driven by the programme) and `mission_type`. |
| `initialize_mission_from_template` | Now creates the folder skeleton only; it never copies files. |
| `detect_overdue_pbc_reminders` | Deduplicates per item, deadline **and state**. |

The canonical library can be configured with the generic env var `WP_TEMPLATE_LIBRARY_FOLDER_ID` (optional). Otherwise it is discovered in Drive. No folder is hardcoded.

## Status

### IMPLEMENTED (code executed by the tools, covered by offline tests)

**Programme gating**
- Programme gating: the work programme must be validated (drafts are blocked by name). The tool blocks when the version or content changed since the analysis (`programme_fingerprint` + `modifiedTime`).
- Truncated programme (>60,000 extracted characters) → `PROGRAMME_TRUNCATED_REVIEW_REQUIRED`: work-product generation and fine PBC applicability are blocked. Nobody claims the whole programme was read.
- Traceability: a requirement whose quote is not found in the programme → REVIEW_REQUIRED. No requirements → BLOCKED. More than 60 → BLOCKED.
- No "copy all" path: no tool or parameter copies a library. A folder as template → REVIEW_REQUIRED. The mission skeleton copies folders only.

**Templates and library**
- Template selection — **the AI decides, the engine verifies**:
  - Without `template_file_id` → REVIEW_REQUIRED with suggestions. Word scoring only ranks suggestions; it never triggers a copy. No candidate at all → TEMPLATE_NOT_FOUND.
  - An explicit template also requires `template_modified_at` and `template_content_fingerprint` from `inspect_wp_template_candidates`.
  - Before copying, the engine re-fetches and re-reads the template and refuses it (REVIEW_REQUIRED) if it changed, cannot be read, is outside the library, or now looks like a completed client file. Completed WPs (year, FINAL, client/archive path, filled fields) and supporting documents are excluded.
- Library certainty:
  - Executable only with CONFIGURED or SINGLE_CANDIDATE (re-checked by a fresh discovery).
  - Several library-like folders → AMBIGUOUS: nothing is copied and a validation action can be created. Example from the pilot: `03_WORKING_PAPER_TEMPLATES`, `05_WORKING_PAPERS_CYCLES_SELECTIONNES`, `03_WORKING_PAPERS_TESTS`, `06 Working files par cycle`.
  - **USER_CONFIRMED is disabled** → `OWNER_APPROVAL_MEMORY_REQUIRED`, nothing copied. Persistent owner approval will come with MAP/RULES.

**Work product creation**
- Destination: must be inside the mission folder and outside the library.
- Creation is idempotent: an existing file → ALREADY_EXISTS, never overwritten, never deleted.
- After each copy, the metadata is re-read (id, name, parent) → CREATED or FAILED.

**PBC**
- Real pilot PBC_MASTER header (row 4, A..AB), matched on exact labels:
  - **Writable (manual) columns only**: J `Applicabilité (forcer)`, P `Reçu ?`, Q `Date réception`, R `Complet ?`, W `Lien Drive`, Y `Commentaire`.
  - **Never written (formula/derived)**: K `Applicable`, S `Statut automatique`, T `Jours de retard`, X `Ouvrir`, AA `Contrôle doublon`, AB `Rang critique manquant`. Every write is also checked against the formula map.
- Item-level PBC applicability: written into J only. Only existing references are toggled, never invented; an item outside the retained cycles is refused; the programme quote is checked.
- PBC evidence evaluation — every evidence-based state (RECEIVED, PARTIAL, NON_CONFORME, VERIFIED) requires a real read: the file exists and is unchanged, the content can be read, and a fresh read matches the fingerprint. A file name is never enough.
  - RECEIVED: document nature MATCH and no MISMATCH on client/mission/scope/period → P=Oui, Q (when known), W, Y; R untouched.
  - PARTIAL → P=Partiel, R=Non, Q/W/Y.
  - VERIFIED: complete read, required checks MATCH → P=Oui, R=Oui, Q/W/Y. Formula S then computes the status.
  - NON_CONFORME: there is no manual column for it, so business cells stay unchanged; Y + journal; `CHECKLIST_STATUS_LIMITATION`.
  - REVIEW: no business status is simulated; Y + journal.
  - An existing link/date is kept; the comment is appended (never erased) and deduplicated.
  - Unreadable format → REVIEW / EXTRACTOR_REQUIRED. The final state is never higher than the AI's proposal.
- Reminders: PARTIAL / NON_CONFORME stay remindable. One action per item, deadline and state, kept PENDING for the email dispatcher.

**Generic**
- Mission types: AUDIT, DUE_DILIGENCE, ACCOUNTING_REPORTING, TAX, VALUATION_ADVISORY, ESG, OTHER. The engine does not depend on ISA.

### PARTIALLY IMPLEMENTED

- **Header pre-fill**: native Google Sheets only (first sheet, A1:Z60).
  - It matches exact labels, writes only when the target is unique, empty and not a formula; otherwise it returns HEADER_PREFILL_REVIEW_REQUIRED.
  - xlsx/docx/Google Docs → PREFILL_NOT_SUPPORTED_FOR_FORMAT: the Drive layer has no safe write for these formats. Nothing is ever claimed as pre-filled.
- **Recording in the checklist**: aligned with the real header described in the review, but not yet run against a real copy of the master. The accepted values (`Oui` / `Partiel` / `Non` in P, `Oui` / `Non` in J/R) are assumed to be the ones the sheet formulas expect.
- **Durable memory of WP creations and evaluations**: journaled in `office_agent_tool_events.metadata.journal` (non-destructive, no new table).
  - Not yet queryable as a register: there is no read tool for it.
  - Follow-ups go through `office_action_queue`.
- **Template classification**: metadata + path + content heuristics. The final choice by content is made by the AI. False negatives are possible and are deliberately conservative: a real template named with a year and no "modèle" marker → excluded → REVIEW.
- **Library discovery**: depends on Drive search (name/fullText) and on candidate scoring. Without a MAP, an ambiguous case always goes back to a human.

### NOT IMPLEMENTED (out of phase-2 scope)

- Gmail dispatcher: reminders stay pending; recipients are resolved later.
- MAP / REGISTER, computer mapping, full multi-tenancy.
- Editing xlsx/docx/Google Docs files (pre-fill for these formats).
- Extraction of PDF / scans (OCR): always REVIEW / EXTRACTOR_REQUIRED.
- Drive traceability on the created file (description/appProperties): the existing bridge does not support it.
- A Supabase register table for WPs/evaluations (would need a migration).
- Changes to the Supabase bridge/workers.

## Legacy

`TATY_*` env vars and the default IDs (shared drive, master sheet, PBC master, control registry) remain as **legacy pilot fallbacks**. The generic env vars `PBC_MASTER_FILE_ID` and `MISSION_CONTROL_REGISTRY_ID` take precedence. No new TATY ID was added.

## Tests

`npm run check` and `npm test` (offline):
- `tests/architecture.test.js`
- `tests/mission-engine.test.js`: fake Drive
- `tests/integration-mocked.test.js`: real tool and Drive layers, mocked bridge/Supabase `fetch`
