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

If Firm Manager sends no explicit domain scope, EYNOWA Lab defaults to all three brains.

Example cross-disciplinary request:

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

Accounting AI will normally use `domains: ["accounting"]`, but it calls the same shared Lab.

Legacy `domain` remains accepted for compatibility. `domain=all` also activates all three brains.

## Local services

Default integration targets:

- EYNOWA Lab Gateway: existing local gateway
- Ollama generation: `http://127.0.0.1:11434`
- Chroma: `127.0.0.1:8000`
- Ollama embeddings: `embeddinggemma`

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

EYNOWA Lab generates query and document embeddings with the local Ollama `/api/embed` endpoint and supplies those embeddings to Chroma. The same embedding model must be used for indexing and retrieval.

For a multi-domain Firm Manager request, Lab queries each relevant collection, combines the labelled evidence, then sends the evidence to the local generation model.

A model citation is accepted only when the cited source was actually retrieved from Chroma for the current request. Merely being present in the source registry is not enough.

## Registered professional source families

The registry currently includes source metadata for:

- IFRS Accounting Standards / IAS / IFRIC / SIC / Conceptual Framework / IFRS for SMEs
- IFRS Accounting Taxonomy
- OHADA AUDCIF / SYSCOHADA
- OHADA SYCEBNL
- IAASB 2026 Handbook: ISA / ISQM / IAPN / ISA for LCE / ISSA 5000 / ISAE / ISRE / ISRS
- IESBA 2026 Code / International Independence Standards
- OHADA practical ISA implementation and quality-assurance tools
- IFRS Sustainability / ISSB
- IVSC / IVS valuation standards

The registry is metadata only and is not evidence until an authorised passage has actually been ingested and retrieved.

## Knowledge ingestion

Every ingested chunk must pass `knowledge-contract.js` and include:

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
- `content`

`authority`, `reference`, `source_url`, `license_basis` and `content` are mandatory. This prevents anonymous or unverifiable material from silently entering the professional knowledge base.

Import authorised JSON or JSONL chunks with:

```bash
npm install
npm run lab:import -- ./authorised-chunks.jsonl
```

Protected standards are not bundled in this repository. IFRS/IAASB/IESBA material must only be ingested when the applicable licence or permission basis has been documented. OHADA and IVSC content remains subject to rights verification before ingestion unless an authorised basis is documented.

## Professional memory

Personal memory is local to the professional computer by default:

`~/.eynowa-lab/professional-memory.jsonl`

Only `HUMAN_VALIDATED` decisions can be written automatically.

Memory is compartmentalised by professional + domain + client. Firm Manager can retrieve several domain compartments for a cross-disciplinary task, but memory remains contextual evidence, never normative authority.

## Gateway routes

The existing local `lab-gateway-server.js` should delegate these paths to `gateway-dispatcher.js`:

- `POST /v1/professional/query`
- `POST /v1/professional/memory/remember`
- `POST /v1/professional/knowledge/import`
- `GET /v1/professional/health`

The gateway itself is currently local and not versioned in this repository. Do not replace it blindly. The dispatcher is framework-neutral so the existing Gateway only needs to pass `method`, `path` and parsed `body`.

Example:

```js
import {
  createProfessionalGatewayDispatcher,
  readJsonRequest,
  writeJsonResponse,
} from './eynowa-lab/professional/gateway-dispatcher.js';

const dispatchProfessional = createProfessionalGatewayDispatcher();

// Inside the existing HTTP request handler, after its existing authentication:
const body = req.method === 'POST' ? await readJsonRequest(req) : {};
const result = await dispatchProfessional({ method: req.method, path: req.url, body });
if (result.handled) {
  writeJsonResponse(res, result.status, result.body);
  return;
}
```

Keep the Gateway's existing authentication around the knowledge-import and memory-write routes.

## Validation gate

The final answer requires professional validation when, among other things:

- no retrieved professional source supports the conclusion;
- facts are missing;
- sources/facts conflict;
- model confidence is below the automatic threshold;
- the subject requires significant professional judgment in accounting, audit or advisory.

Response shape:

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

## Tests

Pure routing/validation tests do not require Chroma or Ollama:

```bash
npm run test:lab
```

End-to-end RAG testing additionally requires the real local Chroma and Ollama services plus an authorised test knowledge chunk.

## Current integration state

The shared professional module, multi-domain router, Chroma adapter, local Ollama generation/embeddings, validation gate, personal memory, import CLI and framework-neutral Gateway dispatcher are versioned on the feature branch. The remaining local-only step is to import the dispatcher into the user's existing `lab-gateway-server.js` and run end-to-end checks against the user's actual Chroma/Ollama containers before merging.

### Local activation sequence

On the machine that hosts EYNOWA Lab:

```powershell
cd C:\eynowa-lab\office-manager
git fetch origin
git checkout feat/eynowa-lab-professional-brains
npm install
ollama pull embeddinggemma
npm run test:lab
```

Then preserve the existing Gateway and integrate `gateway-dispatcher.js` into that existing `lab-gateway-server.js`. Do not replace the Gateway wholesale. After integration, test `GET /v1/professional/health`, then a harmless multi-domain query before importing any professional corpus.
