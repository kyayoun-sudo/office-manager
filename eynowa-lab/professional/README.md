# EYNOWA Lab Professional Brains

This module is the shared professional layer for the single EYNOWA Lab running on the user's computer.

It is **not** a second Lab and must not be deployed as an independent SaaS service.

## Professional brains

- `accounting`
- `audit`
- `advisory`

The calling application does **not** define or restrict the professional domain. The task does.

### Firm Manager

Firm Manager is the cabinet operating system, not an audit-only application. It can use all three professional brains and can combine them in one request.

If Firm Manager sends no explicit domain scope, EYNOWA Lab defaults to:

```json
{
  "application": "firm_manager",
  "domains": ["accounting", "audit", "advisory"]
}
```

It can also narrow a task when useful:

```json
{
  "application": "firm_manager",
  "domains": ["audit"],
  "task": "risk_assessment",
  "frameworks": ["ISA"],
  "country": "CI",
  "professional_id": "user-123",
  "client": "ABC SARL",
  "query": "Identify significant risks for this engagement."
}
```

Or combine several disciplines:

```json
{
  "application": "firm_manager",
  "domains": ["accounting", "audit", "advisory"],
  "task": "year_end_review",
  "frameworks": ["SYSCOHADA", "IFRS", "ISA"],
  "country": "CI",
  "professional_id": "user-123",
  "client": "ABC SARL",
  "query": "Review the year-end accounting treatment, audit implications and recommended management actions."
}
```

### Accounting AI

Accounting AI will normally call the accounting brain explicitly:

```json
{
  "application": "accounting_ai",
  "domains": ["accounting"],
  "task": "invoice_posting",
  "country": "CI",
  "frameworks": ["SYSCOHADA"],
  "professional_id": "user-123",
  "client": "ABC SARL",
  "query": "How should this invoice be posted?"
}
```

Legacy `domain` remains accepted for compatibility. `domain=all` also activates all three brains.

## Intended Gateway route

The local `lab-gateway-server.js` should expose:

- `POST /v1/professional/query`
- `POST /v1/professional/memory/remember`

The existing local gateway is currently not versioned in this repository. Do not replace it blindly. Import this module into the real local gateway after inspecting that file.

Minimal integration shape:

```js
import { createProfessionalHandler, handleProfessionalMemory } from './eynowa-lab/professional/handler.js';

const handleProfessional = createProfessionalHandler({
  searchKnowledge: queryChromaKnowledge
});

// POST /v1/professional/query -> await handleProfessional(req.body)
// POST /v1/professional/memory/remember -> await handleProfessionalMemory(req.body)
```

## Knowledge

Knowledge must remain separate from personal professional memory.

Recommended Chroma collections:

- `eynowa_accounting`
- `eynowa_audit`
- `eynowa_advisory`

For a multi-domain Firm Manager request, Lab queries all relevant collections and gives Ollama one combined, labelled professional context.

Every ingested chunk must include at least:

- `source_id`
- `domain`
- `framework`
- `authority`
- `reference`
- `version`
- `effective_from`
- `jurisdiction`
- `source_url`
- `license_basis`

Use `knowledge-contract.js` before adding anything to Chroma.

## Professional memory

Personal memory is local to the professional computer by default:

`~/.eynowa-lab/professional-memory.jsonl`

Only `HUMAN_VALIDATED` decisions can be written automatically.

Memory is compartmentalised by professional + domain + client. Firm Manager can retrieve several domain compartments for a cross-disciplinary task, but memory is still contextual evidence, never normative authority.

## Validation gate

The final answer is blocked for professional validation when, among other things:

- no verifiable professional source supports the conclusion;
- facts are missing;
- sources/facts conflict;
- model confidence is below the automatic threshold;
- the subject requires significant professional judgment in accounting, audit or advisory.

The API response includes:

```json
{
  "answer": "...",
  "sources": [],
  "confidence": 0.0,
  "requires_validation": true,
  "validation_reason": "...",
  "question_for_professional": "..."
}
```

## Source licensing

The registry stores source metadata only. It does not bundle copyrighted standards.

IFRS Foundation materials require licensing for integration into products/services. IAASB/IESBA reproduction and AI ingestion must follow the applicable permission process. OHADA and IVSC materials remain flagged for rights verification before ingestion unless an authorised basis is documented.
