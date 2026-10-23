# EYNOWA Lab — Professional Knowledge Packs

EYNOWA Lab is one shared professional intelligence layer for Accounting, Audit and Advisory.

## Current V1 coverage

### Accounting
- OHADA: AUDCIF, SYSCOHADA, SYCEBNL methodology coverage across 19 topics.
- IFRS methodology: framework/judgement, revenue, leases, PPE, inventories, provisions, financial instruments, impairment, FX, income taxes, employee benefits, consolidation, business combinations, presentation/disclosures.

### Audit
- acceptance and independence;
- ISQM quality management;
- planning and materiality;
- risk assessment;
- fraud / management override;
- internal control;
- evidence;
- sampling;
- external confirmations;
- accounting estimates;
- related parties;
- going concern;
- subsequent events;
- reporting;
- sustainability assurance.

### Advisory
- financial analysis;
- budgeting and rolling forecast;
- working capital;
- internal-control/process advisory;
- financial due diligence;
- valuation;
- transaction support;
- IFRS S1/S2 / ESG readiness;
- finance transformation;
- performance management;
- scenario analysis;
- decision support.

## Import commands

```powershell
npm.cmd run lab:import:ohada:all
npm.cmd run lab:import:ifrs
npm.cmd run lab:import:audit
npm.cmd run lab:import:advisory
```

Import everything:

```powershell
npm.cmd run lab:import:professional:all
```

## Knowledge hierarchy

EYNOWA Lab must keep these layers distinct:

1. **Normative authority** — IFRS, IAS, ISA, ISQM, IESBA, ISSA, SYSCOHADA, SYCEBNL, IVS, IFRS S1/S2, etc. Substantive protected text is ingested only with a documented permission/licence basis.
2. **Official public metadata/guidance** — EYNOWA-authored summaries of public official pages. Useful for navigation/context but not a substitute for normative paragraphs.
3. **EYNOWA methodology** — owned internal procedures, analytical methods, checklists and professional workflows. Never presented as a standard.
4. **Professional memory** — human-validated local decisions and preferences, compartmentalised by professional/domain/client. Never normative authority.
5. **Client evidence** — engagement facts and documents. Evidence about the client, not professional authority.

## Validation rule

EYNOWA Lab must request professional validation when:
- no retrieved authoritative source supports the conclusion;
- only EYNOWA methodology supports a normative conclusion;
- facts are missing or contradictory;
- confidence is low;
- judgment is significant;
- a lightweight/fallback model or deterministic grounded fallback was used where professional judgment remains necessary.

## Local CPU resilience

The Lab uses local Ollama where practical. On CPU-only machines it may use a lightweight model. If local generation is too slow or fails, the professional endpoint returns a deterministic grounded response from retrieved knowledge instead of failing the request, and forces professional validation.

## Rights

Do not bulk-ingest protected IFRS Foundation, IAASB, IESBA or other licensed normative publications merely because they can be downloaded. Keep the source registry licence status and document the legal/permission basis before substantive ingestion.
