# EYNOWA Lab — OHADA Accounting Pack V1

Reusable professional knowledge pack for EYNOWA Lab across Accounting and Audit.

## Scope

- AUDCIF — Acte uniforme relatif au droit comptable et à l'information financière
- SYSCOHADA — Système comptable OHADA révisé annexé à l'AUDCIF
- SYCEBNL — Système comptable des entités à but non lucratif
- EYNOWA Accounting Methodology
- EYNOWA Audit Methodology
- Public OHADA ISA implementation guidance where safely reusable

Official source pages:

- AUDCIF / SYSCOHADA: https://www.ohada.org/acte-uniforme-relatif-au-droit-comptable-et-a-linformation-financiere-audcif/
- SYCEBNL: https://www.ohada.org/acte-uniforme-relatif-au-systeme-comptable-des-entites-a-but-non-lucratif/
- OHADA ISA tools: https://www.ohada.org/outils-pratiques-de-mise-en-oeuvre-des-normes-isa/

## V1 status — methodology complete

EYNOWA Lab now has methodology coverage for all 19 accounting topics:

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
19. not-for-profit specifics / SYCEBNL

`v1-topic-status.json` is the coverage matrix. Every topic is now `methodology_ready=true`.

**Important:** methodology readiness is not the same as normative completeness. Detailed operational accounting conclusions still require an authorised normative passage or professional validation when `requires_normative_followup=true`.

## Main pack structure

- `public-starter-pack.json` — safe public OHADA context.
- `immobilisations-*` — fixed-assets guidance.
- `stocks/` — inventory methodology and audit guidance.
- `purchases/` — purchases, payables, FNP and GR/IR.
- `sales-receivables/` — sales, cut-off and receivables.
- `treasury/` — banks, cash and bank reconciliations.
- `provisions/` — provisions, accruals, contingencies and litigation.
- `core-final/` — borrowings, payroll, taxes, FX, equity, close, financial statements, consolidation and SYCEBNL.
- `normative-chunk-template.json` — template for authorised normative enrichment.

## Automatic routing

The router may select up to four topics per request. Examples:

- `machine / amortissement` → `property_plant_equipment`
- `GR/IR / FNP` → `payables`, `purchases_and_expenses`, `period_end_close`
- `facture avant livraison / avoir après clôture` → `sales_and_revenue`, `receivables`, `period_end_close`
- `rapprochement bancaire / chèque ancien` → `cash_and_banking`
- `litige / provision / avocat` → `provisions_and_contingencies`
- `covenant / waiver / emprunt` → `borrowings_and_financing`
- `journal de paie / primes` → `payroll_and_employee_costs`
- `contrôle fiscal / TVA` → `taxes_and_levies`
- `cours de clôture / écarts de change` → `foreign_currency`
- `mapping balance / annexes` → `financial_statements`
- `intercompagnie / périmètre de consolidation` → `consolidated_and_combined_accounts`
- `bailleur / fonds affectés / registre donateurs` → `not_for_profit_specifics`

## Rights and authority rule

Do not ingest the full AUDCIF, SYSCOHADA, SYCEBNL, ISA, IAASB or IESBA corpus merely because it is downloadable online.

Before importing substantive normative text into a commercial EYNOWA product, document the licence/permission basis in `license_basis`.

The current public chunks are EYNOWA-authored summaries/paraphrases with explicit source metadata. EYNOWA-owned methodologies guide procedures, evidence requests, controls and anomaly detection; they are not normative authority.

## Install / update

```powershell
cd C:\eynowa-lab\office-manager
git pull --ff-only origin feat/eynowa-lab-professional-brains
npm.cmd run test:lab
```

## Import everything — recommended

```powershell
npm.cmd run lab:import:ohada:all
```

This imports/re-imports all maintained OHADA V1 packs using stable chunk ids.

Individual import commands remain available, including:

```powershell
npm.cmd run lab:import:ohada:stocks
npm.cmd run lab:import:ohada:purchases
npm.cmd run lab:import:ohada:sales
npm.cmd run lab:import:ohada:treasury
npm.cmd run lab:import:ohada:provisions
npm.cmd run lab:import:ohada:core-final
```

Then reload the professional modules in the local Gateway:

```powershell
docker cp .\eynowa-lab\professional\. eynowa-gateway:/app/eynowa-lab/professional/
docker restart eynowa-gateway
```

## Chroma

Accounting chunks are stored in `eynowa_accounting`; audit chunks are stored in `eynowa_audit`. Framework, topic, source kind, normative status and follow-up metadata are preserved for retrieval.

## Next workstream

The OHADA **methodology layer is complete**. The next OHADA workstream is no longer topic construction; it is **authorised normative enrichment**: attaching licensed/permissioned SYSCOHADA, SYCEBNL and other authoritative passages to the existing topics so Lab can move from professional triage to stronger norm-grounded conclusions.
