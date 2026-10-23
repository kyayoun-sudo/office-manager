# EYNOWA Lab — Helper Integration Contract

EYNOWA Lab is the shared **professional métier specialist** for EYNOWA applications. It is not the only AI, not the Office Manager orchestrator, and not a replacement for application-specific agents.

## Non-regression rule

Existing EYNOWA Lab capabilities remain available:
- professional query routing;
- Accounting / Audit / Advisory brains;
- Chroma retrieval;
- local professional memory;
- Ollama generation;
- deterministic grounded fallback;
- source filtering;
- validation gate;
- knowledge import;
- health and diagnostics.

The integration layer is additive. A calling app may use Lab, ignore Lab, or continue if Lab is unavailable.

## Authority model

```text
Calling application / agent
        |
        | optionally consults
        v
   EYNOWA Lab
 professional helper
        |
        +-- Accounting
        +-- Audit
        +-- Advisory
        |
        v
 evidence + recommendation + validation flag
        |
        v
Calling agent keeps its role and synthesises the result
        |
        v
Human validation where required
```

Lab does **not**:
- approve audit work;
- move or delete files;
- send communications;
- post accounting entries;
- change workflow status;
- replace Mission Controller, Enhanced Auditor, Orpailleur, Sika or another agent;
- convert a prior client decision into normative authority.

## Shared client

Use `eynowa-lab-client.js` for generic integrations or `eynowa-lab-integrations.js` for named EYNOWA applications.

Available adapters:
- `consultLabForFirmManager`
- `consultLabForMissionController`
- `consultLabForEnhancedAuditor`
- `consultLabForAccountingAI`
- `consultLabForPostingApp`
- `consultLabForAdvisoryApp`

Required server environment variables:

```text
EYNOWA_LAB_URL=http://127.0.0.1:8787
EYNOWA_LAB_API_KEY=<server-side only>
```

Never expose `EYNOWA_LAB_API_KEY` to browser code.

## Firm Manager live integration

`api/agent.js` keeps the existing agent selection and `runAI` path. In `eynowa_lab=auto`, it consults Lab only when the request contains professional Accounting/Audit/Advisory signals. The Lab result is inserted as `eynowa_lab_professional_helper` context for the selected agent.

Modes:
- `auto` — consult only for detected métier content;
- `on` — force consultation;
- `off` — never consult Lab.

A Lab error is non-blocking: the selected agent still runs with its original evidence.

## Human validation and memory

When Lab returns `requires_validation=true`, the response may include `validation_card`.

Actions:
- **Valider** — stores the human-approved conclusion;
- **Corriger puis valider** — stores the corrected human conclusion;
- **Demander des éléments** — records feedback only, no memory;
- **Rejeter** — records feedback only, no memory.

Only `HUMAN_VALIDATED` decisions can enter professional memory automatically. Multi-domain conclusions are stored separately in each validated domain so Accounting, Audit and Advisory memory remain compartmentalised.

## Telemetry

Lab telemetry is local by default:

```text
~/.eynowa-lab/professional-telemetry.jsonl
```

Metrics include:
- query volume;
- validation rate;
- fallback rate;
- deterministic fallback rate;
- JSON repair rate;
- average retrieval/generation/total time;
- average knowledge hits;
- accepted/corrected/rejected/needs-evidence feedback;
- usage by calling application.

Routes:
- `GET|POST /v1/professional/metrics`
- Firm Manager bridge: `GET /api/lab-metrics`

## Permanent evaluations

Offline routing regression suite:

```powershell
npm.cmd run lab:eval
```

Live end-to-end evaluation against the local Gateway/Chroma/Ollama stack:

```powershell
npm.cmd run lab:eval:live
```

The permanent corpus covers Accounting, Audit, Advisory and cross-domain cases.

## Pilot validation UI

The pilot `index.html` exposes:
- professional profile ID;
- Lab mode Auto / On / Off;
- Lab usage marker;
- validation cards;
- validation/correction/evidence/rejection actions;
- Lab metrics.

Browser requests go through protected Office Manager API routes. The Lab API key stays server-side.

## Adding a future EYNOWA application

1. Keep the new application as the owner of its workflow and actions.
2. Import the relevant adapter from `eynowa-lab-integrations.js`.
3. Send only the professional question/context required for Lab's analysis.
4. Treat Lab output as professional helper evidence, not an executed action.
5. Preserve `requires_validation` when Lab returns it.
6. Submit human-validated conclusions through the validation route before using them as professional memory.
