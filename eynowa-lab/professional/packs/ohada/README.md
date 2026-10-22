# EYNOWA Lab — OHADA Accounting Pack V1

Reusable professional knowledge pack for EYNOWA Lab accounting.

## Scope

- AUDCIF — Acte uniforme relatif au droit comptable et à l'information financière
- SYSCOHADA — Système comptable OHADA révisé annexé à l'AUDCIF
- SYCEBNL — Système comptable des entités à but non lucratif

Official source pages:

- AUDCIF / SYSCOHADA: https://www.ohada.org/acte-uniforme-relatif-au-droit-comptable-et-a-linformation-financiere-audcif/
- SYCEBNL: https://www.ohada.org/acte-uniforme-relatif-au-systeme-comptable-des-entites-a-but-non-lucratif/

## V1 capabilities

V1 adds topic-aware professional retrieval on top of the V0 source/rights controls.

- 19 accounting topics
- deterministic topic detection before RAG retrieval
- topic metadata persisted in Chroma
- topic-matching evidence ranked before unrelated evidence
- public/non-normative context distinguished from authorised normative text
- `requires_normative_followup` carried through retrieval
- professional validation forced when public context is insufficient for an operational conclusion

## Pack files

- `manifest.json` — V1 identity, frameworks, features, sources and content policy.
- `taxonomy.json` — 19 professional accounting topics.
- `v1-topic-status.json` — readiness matrix for each topic.
- `public-starter-pack.json` — importable EYNOWA paraphrases of public OHADA facts/metadata; no full normative text.
- `normative-chunk-template.json` — template for authorised normative material.
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

Examples of automatic routing:

- `machine / amortissement / immobilisation` → `property_plant_equipment`
- `stock / inventaire / obsolescence` → `inventories`
- `FNP / fournisseur / charge à payer` → `payables`
- `clôture / cut-off / fin d'exercice` → `period_end_close`
- `ONG / subvention / donateur` → `not_for_profit_specifics`

The router may select up to four relevant topics for a cross-topic question.

## Topic readiness

`v1-topic-status.json` distinguishes:

- `public_context_ready` — enough public context for framework/explanatory answers;
- `mixed` — public context exists but operational conclusions require normative verification;
- `normative_content_required` — detailed accounting guidance must come from an authorised normative source before Lab can rely on it.

## Mandatory chunk metadata

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

Recommended `metadata` fields:

- `topic`
- `subtopic`
- `source_kind`
- `normative_text`
- `requires_normative_followup`

## Rights rule

Do not ingest the full AUDCIF, SYSCOHADA or SYCEBNL text merely because it is downloadable online.

Before importing substantive normative text into a commercial EYNOWA product, document the legal/permission basis in `license_basis`.

The public starter pack uses EYNOWA-authored paraphrases of facts visible on official OHADA webpages and explicitly marks them as non-normative. Detailed accounting conclusions must continue to trigger professional validation until an authorised normative passage is retrieved.

## Install / update

```powershell
cd C:\eynowa-lab\office-manager
git pull --ff-only origin feat/eynowa-lab-professional-brains
npm.cmd run test:lab
```

Copy the updated professional modules into the running local Gateway when testing the local Docker stack:

```powershell
docker cp .\eynowa-lab\professional\. eynowa-gateway:/app/eynowa-lab/professional/
docker restart eynowa-gateway
```

## Import public starter pack

```powershell
npm.cmd run lab:import:ohada:starter
```

Generic authorised OHADA import:

```powershell
npm.cmd run lab:import:ohada -- .\authorised-ohada.jsonl
```

The importer rejects non-OHADA source IDs before Chroma ingestion.

## Target Chroma collection

All chunks in this pack are stored in:

`eynowa_accounting`

Framework and topic metadata are retained so EYNOWA Lab can distinguish AUDCIF, SYSCOHADA and SYCEBNL and prioritise the relevant accounting topic during retrieval.

## Next enrichment phase

Substantive professional content is added topic by topic from one of these bases:

- authorised/licensed normative material;
- user-owned TATY/EYNOWA methodologies;
- professionally reviewed summaries created specifically for EYNOWA;
- official public guidance whose reuse basis is documented.

Priority topics for the first authorised normative enrichment:

1. property, plant and equipment
2. inventories
3. provisions and contingencies
4. period-end close
5. financial statements
6. purchases/payables
7. sales/receivables
8. foreign currency
