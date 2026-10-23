# EYNOWA Lab Professional Brains

Shared professional layer for the single EYNOWA Lab. It is not a second Lab and it is not the Office Manager orchestrator.

**Role:** EYNOWA Lab is a professional métier helper. Calling agents and human professionals retain workflow, decision and action authority.

## Brains
- accounting
- audit
- advisory

Firm Manager is not audit-only. If it sends no explicit domain scope, Lab may combine all three brains. Accounting AI, Enhanced Auditor, Mission Controller, Posting App and future EYNOWA applications use the same Lab through the shared client/adapters, while retaining their own roles.

## Local stack
- existing Gateway: port 8787
- Ollama: 11434
- Chroma: 8000
- embeddings: `embeddinggemma`

The existing Gateway remains the authentication boundary and keeps all existing routes.

## Chroma collections
- `eynowa_accounting`
- `eynowa_audit`
- `eynowa_advisory`

Lab generates embeddings locally with Ollama `/api/embed`, stores/searches them in Chroma, and accepts a citation only when its source was actually retrieved for the current request.

## Source families registered
- IFRS Accounting / IAS / IFRIC / SIC / Conceptual Framework / IFRS for SMEs
- IFRS Accounting Taxonomy
- OHADA AUDCIF / SYSCOHADA
- OHADA SYCEBNL
- IAASB 2026 Handbook: ISA / ISQM / IAPN / ISA for LCE / ISSA 5000 / ISAE / ISRE / ISRS
- IESBA 2026 Code / Independence Standards
- OHADA ISA implementation / quality tools
- EYNOWA Accounting, Audit and Advisory methodology
- IFRS Sustainability / ISSB
- IVSC / IVS

The registry is metadata plus authorised/EYNOWA-owned knowledge. Protected normative texts are not bundled without a documented permission/licence basis.

## Knowledge ingestion
Each chunk must pass `knowledge-contract.js`. `source_id`, `domain`, `authority`, `reference`, `source_url`, `license_basis` and `content` are mandatory.

```powershell
npm.cmd run lab:import -- .\authorised-chunks.jsonl
npm.cmd run lab:import:professional:all
```

## Memory
Local professional memory defaults to:

```text
~/.eynowa-lab/professional-memory.jsonl
```

Only `HUMAN_VALIDATED` decisions can be stored automatically. Memory is compartmentalised by professional/domain/client and is contextual evidence, never normative authority.

A multi-domain human validation is stored separately in each validated domain.

## Gateway routes
Existing routes remain available:
- `POST /v1/professional/query`
- `POST /v1/professional/memory/remember`
- `POST /v1/professional/knowledge/import`
- `GET|POST /v1/professional/health`
- `GET|POST /v1/professional/diagnostics`

Additive helper routes:
- `POST /v1/professional/validation/accept`
- `POST /v1/professional/feedback`
- `GET|POST /v1/professional/metrics`

The local `lab-gateway-server.js` delegates these paths to `gateway-dispatcher.js` after its existing API-key authentication.

## Validation cards
A professional response with `requires_validation=true` also receives a `validation_card` containing:
- proposed conclusion;
- reason and professional question;
- domains/topics/sources;
- confidence;
- actions: accept, correct, request evidence, reject.

Accept/correct requires explicit human confirmation before memory is written. Request-evidence/reject only record feedback.

## Telemetry
Local telemetry defaults to:

```text
~/.eynowa-lab/professional-telemetry.jsonl
```

Metrics include query count, validation rate, fallback rate, deterministic fallback rate, JSON repair rate, average latency, knowledge hits, feedback and usage by application. Telemetry write failure does not fail a professional query.

## Permanent evaluations
Offline routing regression corpus:

```powershell
npm.cmd run lab:eval
```

Live Gateway/Chroma/Ollama evaluation:

```powershell
npm.cmd run lab:eval:live
```

The permanent corpus contains Accounting, Audit, Advisory and cross-domain scenarios.

## Non-blocking helper integration
Firm Manager may call Lab in three modes:
- `auto`: only detected métier content;
- `on`: force Lab;
- `off`: skip Lab.

If Lab is unavailable, the selected Firm Manager agent continues with its original evidence and AI flow. Lab never executes a posting, sends a message, approves audit work, moves a document or changes workflow status.

See `../../EYNOWA_LAB_INTEGRATION.md` for the shared application integration contract.

## Local activation / update

```powershell
cd C:\eynowa-lab\office-manager
git pull --ff-only origin feat/eynowa-lab-professional-brains
npm.cmd run test:lab
npm.cmd run lab:eval
```

After updating local professional modules:

```powershell
docker cp .\eynowa-lab\professional\. eynowa-gateway:/app/eynowa-lab/professional/
docker restart eynowa-gateway
```

Then use `npm.cmd run lab:eval:live` for the end-to-end regression pass.
