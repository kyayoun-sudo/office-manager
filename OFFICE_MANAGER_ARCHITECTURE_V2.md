# Office Manager AI — Architecture V2

## Core roles
- **Firm Manager**: pre-engagement, staffing, capacity, people intelligence, KPI, Partner decision package.
- **Mission Controller**: engagement workflow, preliminary requests, planning gates, PBC, reviews, sign-offs, closing.
- **Enhanced Auditor**: risk analysis, work programme, WP/evidence review, cycle coverage.
- **Document Intelligence / Orpailleur**: search/indexing, content-based classification, naming, filing, version control, archive pass.
- **Sika**: billing and collections.
- **Shadow**: controlled learning/testing only.

## Customer-owned data
Files stay in the firm's repository. Office Manager stores primarily IDs, links, states, versions/hashes, relationships, assignments, events, decisions and next actions.

## PBC rule
A PBC email is not finished when the checklist is updated. Each attachment must be:
1. identified;
2. read/classified;
3. duplicate-checked;
4. renamed when necessary;
5. **physically filed in the engagement documentation**;
6. linked to the PBC;
7. reflected in the checklist;
8. evaluated against expected population/components.

Example: five bank accounts expected, one statement received => `PARTIAL 1/5`, never complete.

## Two inbound routes
### Client email
Client reply -> Mission Controller mailbox/thread -> extract -> classify -> file in engagement documentation -> PBC update -> completeness check.

### Auditor upload
Auditor scan/photo/upload -> Orpailleur -> classify/name/file -> PBC event -> Mission Controller updates checklist.

## Review/sign-off
Auditors work in Excel/Drive. Office Manager presents the actual file in the review UI. A sign-off is tied to reviewer + role + timestamp + exact file ID + version/revision + hash. A later material modification triggers re-review.

## Archive
Report issued -> closing controls -> **official archive/closing document** -> approval -> `MISSION_READY_FOR_ARCHIVE` -> Orpailleur archive pass -> resolve/block anomalies -> technical Archive Manifest -> freeze/archive.

The official archive document and technical Archive Manifest are different artifacts.
