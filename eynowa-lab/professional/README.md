# EYNOWA Lab Professional Brains

Shared professional layer for the single local EYNOWA Lab. It is not a second Lab.

## Brains
- accounting
- audit
- advisory

Firm Manager is not audit-only. If it sends no explicit domain scope, Lab defaults to all three brains and may combine them in one task. Accounting AI normally calls the accounting brain, but uses the same Lab.

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
- IFRS Sustainability / ISSB
- IVSC / IVS

The registry is metadata only. Protected texts are not bundled.

## Knowledge ingestion
Each chunk must pass `knowledge-contract.js`. `source_id`, `domain`, `authority`, `reference`, `source_url`, `license_basis` and `content` are mandatory.

```bash
npm install
npm run lab:import -- ./authorised-chunks.jsonl
```

## Memory
Local professional memory defaults to `~/.eynowa-lab/professional-memory.jsonl`. Only `HUMAN_VALIDATED` decisions can be stored automatically. Memory is contextual evidence, never normative authority.

## New Gateway routes
- `POST /v1/professional/query`
- `POST /v1/professional/memory/remember`
- `POST /v1/professional/knowledge/import`
- `GET /v1/professional/health`

The local `lab-gateway-server.js` should delegate these paths to `gateway-dispatcher.js` after its existing timing-safe API-key authentication.

## Validation
Lab requires professional validation when no retrieved professional evidence supports a conclusion, facts are missing/contradictory, confidence is insufficient, or the subject requires significant professional judgment.

## Local activation
```powershell
cd C:\eynowa-lab\office-manager
git fetch origin
git checkout feat/eynowa-lab-professional-brains
npm install
ollama pull embeddinggemma
npm run test:lab
```

The remaining step before merge is to integrate `gateway-dispatcher.js` into the existing local `lab-gateway-server.js` and run end-to-end health/RAG checks against the actual local containers.
