# EYNOWA Lab — OHADA Knowledge Pack

This is the first reusable professional knowledge pack for EYNOWA Lab accounting.

## Scope

- AUDCIF — Acte uniforme relatif au droit comptable et à l'information financière
- SYSCOHADA — Système comptable OHADA révisé annexé à l'AUDCIF
- SYCEBNL — Système comptable des entités à but non lucratif

Official source pages:

- AUDCIF / SYSCOHADA: https://www.ohada.org/acte-uniforme-relatif-au-droit-comptable-et-a-linformation-financiere-audcif/
- SYCEBNL: https://www.ohada.org/acte-uniforme-relatif-au-systeme-comptable-des-entites-a-but-non-lucratif/

## Pack files

- `manifest.json` — identity, frameworks, sources, target collection and content policy.
- `taxonomy.json` — 19 professional accounting topics used to organise future knowledge.
- `public-starter-pack.json` — immediately importable EYNOWA paraphrases of public OHADA facts and metadata. This file does **not** reproduce the normative text.
- `official-overview.json` — initial AUDCIF/SYSCOHADA overview.
- `sycebnl-official-overview.json` — initial SYCEBNL overview.
- `import-ohada.js` — OHADA-only importer.
- `test-only-sample.json` — non-normative pipeline test content.

## Official dates

AUDCIF:
- adopted: 2017-01-26
- Official Journal publication: 2017-02-15
- effective for individual/entity accounts: 2018-01-01
- effective for consolidated/combined accounts and IFRS financial statements covered by the Act: 2019-01-01

SYCEBNL:
- adopted: 2022-12-22
- Official Journal publication: 2023-02-22
- effective: 2024-01-01

## Topic taxonomy

The pack is organised around:

1. framework and scope
2. accounting plan
3. purchases and expenses
4. sales and revenue
5. property, plant and equipment
6. inventories
7. receivables
8. payables
9. cash and banking
10. payroll and employee costs
11. taxes and levies
12. provisions and contingencies
13. borrowings and financing
14. equity
15. foreign currency
16. period-end close
17. financial statements
18. consolidated and combined accounts
19. not-for-profit specifics

The starter pack does not pretend to contain detailed rules for all these topics. The taxonomy defines where authorised normative material and EYNOWA-owned methodology will be inserted later.

## Source IDs

Use only registered source IDs:

- `OHADA_AUDCIF_SYSCOHADA`
- `OHADA_SYCEBNL`

## Mandatory metadata

Every chunk must include at least:

- `source_id`
- `domain = accounting`
- `framework = AUDCIF | SYSCOHADA | SYCEBNL`
- `authority = OHADA`
- `reference`
- `version`
- `effective_from`
- `jurisdiction = OHADA`
- `source_url`
- `license_basis`
- `content`

## Rights rule

Do not ingest the full AUDCIF, SYSCOHADA or SYCEBNL text merely because it is downloadable online.

Before importing substantive normative text into a commercial EYNOWA product, document the legal/permission basis in `license_basis`.

The public starter pack uses EYNOWA-authored paraphrases of facts visible on official OHADA webpages and explicitly marks them as non-normative. Detailed accounting conclusions must continue to trigger professional validation until an authorised normative passage is retrieved.

## Import the V0 starter pack

```bash
npm run lab:import:ohada:starter
```

Generic authorised OHADA import:

```bash
npm run lab:import:ohada -- ./authorised-ohada.jsonl
```

The importer rejects non-OHADA source IDs before Chroma ingestion.

## Target Chroma collection

All chunks in this pack are stored in:

`eynowa_accounting`

Framework metadata is retained so EYNOWA Lab can distinguish AUDCIF, SYSCOHADA and SYCEBNL during retrieval.

## Next enrichment phase

The next layer is substantive professional content, organised by `taxonomy.json`. It should come from either:

- authorised/licensed normative material;
- user-owned TATY/EYNOWA methodologies;
- professionally reviewed summaries created specifically for EYNOWA;
- official public guidance whose reuse basis is documented.
