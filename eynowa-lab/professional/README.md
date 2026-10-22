# EYNOWA Lab Professional Brains

This module is the shared professional layer for the single EYNOWA Lab running on the user's computer.

It is **not** a second Lab and must not be deployed as an independent SaaS service.

## Domains

- `accounting`
- `audit`
- `advisory`

Calling applications must send their context explicitly. Example:

```json
{
  "application": "accounting_ai",
  "domain": "accounting",
  "task": "invoice_posting",
  "country": "CI",
  "framework": "SYSCOHADA",
  "professional_id": "user-123",
  "client": "ABC SARL",
  "query": "How should this invoice be posted?"
}
```

Firm Manager should use `domain=audit`; other tools can use `advisory` when appropriate.

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

Memory is contextual evidence, never normative authority.

## Validation gate

The final answer is blocked for professional validation when, among other things:

- no verifiable professional source supports the conclusion;
- facts are missing;
- sources/facts conflict;
- model confidence is below the automatic threshold;
- the subject requires significant professional judgment.

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
