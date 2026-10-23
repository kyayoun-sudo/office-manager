# Office Manager AI

Office Manager AI is a multi-agent operating layer for audit, accounting and advisory firms.

## Architecture

- **GitHub** — source of truth for application/agent code
- **Vercel** — web app and server-side API
- **Supabase** — database, permissions, queues, run history and durable workers
- **OpenAI** — primary reasoning provider for Office Manager agents
- **Anthropic Claude** — optional specialist/reviewer provider
- **EYNOWA Lab** — optional shared professional métier helper for Accounting, Audit and Advisory

EYNOWA Lab is **not** the Office Manager orchestrator and does not replace Grand Contrôleur, Orpailleur, Sika or future application-specific agents. The selected agent remains responsible for its own workflow and final synthesis. Lab supplies professional evidence, analysis, sources and validation requirements when useful.

## Agents

- **Grand Contrôleur** — missions, planning, PBC, deadlines, workload, review and delivery risk
- **Orpailleur** — Drive inventory, document inspection, versions and controlled filing
- **Sika** — billing/collection workflow and administrative follow-up

## EYNOWA Lab helper

`/api/agent` preserves the existing agent-selection and `runAI` flow. In Lab mode `auto`, it consults EYNOWA Lab only for detected professional Accounting/Audit/Advisory content. Lab failure is non-blocking: the selected agent continues with its original evidence.

Modes accepted in `POST /api/agent`:
- `eynowa_lab: "auto"` — consult for detected métier content;
- `eynowa_lab: "on"` — force consultation;
- `eynowa_lab: "off"` — disable consultation.

See `EYNOWA_LAB_INTEGRATION.md` for the complete integration contract and adapters for Firm Manager, Mission Controller, Enhanced Auditor, Accounting AI, Posting App and Advisory apps.

## Important

No API key or secret belongs in this repository.

Create the following variables in Vercel as applicable:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DEFAULT_ORG_ID=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-luna
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
ORPAILLEUR_JOB_SECRET=
OFFICE_MANAGER_ACCESS_TOKEN=
EYNOWA_LAB_URL=
EYNOWA_LAB_API_KEY=
```

`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `EYNOWA_LAB_URL` and `EYNOWA_LAB_API_KEY` are optional when the related helper/reviewer is disabled. `EYNOWA_LAB_API_KEY` is server-side only and must never be exposed in browser code.

## API

- `GET /api/health`
- `GET /api/status`
- `POST /api/agent`
- `GET|POST /api/orpailleur`
- `POST /api/lab-validation` — protected bridge for human validation/feedback
- `GET /api/lab-metrics` — protected Lab telemetry summary

## Lab quality controls

```powershell
npm.cmd run test:lab
npm.cmd run lab:eval
npm.cmd run lab:eval:live
```

- `test:lab` checks syntax plus professional unit/regression tests.
- `lab:eval` runs the permanent offline routing corpus.
- `lab:eval:live` runs end-to-end professional evaluations against the configured Lab Gateway.

Only human-validated decisions may be persisted automatically as professional memory. Lab validation cards support accept, correct, request-more-evidence and reject workflows.

## Safety model

The application:
- checks each organisation's `office_agent_settings`
- checks `office_processing_permissions.external_ai_approved` before sending data to an external AI provider
- creates an `office_agent_runs` audit trail
- keeps EYNOWA Lab advisory and non-executing
- does not automatically approve destructive, posting, signature or outbound actions
- protects the pilot API with `OFFICE_MANAGER_ACCESS_TOKEN`

## Supabase worker

The currently deployed Orpailleur source is versioned at:

`supabase/functions/orpailleur-durable-worker/index.ts`

Supabase remains the live durable worker/data layer. This repository gives us a clean source-controlled application layer.
