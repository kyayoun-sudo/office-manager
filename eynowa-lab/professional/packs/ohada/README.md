# EYNOWA Lab — OHADA Knowledge Pack

This pack is the first professional knowledge pack for EYNOWA Lab accounting.

## Scope

Primary accounting corpus:

- AUDCIF — Acte uniforme relatif au droit comptable et à l'information financière
- SYSCOHADA — Système comptable OHADA révisé, annexed to the AUDCIF
- SYCEBNL — Système comptable des entités à but non lucratif

Official source pages:

- AUDCIF / SYSCOHADA: https://www.ohada.org/acte-uniforme-relatif-au-droit-comptable-et-a-linformation-financiere-audcif/
- SYCEBNL: https://www.ohada.org/acte-uniforme-relatif-au-systeme-comptable-des-entites-a-but-non-lucratif/

## Official dates

AUDCIF:
- adopted: 2017-01-26
- Official Journal publication: 2017-02-15
- effective for individual/entity accounts: 2018-01-01
- effective for consolidated/combined accounts and IFRS financial statements covered by the Act: 2019-01-01

SYCEBNL:
- adopted: 2022-12-22
- effective: 2024-01-01

## Source IDs

Use only registered source IDs:

- `OHADA_AUDCIF_SYSCOHADA`
- `OHADA_SYCEBNL`

## Mandatory metadata for every chunk

Every ingested chunk must include at least:

- `source_id`
- `domain` = `accounting`
- `framework` = `AUDCIF`, `SYSCOHADA`, or `SYCEBNL`
- `authority` = `OHADA`
- `reference` = exact article/section/page/heading that supports the passage
- `version`
- `effective_from`
- `jurisdiction` = `OHADA`
- `source_url`
- `license_basis`
- `content`

## Rights rule

Do not ingest the full AUDCIF, SYSCOHADA or SYCEBNL text merely because it is downloadable online.

Before importing substantive normative text into a commercial EYNOWA product, document the legal/permission basis in `license_basis`.

Until that basis is documented, this folder may contain:

- source metadata;
- test-only chunks written by EYNOWA;
- user-owned/internal methodologies derived from the professional's own work;
- links to official OHADA sources;
- authorised excerpts where permission/licence is documented.

## Import

Generic import:

```bash
npm run lab:import -- ./authorised-ohada.jsonl
```

OHADA-restricted import:

```bash
npm run lab:import:ohada -- ./authorised-ohada.jsonl
```

The OHADA importer rejects non-OHADA source IDs before Chroma ingestion.

## Target Chroma collection

All accounting chunks are stored in:

`eynowa_accounting`

with the framework metadata preserved so Lab can distinguish AUDCIF, SYSCOHADA and SYCEBNL during retrieval.
