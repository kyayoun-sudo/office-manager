# Integration plan — current repository

Base inspected: `feature/white-label-desktop` at `a42dcf9c1f74c6e28e999ed027270295cf04941e`.

## Existing behavior to preserve
- `agents/index.js` currently uses technical root key `grand-controleur`.
- `lib/agent-mailbox.js` already reads a configured Gmail label, identifies likely PBC/mission, creates a validation action, and after approval deposits attachments + original `.eml`.
- Today those approved email attachments are deposited into `00_A_REVOIR_AGENT` for later Orpailleur filing.
- `lib/global-search.js` already gives a lightweight read-only search over Orpailleur inventory, missions and people.
- `lib/mission-status.js` already allows `closed -> archived` and blocks normal moves out of archived.
- Latest Orpailleur work already favors small Supabase checkpoints + durable Drive memory + differential passes.

## Target changes

### A. Firm Manager naming
Change visible/business name from `Grand Contrôleur / Office Manager AI` to `Firm Manager`.
Keep technical key `grand-controleur` temporarily so historical DB/schedules do not break.

### B. Email -> PBC -> documentation
Current safe fallback `00_A_REVOIR_AGENT` remains for ambiguous cases.

When engagement + PBC + destination are proven:
1. fetch attachment;
2. read/classify;
3. resolve approved engagement documentation destination;
4. duplicate/hash check;
5. rename;
6. physically store there;
7. preserve Message-ID/thread/source;
8. update PBC only after successful storage;
9. evaluate expected population/components.

Use `lib/pbc-document-service.js`.

Never mark PBC complete because download succeeded.

### C. PBC completeness
Use `lib/pbc-state.js`:
- unknown population => `POPULATION_TO_CONFIRM`
- some expected components => `PARTIAL`
- all expected received but not content-verified => `RECEIVED`
- content checks match => `VERIFIED`

### D. Auditor upload
On new evidence:
Orpailleur classifies/files -> emit `PBC_DOCUMENT_RECEIVED` -> Mission Controller updates PBC.

### E. Archive
Before `closed -> archived`:
- official archive/closing document completed and approved;
- use `archiveReadiness()`;
- emit `MISSION_READY_FOR_ARCHIVE`;
- Orpailleur archive pass;
- if anomalies => `ARCHIVE_BLOCKED`;
- generate Archive Manifest;
- then archive/freeze.

### F. Search
Keep current `global-search.js` as fast Level 1 index.
Later add Level 2 content-on-demand:
- select top candidate document refs;
- read only those files;
- search actual contents;
- return source links.
Do not copy the whole Drive corpus into Supabase.

## Commit order
1. Add these V2 helper files + tests.
2. Rename visible root to Firm Manager.
3. Integrate PBC population state.
4. Integrate email -> documentation routing.
5. Integrate auditor-upload event.
6. Add archive gate/pass.
7. Add deep search.
8. Only then UI wiring.

## Non-negotiables
- no duplicate mission creation;
- no PBC state update before actual repository write;
- no `SENT` without email success evidence;
- no `VERIFIED` from filename;
- no sign-off detached from exact version/hash;
- no archive without official archive document and archive pass;
- no second full Drive memory in Supabase;
- no unnecessary sensitive HR data copied into operational tables.
