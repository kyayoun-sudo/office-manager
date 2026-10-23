# EYNOWA Lab — OHADA Treasury Pack

## Scope

This pack covers treasury, banks and cash for EYNOWA Lab across Accounting and Audit.

### Accounting methodology

`eynowa-accounting-methodology.json`

Covers:
- bank reconciliations;
- aged reconciling items;
- bank-account completeness;
- bank fees, interest and unrecorded movements;
- interbank transfer cut-off;
- cash counts and cash reconciliation;
- unusual cash/bank transactions;
- overdrafts and restricted cash triage;
- foreign-currency bank accounts.

These chunks are **EYNOWA-owned methodology**, not normative SYSCOHADA text. They guide analysis, evidence requests, controls and anomaly detection. Detailed accounting conclusions still require the applicable normative source or professional validation.

### Audit methodology

`eynowa-audit-methodology.json`

Covers:
- bank confirmations;
- review of bank reconciliations;
- transfer cut-off testing;
- physical cash counts;
- unusual treasury journals and payment analytics.

These chunks are **EYNOWA audit methodology**, not ISA text.

### Official OHADA implementation guidance

`audit-public-guidance.json`

Contains EYNOWA paraphrases of public CNC-OHADA implementation guidance for ISA 505 external confirmations, including auditor control of the confirmation process, non-responses and divergence investigation.

Official source:
https://www.ohada.org/outils-pratiques-de-mise-en-oeuvre-des-normes-isa/

## Import

```powershell
npm.cmd run lab:import:ohada:treasury
```

## Main routing topic

`cash_and_banking`

Related topics may also be detected:
- `period_end_close`
- `foreign_currency`
- `borrowings_and_financing`

## Guardrails

- EYNOWA methodology is never normative authority.
- A bank reconciliation difference is an investigation item, not automatically an accounting error.
- An unusual payment is a risk signal, not proof of fraud.
- Classification of overdrafts, restricted cash, foreign exchange effects and other presentation questions must be grounded in the applicable framework.
- If local generation times out, EYNOWA Lab must return the deterministic grounded fallback rather than fail the request.
