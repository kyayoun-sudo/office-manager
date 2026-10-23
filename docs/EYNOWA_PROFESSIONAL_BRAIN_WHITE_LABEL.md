# EYNOWA Professional Brain — White Label integration

## Goal

EYNOWA Lab is the shared professional helper for White Label. It adds specialist Accounting, Audit/Assurance and Advisory knowledge without replacing any existing agent, workflow, evidence source, approval or human professional judgement.

Official integration base: `feature/white-label-desktop`.
Integration branch: `feat/white-label-eynowa-brain`.

## Authority model

The calling agent keeps authority over its own workflow and tools.

- Grand Contrôleur remains the root coordinator.
- Mission Controller remains responsible for mission lifecycle/workflow.
- Orpailleur remains responsible for document discovery/classification/evidence retrieval.
- Sika remains responsible for billing/collection/administrative finance workflows.
- Enhanced Auditor remains responsible for executing/reviewing audit work.
- EYNOWA Lab supplies professional analysis, sources, confidence, missing facts and validation requirements only.

Verified mission facts and actual evidence always override generic professional knowledge. Lab must never invent a mission fact, document, balance, approval, sign-off or conclusion.

When Lab returns `requires_validation`, the calling agent must preserve that requirement. A human professional validates the judgement before it becomes final.

## Professional domains

The shared service supports:

- `accounting`
- `audit`
- `advisory`

Cross-domain requests are supported. Firm Manager may query all three when the task genuinely spans them.

The validated professional core is stored under `eynowa-lab/professional/` and includes routing, topic detection, Chroma retrieval, Ollama generation/fallback, source metadata, validation gates, telemetry, human-validated memory and the professional knowledge packs.

## White Label agent integration

Every current White Label agent receives the common tool:

`consult_eynowa_professional_brain`

The tool is additive. Existing tools are preserved.

The tool may send:

- question/task
- requested domains
- frameworks
- country
- client context
- professional profile ID

It receives the professional result plus the explicit metadata:

- `eynowa_lab_role = professional_helper`
- `decision_authority = calling_agent_and_human_professional`

A Lab transport/model failure is non-blocking for the calling agent.

## Network architecture

Production White Label keeps the existing broker architecture:

```text
White Label on Vercel
        |
        | POST broker /job
        | type = professional.query
        v
Cloudflare broker + Queue
        |
        v
Local PC worker v3
        |
        | POST /v1/professional/query
        v
EYNOWA Gateway :8787
        |
        +-- Chroma
        +-- Ollama
        +-- professional memory/validation
```

Vercel does not need inbound access to the user's PC and does not receive the local Gateway API key.

### Production Vercel variables

- `EYNOWA_BROKER_URL`
- `EYNOWA_BROKER_KEY`

The legacy direct variables remain supported for deliberate local/dev use only:

- `EYNOWA_LAB_URL`
- `EYNOWA_LAB_API_KEY`

When broker configuration is present, White Label prefers the broker path.

## Local worker

The prior local file `eynowa-cloudflare-worker-v2.js` only supported `ai.local_chat`.

The versioned replacement is:

`scripts/eynowa-cloudflare-worker-v3.js`

It accepts exactly two queue job types:

- `ai.local_chat` -> `/ai/local-chat`
- `professional.query` -> `/v1/professional/query`

Unknown job types are rejected and are never converted into arbitrary URLs/actions.

Required local worker environment variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_QUEUE_ID`
- `CLOUDFLARE_QUEUE_TOKEN`
- `EYNOWA_LAB_API_KEY`
- `EYNOWA_BROKER_URL`
- `EYNOWA_BROKER_KEY`

Optional:

- `EYNOWA_LOCAL_GATEWAY_URL` (default `http://127.0.0.1:8787`)
- `EYNOWA_WORKER_POLL_MS`

Only one pull worker should consume this queue on the PC at a time. Do not keep v2 and v3 running concurrently.

## Gateway contract

The local Gateway must expose:

- `POST /v1/professional/query`

The validated professional implementation also includes memory, import, health, diagnostics, validation, feedback and metrics routes. White Label agent consultation only needs the query endpoint for normal inference.

## Security / professional guardrails

The integration does not allow Lab to:

- execute arbitrary application actions;
- modify or move evidence;
- send external communications;
- sign or approve audit work;
- override verified mission facts;
- bypass approval or segregation-of-duties rules;
- persist model-generated professional conclusions as human-validated memory.

Professional memory remains restricted to human-validated decisions.

## Tests

`tests/eynowa-professional-broker.test.js` covers:

- broker job type `professional.query`;
- broker result polling;
- direct local/dev fallback;
- arbitrary operation rejection;
- local worker route allow-list;
- local worker routing to `/v1/professional/query`;
- queue-body parsing.

The original professional suite remains in `eynowa-lab/professional/`, including the 54-case métier evaluation corpus.

## Deployment status

This branch is an integration branch only. Creating or reviewing its PR does not deploy production.

Do not merge into `feature/white-label-desktop` until:

1. automated White Label tests/checks are green;
2. local worker v3 has been started instead of v2;
3. the local Gateway Professional Brain endpoint responds through the broker path;
4. a real White Label preview request confirms an agent can consult the Brain and preserve human validation requirements.
