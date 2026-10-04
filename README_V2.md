# Office Manager AI — V2 Multi-Agent

This patch turns the current single-route API into a manager-style multi-agent system using the OpenAI Agents SDK.

## Architecture

Office Manager AI remains the user-facing manager and can call three specialist agents as tools:

- Grand Contrôleur — mission execution, deadlines, capacity, quality and engagement risk.
- Orpailleur — Drive/document/version/filing analysis.
- Sika — billing, collections and administrative follow-up.

Supabase remains the source of authorised business evidence and permissions. OpenAI is the primary orchestration engine. Claude remains available as an alternate provider and as an independent reviewer for `dual`, `high` and `critical` paths.

## Files in this patch

Replace/add these files in the repository:

- `package.json` — adds `@openai/agents` and `zod`.
- `agents/index.js` — adds Office Manager orchestration instructions and specialist descriptions.
- `lib/orchestrator.js` — NEW. Builds specialists, manager tools and Claude review path.
- `api/agent.js` — routes `Auto` through Office Manager manager-style orchestration.

Do not delete the existing `lib/ai.js`, `lib/supabase.js`, `lib/auth.js`, `api/health.js`, `api/status.js`, `api/orpailleur.js`, UI files or Supabase worker.

## Behaviour

- `Agent = Auto`, `IA = Auto` → Office Manager AI orchestrates specialists through the OpenAI Agents SDK.
- Explicit specialist + OpenAI/Auto → runs that specialist directly with the Agents SDK.
- `IA = Claude` → keeps a direct Claude specialist path.
- `IA = Dual` → Office Manager/OpenAI first, Claude independent review second.
- `risk = high/critical` → Claude review is automatically added when configured.

No external messaging, destructive file changes, approvals or accounting changes are introduced by this patch.

## Safe deployment

Prefer uploading these changes to a new branch such as `v2-multi-agent` and testing the Vercel Preview before merging to `main`.
