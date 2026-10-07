# Office Manager AI — Phase 3: Orpailleur MAP / REGISTER

Branch `feature/orpailleur-map-register-phase3`, from `05126da` (phase 2 + review fixes). Not merged, not deployed. **No scan and no write on the real Drive during development**: all tests are simulated.

## Principle

```
MAP FIRST → EXPLAIN → OWNER VALIDATES AMBIGUITIES → REMEMBER → THEN ACT
```

Exactly two durable, visible files, located by exact name in `OFFICE_MANAGER_MEMORY_FOLDER_ID` (default: the Shared Drive root) and **updated in place** (same file_id on every run):

- `OFFICE_MANAGER_MAP.xlsx`: business understanding. Sheets: `MAP`, `RULES`, `ROLES`, `STATE`.
- `OFFICE_MANAGER_REGISTER.xlsx`: technical memory. Sheet: `REGISTER`.

If two files with the same name exist, the run fails with `MEMORY_FILE_DUPLICATE`: no third file is created and none is picked arbitrarily. A file modified between read and write causes a `MEMORY_CONFLICT` abort, never an overwrite.

## Exact structures

### MAP (sheet `MAP`)
`map_id | org | semantic_role | target_file_id | target_kind | target_name | target_path | canonical_status | confidence | rationale | owner_approval_status | rule_id | proposed_by | proposed_at | last_verified_at | notes`

- `canonical_status`: AI_HYPOTHESIS · OWNER_APPROVED · REJECTED · SUPERSEDED · TARGET_MISSING (note)
- `owner_approval_status`: PENDING · APPROVED · REJECTED
- Memory is about the **role**, keyed by `target_file_id`. `target_name` and `target_path` are refreshed on every pass: if the folder moves, the role stays the same.

### RULES (sheet `RULES`), the owner's memory
`rule_id | rule_type | semantic_role | target_file_id | target_name_at_approval | approval_source | approved_by | approved_at | active | signature | notes`

- `rule_type`: CANONICAL_ROLE_ASSIGNMENT · ROLE_REJECTION · MAPPING_REVIEWED
- `approval_source` = OWNER only. `signature` = HMAC-SHA256 over (rule_id, type, role, target, source, approver, date, active) with `OWNER_APPROVAL_SECRET`, a secret held only by the server.
- A rule without a valid signature is **ignored** and reported in `unverified_rules_ignored`. Editing a cell (target, active, …) invalidates the signature.

### ROLES (sheet `ROLES`)
`semantic_role | cardinality | description | requires_owner_approval | used_by`

ACTIVE_ENGAGEMENTS, CLOSED_ENGAGEMENTS, SOP_LIBRARY, WORKING_PAPER_TEMPLATE_LIBRARY, PBC_MASTER, MISSION_PROGRAMMES, HR_CV_LIBRARY, FINANCE_ADMIN, ARCHIVES, OFFICE_MANAGER_MEMORY, OTHER.

SINGLE roles (WP library, PBC master, SOP, HR CVs) allow only one approved target.

### STATE (sheet `STATE`)
`key | value | updated_at`

Keys: `org`, `mapping_state`, `scan_count`, `last_scan_at`, `last_scan_complete`, `last_listing_source`, `last_pass_summary`.

### REGISTER (sheet `REGISTER`)
`file_id | parent_id | name | path | mime_type | size | modified_time | created_time | md5 | web_url | is_folder | first_seen_at | last_seen_at | last_inspected_at | content_fingerprint | read_status | semantic_role | classification | client | mission | understanding_status | understanding_confidence | understanding_rationale | status | change_type | missing_since | missing_checks | last_action | last_action_at`

- `status` (presence): PRESENT · MISSING_PENDING_CHECK · MOVED_OUT_OF_SCOPE · TRASHED · DELETED_OR_MISSING
- `understanding_status`: PENDING_READ · NEEDS_UNDERSTANDING · UNDERSTOOD · METADATA_ONLY · EXTRACTOR_REQUIRED
- `read_status`: READ · EXTRACTOR_REQUIRED · SKIPPED_SYSTEM
- `file_id` is the stable identity.

## Scanner states

- **Mapping**: FIRST_MAPPING → MAPPING_PENDING_REVIEW (after the first *complete* pass) → MAPPING_REVIEWED (**only** through a signed owner `MAPPING_REVIEWED` rule; a STATE cell edited by hand is not trusted).
- **Pass**: FIRST_MAPPING (first pass) or DIFFERENTIAL.
- **Changes**: UNCHANGED · NEW · MODIFIED · RENAMED · MOVED · DELETED_OR_MISSING, plus the interim MISSING_PENDING_CHECK, MOVED_OUT_OF_SCOPE, TRASHED.

Differential rules:
- UNCHANGED: never re-read.
- NEW / MODIFIED / RENAMED / MOVED business files: opened and read (fingerprint), then queued as NEEDS_UNDERSTANDING for the AI.
- Absent files: looked up by id first. Trashed → TRASHED; found elsewhere → MOVED_OUT_OF_SCOPE; not found → MISSING_PENDING_CHECK. DELETED_OR_MISSING is declared only after **2 complete passes**.
- An incomplete listing never concludes that a file is absent.
- System files (`~$`, `.tmp`, `.dll`, `desktop.ini`, …): metadata only.
- PDFs / images: EXTRACTOR_REQUIRED.

## New tools

| Tool | Agent | Effect |
|---|---|---|
| `run_mapping_pass` | Orpailleur | Mapping / differential pass. Read-only on business files; creates/updates only MAP + REGISTER. Listing source: `DRIVE_WALK` or `ORPAILLEUR_INVENTORY` (latest run of the existing durable scanner, reused as-is). |
| `get_files_to_understand` | Orpailleur | Objects to understand: excerpt + fingerprint for files, children names for folders. |
| `record_file_understanding` | Orpailleur | Records the AI's understanding. Requires the fingerprint; refuses stale or unread files. |
| `propose_map_role` | Orpailleur | AI_HYPOTHESIS + owner validation action. **Never an approval.** |
| `get_mapping_report` | Orpailleur, Grand Contrôleur | Explanation for the owner + the only questions to ask. |
| `resolve_semantic_role` | Orpailleur, Mission Controller, Grand Contrôleur | OWNER_APPROVED / REVIEW_REQUIRED / NO_OWNER_APPROVAL / NO_MAP. |

**Owner endpoint**: `api/owner.js`. Header `x-office-manager-owner-token` = `OFFICE_MANAGER_OWNER_TOKEN` (distinct from the pilot token).
- GET: report + pending proposals.
- POST `approve_role` · `reject_role` · `deactivate_rule` · `mark_mapping_reviewed`.

This is the only path that writes a signed rule. No agent tool reaches it.

## Mission Controller integration

- `library_basis` = `CONFIGURED` · `OWNER_APPROVED_MAP` · `SINGLE_CANDIDATE`.
- `OWNER_APPROVED_MAP` is accepted only if `resolve_semantic_role(WORKING_PAPER_TEMPLATE_LIBRARY)` returns an active, signed, present owner rule for **that exact folder**. The free-text note is removed.
- `discover_wp_template_libraries` checks the MAP first.
- PBC master source: explicit > MAP `PBC_MASTER` (owner) > legacy default.
- **Mapping gate**: the business Drive writes require MAPPING_REVIEWED. Otherwise they return `MAPPING_REVIEW_REQUIRED`. These writes are:
  - skeleton;
  - WP creation outside dry-run;
  - PBC creation;
  - writing an evaluation into the checklist.
- `OFFICE_MANAGER_REQUIRE_MAPPING=false` = explicit **legacy** mode for the pilot before its first mapping.

## Status

### IMPLEMENTED (code + offline tests)
- First mapping before any action. No move, rename, deletion, business folder or filing: the only Drive writes are the 2 memory files.
- The same 2 files are updated in place. Duplicate → error; concurrent modification → abort.
- REGISTER keyed by file_id. Change types UNCHANGED/NEW/MODIFIED/RENAMED/MOVED; unchanged files are not re-read.
- Absence: looked up by id, TRASHED / MOVED_OUT_OF_SCOPE / MISSING_PENDING_CHECK, then DELETED_OR_MISSING after 2 complete passes. No conclusion on an incomplete listing.
- AI understanding recorded with fingerprint control; the MAP does not decide in place of the AI.
- Signed owner rules: persistent (xlsx round-trip), survive path changes, forgeries and unsigned "approvals" ignored. SINGLE role with concurrent rules → REVIEW_REQUIRED; approved target missing → REVIEW_REQUIRED.
- `OWNER_APPROVED_MAP` usable by Mission Controller. Ambiguous MAP → no automatic action.
- Reuse of `orpailleur_inventory` / `orpailleur_scan_runs` (latest COMPLETE/PARTIAL run) as the listing source.

### PARTIAL
- **MAP/REGISTER writing through the bridge (Phase 3.1)**: implemented in the repository (`create_binary_file` / `update_binary_file` actions of `taty-google-bridge`). **The new Edge Function version is not deployed**: as long as it is not deployed, the live bridge will answer `UNKNOWN_ACTION` and the pass will fail without writing anything.
- Owner interface: API endpoint only. There is no screen yet in `index.html`.
- Whole Drive walk in one tool call (BFS, `max_items` limit). No resumption across invocations: for a large Drive, use `ORPAILLEUR_INVENTORY` (the durable scanner is paged and resumable).
- Reading is bounded per pass (`max_reads`); the rest stays PENDING_READ for the next passes.
- Folder understanding: name + children (no deep reading of contents).

### NOT IMPLEMENTED
- Physical filing/moving (Orpailleur still has no write tool on business documents).
- Computer mapping, system zones outside the Drive.
- PDF / OCR extraction.
- Scheduled/automatic passes (the pass runs on request).
- Changes to the durable worker and the bridge (reused, not modified).
- Real Drive test: planned separately after review.

## New environment variables (generic)

| Variable | Purpose |
|---|---|
| `OFFICE_MANAGER_MEMORY_FOLDER_ID` | Folder of the 2 memory files |
| `OFFICE_MANAGER_SCAN_ROOT_ID` | Mapping scope |
| `OWNER_APPROVAL_SECRET` | Signing of owner rules |
| `OFFICE_MANAGER_OWNER_TOKEN` | Owner credential |
| `OFFICE_MANAGER_REQUIRE_MAPPING=false` | Legacy mode |

## Phase 3.1 — MAP / REGISTER writable through the existing bridge

Two actions are added to `supabase/functions/taty-google-bridge` (source versioned in the repository; logic in `binary-files.ts`, shared with the offline tests):

- `create_binary_file { parent_id, name, mime_type, base64, expected_name? }`:
  - Drive `files.create` multipart in the parent folder.
  - Refuses if a file with the same name already exists there (`FILE_ALREADY_EXISTS`).
  - Re-reads the metadata and returns `id, name, mimeType, parents, modifiedTime, createdTime, webViewLink, size`.
- `update_binary_file { file_id, mime_type, base64, expected_modified_time }`:
  - Reads the current metadata. If `modifiedTime` ≠ `expected_modified_time` → `MEMORY_CONFLICT` (409) and **nothing is written**.
  - Otherwise `files.update` media on the **same file_id**, then re-reads and returns the final file.

Safeguards:
- `x-orpailleur-secret` kept.
- MIME allow-list (xlsx only).
- **Name allow-list** (`OFFICE_MANAGER_MAP.xlsx`, `OFFICE_MANAGER_REGISTER.xlsx` only): the bridge can never overwrite a business file.
- 10 MB maximum, checked before decoding.
- Strict, mandatory base64.
- `parent_id` mandatory.
- Parent / target must belong to the configured Shared Drive (`driveId`) and not be in the trash.
- No folder target, no MIME change, no move, no delete, no caller-supplied URL.

`lib/google-drive.js`: `createBinaryFile` / `updateBinaryFile` use the bridge when it is the active connection; the memory engine does not see the difference. `expectedModifiedTime` is now mandatory and re-checked by the writer (bridge or direct API). `run_mapping_pass` no longer returns `MEMORY_WRITE_UNAVAILABLE`.
