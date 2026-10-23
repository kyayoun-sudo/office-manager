# EYNOWA Lab — OHADA Provisions & Contingencies Pack

## Scope

This pack covers provisions, accrued liabilities, contingent liabilities, claims, litigation and accounting estimates for EYNOWA Lab across Accounting and Audit.

### Accounting methodology

`eynowa-accounting-methodology.json`

Covers:
- obligation / uncertainty intake triage;
- accrual vs provision vs other liability triage;
- estimation files and assumptions;
- litigation registers;
- subsequent evidence;
- provision roll-forwards and aged provisions;
- disclosure/presentation triage.

These chunks are **EYNOWA-owned methodology**, not normative SYSCOHADA text. They guide analysis and documentation. Detailed recognition, measurement, reversal, presentation and disclosure conclusions require the applicable normative source or professional validation.

### Audit methodology

`eynowa-audit-methodology.json`

Covers:
- completeness search for unrecorded obligations;
- challenge of accounting estimates;
- litigation and lawyer inquiry workflow;
- provision roll-forward analytics;
- presentation/disclosure review.

These chunks are **EYNOWA audit methodology**, not ISA text.

### Official OHADA implementation guidance

`audit-public-guidance.json`

Contains EYNOWA paraphrases of public CNC-OHADA implementation guidance for:
- ISA 501 — litigation identification and communication with external legal counsel;
- ISA 540 — accounting-estimate risk assessment and audit responses.

Official source:
https://www.ohada.org/outils-pratiques-de-mise-en-oeuvre-des-normes-isa/

## Import

```powershell
npm.cmd run lab:import:ohada:provisions
```

## Main routing topic

`provisions_and_contingencies`

Related topics may also be detected:
- `period_end_close`
- `payables`
- `financial_statements`

## Guardrails

- EYNOWA methodology is never normative authority.
- A management label such as "provision" does not determine the accounting treatment.
- Legal exposure requires documented facts and, where relevant, legal input.
- Significant estimates require documented assumptions and uncertainty.
- A risk signal or old provision is not automatically an error.
- If detailed SYSCOHADA support is not retrieved, operational accounting conclusions require professional validation.
- If local generation times out, EYNOWA Lab returns the deterministic grounded fallback rather than failing the request.
