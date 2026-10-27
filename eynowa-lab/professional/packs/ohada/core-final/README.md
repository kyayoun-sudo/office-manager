# EYNOWA Lab — OHADA Core Final Pack

This pack closes the first complete EYNOWA methodology coverage of the OHADA accounting brain.

## Topics completed here

- borrowings and financing;
- payroll and employee costs;
- taxes and levies;
- foreign currency;
- equity;
- period-end close;
- financial statements;
- consolidated and combined accounts;
- SYCEBNL / not-for-profit specifics.

## Files

- `eynowa-accounting-methodology.json` — EYNOWA-owned accounting procedures, controls, evidence requests and anomaly logic.
- `eynowa-audit-methodology.json` — EYNOWA-owned audit procedures for the same themes.
- `official-public-guidance.json` — limited EYNOWA paraphrases of official OHADA public guidance/metadata, including SYCEBNL public information and ISA 315 implementation context.

## Guardrails

EYNOWA methodology is not normative SYSCOHADA, SYCEBNL or ISA text.

A theme being `methodology_ready` means Lab knows what to inspect, reconcile, ask for and flag. It does **not** mean Lab may issue an autonomous normative accounting conclusion when the relevant authorised rule has not been retrieved.

## Import this final pack

```powershell
npm.cmd run lab:import:ohada:core-final
```

## Import the entire OHADA V1 brain

```powershell
npm.cmd run lab:import:ohada:all
```

This re-imports all currently maintained OHADA V1 packs into Chroma using stable chunk ids, so existing chunks are updated rather than intentionally duplicated.

## Coverage status

See `../v1-topic-status.json`.

The methodology layer is complete across all 19 topics. Normative enrichment remains a separate licensing/source-authorisation workstream.
