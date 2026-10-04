# Office Manager AI — V2.2 Operational Tools

This patch turns the V2 multi-agent architecture into an operational agent layer while preserving TATY's Drive as the business source of truth.

## What changes

### Grand Contrôleur live tools
- `get_team_directory`
- `read_taty_master_sheet`
- `find_drive_documents`
- `read_drive_document` (Google Docs, DOCX, XLSX/native Sheets export, text)
- `find_indexed_documents`
- `get_mission_controls`
- `initialize_mission_from_template`
- `upsert_confirmed_planning_assignment`
- `sync_validated_programme_assignments`
- `refresh_capacity_calendar`
- `find_available_staff`
- `refresh_kpi_snapshot`
- `create_or_update_mission_pbc`
- `inspect_pbc_checklist`
- `create_internal_followup`

### Orpailleur live tools
- actual Drive search
- safe document reading
- durable inventory search
- archive index search

Physical move/rename/restore remains intentionally disabled in this patch until the controlled filing worker is exposed as a safe tool.

## Drive architecture rules

- The real TATY Drive remains the business source of truth.
- `TATY_AI_MASTER_DATA` is a control/index register, not a duplicate filesystem.
- Supabase is technical memory, audit trail and permissions.
- Mission staffing is synchronized only from source-confirmed validated work programmes.
- CV/skills can support a staffing recommendation but cannot create a confirmed assignment without human validation.
- Capacity is aggregated by person + mission + period before overlap calculations, so multiple cycles on one mission do not multiply the same mission load.

## PBC safety

The tool `create_or_update_mission_pbc` copies `TATY_PBC_MASTER_SYSCOHADA_ISA` and sets mission parameters/cycle applicability only when the programme is explicitly confirmed as validated.

Files whose name still contains `A_VALIDER`, `DRAFT` or `BROUILLON` are blocked even if they sit inside a folder called `PLANIFICATION_VALIDE`.

## Google bridge

A protected Supabase Edge Function `taty-google-bridge` is included here for source control and has already been deployed to the TATY Supabase project with JWT verification enabled.

Vercel can use the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `ORPAILLEUR_JOB_SECRET` to call this bridge. This avoids copying Google credentials into Vercel.

The bridge exposes only an allow-listed set of Drive/Sheets operations needed by the agents.

## Telemetry

Every live specialist tool call writes to `office_agent_tool_events`. The API now derives `specialists_used` and `tools_used` from both the Agents SDK and the durable tool-event journal.

## Files to upload to branch `v2-multi-agent`

Replace/add:
- `agents/index.js`
- `api/agent.js`
- `api/health.js`
- `lib/agent-tools.js` (new)
- `lib/google-drive.js` (new)
- `lib/orchestrator.js`
- `lib/supabase.js`
- `package.json`
- `README_V2_2.md`
- `supabase/functions/taty-google-bridge/index.ts` (source-control copy; runtime function is already deployed)

Do not promote to Production before Preview tests pass.

## Recommended Preview tests

1. `Retrouve le programme de travail BLE TRANSIT et dis-moi s'il est réellement validé.`
   - Expected: finds the actual DOCX, reads it, notices `A_VALIDER`, and does not claim validation.

2. `Contrôle le planning et dis-moi s'il y a des personnes sur deux missions qui se chevauchent.`
   - Expected: reads Planning, refreshes `Calendrier_Capacite`, shows overlaps and total load without reassigning anybody.

3. `Prépare la PBC BLE à partir du programme validé.`
   - With the current `A_VALIDER` file, expected: BLOCKED / validation required. No PBC rewrite should occur.

4. `Calcule les KPI actuels du cabinet.`
   - Expected: appends an evidence-based row in `KPI_Historique`; unknown KPI remain blank rather than zero.

5. `Qui est disponible pour une mission du 10 au 20 octobre ?`
   - Expected: planning recommendation only; no assignment modification.
