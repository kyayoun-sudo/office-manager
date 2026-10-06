# Office Manager AI

TATY People Intelligence : consultation interne `POST /api/people` avec `mission_id`, sans appel IA externe. Règles R009–R012, matching complémentaire et briefing sont raccordés à l'architecture existante. Lire `PROJECT_STATUS.md`, `docs/PEOPLE_INTELLIGENCE.md` et `docs/DEPLOYMENT.md` avant déploiement. Tests : `pnpm test` et `pnpm test:sql`.

Office Manager AI is a multi-agent operating layer for audit, accounting and advisory firms.

## Architecture

- **GitHub** — source of truth for application/agent code
- **Vercel** — web app and server-side API
- **Supabase** — database, permissions, queues, run history and durable workers
- **OpenAI** — primary reasoning/orchestration provider
- **Anthropic Claude** — optional specialist/reviewer provider

## Agents

**Grand Contrôleur / Office Manager AI** is the root orchestrator (not a specialist). It owns the global view: all missions, global planning, staff capacity and availability, overlaps/overload, staff and firm KPI, global alerts, prioritisation and arbitration. Its specialists are:

- **Mission Controller** — lifecycle of one mission: TDR/contract/engagement letter, validated work programme, cycles/workstreams, required Working Papers, PBC List and received-document control, review, deadlines, delay risks
- **Orpailleur** — Drive inventory, document inspection, versions and controlled filing
- **Sika** — billing/collection workflow and administrative follow-up

See `README_ARCHITECTURE_PHASE1.md` for the phase-1 refactor and Supabase compatibility notes.

## Important

No API key or secret belongs in this repository.

Create the following variables in Vercel:

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
```

`ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are optional until Claude is enabled.

## API

- `GET /api/health`
- `GET /api/status`
- `POST /api/agent`
- `GET|POST /api/orpailleur`

## Safety model

The application:
- checks each organisation's `office_agent_settings`
- checks `office_processing_permissions.external_ai_approved` before sending data to an external AI provider
- creates an `office_agent_runs` audit trail
- does not automatically approve destructive or outbound actions
- protects the pilot API with `OFFICE_MANAGER_ACCESS_TOKEN`

## Supabase worker

The currently deployed Orpailleur source is versioned at:

`supabase/functions/orpailleur-durable-worker/index.ts`

Supabase remains the live durable worker/data layer. This repository gives us a clean source-controlled application layer.
