# EYNOWA Lab Professional Brains

This module is the shared professional layer for the single EYNOWA Lab running on the user's computer.

It is **not** a second Lab and must not be deployed as an independent SaaS service.

## Professional brains

- `accounting`
- `audit`
- `advisory`

The calling application does **not** define or restrict the professional domain. The task does.

Firm Manager is the cabinet operating system, not an audit-only application. If Firm Manager sends no explicit domain scope, EYNOWA Lab defaults to all three brains and can combine them in a single request.

Example:

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

Accounting AI will normally use `domains: ["accounting"]`, but it calls the same shared Lab. Legacy `domain` remains accepted; `domain=all` activates all three brains.

## Local services

Default integration targets:

- existing local Node HTTP EYNOWA Lab Gateway on port `8787`
- Ollama generation on `http://127.0.0.1:11434`
- Chroma on `127.0.0.1:8000`
- Ollama embeddings with `embeddinggemma`

The existing Gateway already owns Bearer / `X-EYNOWA-API-Key` authentication and routes such as `/health`, `/ai/local-chat`, `/memory/*`, `/search/*`, `/document/*` and `/workflow/run`. The professional module is added behind that same authentication boundary and does not replace existing routes.

Environment overrides:

```text
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=<your-generation-model>
OLLAMA_EMBED_MODEL=embeddinggemma
CHROMA_HOST=127.0.0.1
CHROMA_PORT=8000
CHROMA_SSL=false
EYNOWA_LAB_HOME=<optional local memory folder>
```

The Node client dependency is `chromadb` 3.5.0.

## Chroma knowledge collections

- `eynowa_accounting`
- `eynowa_audit`
- `eynowa_advisory`

Lab creates document/query embeddings locally with Ollama `/api/embed` and stores/searches those vectors in Chroma. The same embedding model must be used for indexing and retrieval.

For a multi-domain Firm Manager request, Lab queries the relevant collections, combines the labelled evidence, and sends it to the local generation model.

A citation is accepted only when the source was actually retrieved from Chroma for the current request. Merely being present in the registry is not evidence.

## Registered source families

Metadata is registered for:

- IFRS Accounting / IAS / IFRIC / SIC / Conceptual Framework / IFRS for SMEs
- IFRS Accounting Taxonomy
- OHADA AUDCIF / SYSCOHADA
- OHADA SYCEBNL
- IAASB 2026 Handbook: ISA / ISQM / IAPN / ISA for LCE / ISSA 5000 / ISAE / ISRE / ISRS
- IESBA 2026 Code / International Independence Standards
- OHADA practical ISA implementation and quality-assurance tools
- IFRS Sustainability / ISSB
- IVSC / IVS valuation standards

The registry is metadata only. It becomes evidence only after an authorised passage is ingested and retrieved.

## Knowledge ingestion

Every chunk passes `knowledge-contract.js`. Mandatory fields include `source_id`, `domain`, `authority`, `reference`, `source_url`, `license_basis` and `content`; framework/version/effective-date/jurisdiction metadata is retained when available.

Import authorised JSON/JSONL chunks with:

```bash
npm install
npm run lab:import -- ./authorised-chunks.jsonl
```

Protected standards are not bundled. IFRS/IAASB/IESBA material must only be ingested when the applicable licence/permission basis has been documented. OHADA and IVSC content remains flagged for rights verification unless an authorised basis is documented.

## Professional memory

Local memory defaults to:

`~/.eynowa-lab/professional-memory.jsonl`

Only `HUMAN_VALIDATED` decisions can be persisted automatically. Memory is compartmentalised by professional + domain + client and is contextual evidence, never normative authority.

## Gateway routes

The existing local `lab-gateway-server.js` should delegate these routes to `gateway-dispatcher.js` after its current API-key check:

- `POST /v1/professional/query`
- `POST /v1/professional/memory/remember`
- `POST /v1/professional/knowledge/import`
- `GET /v1/professional/health`

The Gateway itself is local and is not currently versioned in this repository. Do not replace it wholesale.

```js
import {
  createProfessionalGatewayDispatcher,
  readJsonRequest,
  writeJsonResponse,
} from './eynowa-lab/professional/gateway-dispatcher.js';

const dispatchProfessional = createProfessionalGatewayDispatcher();

// AFTER the Gateway's existing authentication check:
const body = req.method === 'POST' ? await readJsonRequest(req) : {};
const result = await dispatchProfessional({ method: req.method, path: req.url, body });
if (result.handled) {
  writeJsonResponse(res, result.status, result.body);
  return;
}
```

Do not remove/bypass the existing timing-safe API-key authentication. Knowledge import and memory writes are sensitive local operations.

## Validation gate

The final answer requires professional validation when there is no retrieved professional support, facts are missing or contradictory, confidence is insufficient, or the subject requires significant professional judgment.

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

## Tests and local activation

Pure routing/validation tests:

```bash
npm run test:lab
```

On the EYNOWA Lab machine:

```powershell
cd C:\eynowa-lab\office-manager
git fetch origin
git checkout feat/eynowa-lab-professional-brains
npm install
ollama pull embeddinggemma
npm run test:lab
```

Then integrate `gateway-dispatcher.js` into the existing `lab-gateway-server.js`, test `GET /v1/professional/health`, and run a harmless multi-domain query before importing any professional corpus.

The shared professional module, multi-domain router, Chroma adapter, local Ollama generation/embeddings, validation gate, personal memory, import CLI and framework-neutral Gateway dispatcher are already versioned on this feature branch. The remaining step is local Gateway integration and end-to-end testing before merge.
