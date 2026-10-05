# Office Manager AI — Architecture phase 1

Branch: `fix/office-manager-architecture-phase1` (from `v2-multi-agent`). Not merged, not deployed.

## Target architecture

```
GRAND CONTRÔLEUR / OFFICE MANAGER AI   (root agent — the manager itself)
   -> Mission Controller                (consult_mission_controller)
   -> Orpailleur                        (consult_orpailleur)
   -> Sika                              (consult_sika)
```

The previous structure `Office Manager -> Grand Contrôleur -> Orpailleur -> Sika` is removed: the Grand Contrôleur is no longer a specialist and there is no consult tool for it.

## Tool split

| Root Grand Contrôleur (global) | Mission Controller (one mission) |
|---|---|
| get_team_directory | get_mission_controls |
| read_taty_master_sheet | initialize_mission_from_template |
| refresh_capacity_calendar | read_taty_master_sheet, get_team_directory |
| find_available_staff | upsert_confirmed_planning_assignment |
| refresh_kpi_snapshot | sync_validated_programme_assignments |
| list_open_internal_actions (new, read-only) | create_or_update_mission_pbc |
| create_internal_followup | inspect_pbc_checklist |
| | detect_overdue_pbc_reminders (new) |
| | create_internal_followup, Drive search/read/index |

All tools are implemented once (`operationalToolCatalog`) and distributed by subset. Orpailleur and Sika tools are unchanged.

## PBC

- Lifecycle states exposed alongside the raw checklist status: `REQUESTED / RECEIVED / PARTIAL / NON_CONFORME / REVIEW / VERIFIED`. `VERIFIED` is never derived from the received/complete flags alone.
- External reminder rule: an applicable PBC item still missing (REQUESTED / PARTIAL / NON_CONFORME) **24 h after the end of its expected day** produces one `pbc_external_reminder` action per item, addressed by role to the mission Manager and the client/site responsible person. `dispatch_status = PENDING_EMAIL_DISPATCHER`, `email = null`: nothing is sent, no address is hardcoded or invented. Unparseable deadlines are reported, never guessed.

## Supabase compatibility (non-destructive)

- Root runs keep `agent_key = "grand-controleur"` — the historical key of manager runs; it now correctly designates the root.
- `mission-controller` without an `office_agent_settings` row falls back to the `grand-controleur` row (mode/enabled) and writes its runs, tool events and actions under `grand-controleur`, with the logical key kept in `metrics.logical_agent_key`, tool-event `metadata.logical_agent_key` and action `payload.origin_agent_key`. Once a `mission-controller` settings row is added, its own key is used automatically.
- API: `agent = "grand-controleur"` (old clients) is treated as `auto` (root). `/api/status` now returns `root` + `agents` (mission-controller, orpailleur, sika).

## Fixes

- Agents SDK / Zod: `create_internal_followup.evidence` (`z.record(...).optional()`) made the whole mission tool set fail at construction. Evidence is now a nullable list of `{key, value}` pairs rebuilt into the same object. All optional fields are explicitly `.nullable().optional()`; a test enforces strict schemas for every tool.
- `refresh_kpi_snapshot` called `appendSheetValues` without importing it (runtime ReferenceError).

## Tests

`npm run check` (syntax) and `npm test` (node:test, no network).

## Left for phase 2

Gmail email dispatcher for pending reminders; recipient resolution from team directory/mission contacts; `mission-controller` row in `office_agent_settings` (+ any DB constraint review); WP generation strictly from the programme (tooling); Orpailleur MAP/REGISTER and detect→…→remember engine; multi-tenant configuration (TATY_* env names, default file IDs, `read_taty_master_sheet` tool name); Supabase workers (mission-lifecycle, orpailleur durable worker).
