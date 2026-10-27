# EYNOWA Lab — OHADA Sales & Receivables Pack

## Scope

This pack supports professional analysis of the sales-to-cash cycle in Firm Manager and other EYNOWA applications.

Covered operating topics:

- invoice completeness and sequence;
- sales cut-off around period end;
- delivery / service evidence;
- post-close credit notes, returns and cancellations;
- customer subledger to general-ledger reconciliation;
- receivables aging and doubtful-account indicators;
- subsequent receipts;
- customer credit balances;
- duplicate / unusual revenue analytics;
- output-VAT consistency checks;
- customer confirmations under OHADA ISA implementation guidance;
- revenue-fraud risk considerations under ISA 240.

## Authority separation

`EYNOWA_ACCOUNTING_METHOD` is internal methodology. It may guide procedures, document requests, anomaly detection and professional questions, but it is **not** normative SYSCOHADA authority.

`OHADA_ISA_IMPLEMENTATION_TOOLS` contains EYNOWA paraphrases of publicly accessible CNC-OHADA implementation guidance. These chunks support audit methodology and do not reproduce the full normative ISA texts.

Operational accounting conclusions such as revenue recognition timing, impairment / depreciation of receivables, reclassification or tax treatment require the applicable normative source and professional validation where the detailed rule has not been retrieved.

## Import

```powershell
npm.cmd run lab:import:ohada:sales
```

## Expected routing examples

- `facture avant livraison` -> `sales_and_revenue` + `period_end_close`
- `avoirs après clôture` -> `sales_and_revenue` + `period_end_close`
- `balance âgée / encaissements postérieurs` -> `receivables`
- `soldes clients créditeurs` -> `receivables`
- `circularisation clients` -> `receivables`

## Suggested Firm Manager test

Ask Firm Manager to analyse year-end sales with invoices raised before delivery, post-close credit notes, old receivables, subsequent receipts and customer credit balances across Accounting + Audit.
