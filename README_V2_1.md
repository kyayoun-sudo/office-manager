# Office Manager AI — V2.1 Operational Patch

This patch extends the existing `v2-multi-agent` preview.

## What V2.1 adds
- Uses `orchestrator` as the run identity for Office Manager.
- Team Directory lookup for real staff names/emails/roles.
- Document Index lookup for actual indexed files and links.
- Archive lookup.
- Mission control lookup against work programme/standards.
- Mission assignment lookup.
- Internal proposed follow-up actions (no external email is sent).
- Detailed agent/tool tracing in `office_agent_tool_events`.
- `specialistsUsed` and `toolsUsed` in the API response and run metrics.
- Grand Contrôleur context now includes legacy mission, PBC, workstream and working-paper evidence linked to the current organisation.

## Safety
This patch does NOT:
- send external email;
- move/delete/restore files;
- sign/approve audit work;
- confirm payments without evidence.

Those actions require later permission-gated tools.

## Supabase
The included migration is additive. It has already been applied to the current TATY pilot database on 2026-10-04.
