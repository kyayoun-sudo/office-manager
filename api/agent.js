import {
  LEGACY_SETTING_FALLBACK,
  ROOT_AGENT_KEY,
  ROOT_AGENT_NAME,
  ROOT_ROUTE,
  SPECIALIST_KEYS,
  chooseAgent,
  normalizeRequestedAgent
} from "../agents/index.js";
import { requirePilotAccess } from "../lib/auth.js";
import { CONSULT_TOOLS, runOfficeManager } from "../lib/orchestrator.js";
import { assertIsolatedOrg } from "../lib/test-mode.js";
import { loadGoogleConnection } from "../lib/google-connection.js";
import { ensureAgentSettings } from "../lib/agent-permissions.js";
import {
  createAgentRun,
  finishAgentRun,
  getAgentSetting,
  getPermissions,
  getRunToolEvents,
  loadAgentContext,
  loadRootContext
} from "../lib/supabase.js";

// Specialists of the Grand Contrôleur / Office Manager AI root agent.
// The Grand Contrôleur itself is NOT a specialist: it is the "auto" route.
const SPECIALISTS = SPECIALIST_KEYS; // mission-controller, orpailleur, sika

const RELEASE = "v2.3-architecture-phase1";

// Resolves the Supabase configuration of an agent.
// If mission-controller has no office_agent_settings row yet, the legacy
// "grand-controleur" row is used (mode / enabled state) and its records are
// written under that legacy agent_key. Non-destructive: nothing is migrated.
async function resolveAgentSetting(orgId, agentKey) {
  const own = await getAgentSetting(orgId, agentKey);
  if (own) {
    return { setting: own, storageKey: agentKey, legacyFallback: false };
  }

  const legacyKey = LEGACY_SETTING_FALLBACK[agentKey];
  if (legacyKey) {
    const legacy = await getAgentSetting(orgId, legacyKey);
    if (legacy) {
      return { setting: legacy, storageKey: legacyKey, legacyFallback: true };
    }
  }

  return { setting: null, storageKey: agentKey, legacyFallback: false };
}

async function loadAllowedContexts(orgId) {
  const entries = await Promise.all(
    SPECIALISTS.map(async agentKey => {
      const resolved = await resolveAgentSetting(orgId, agentKey);

      if (!resolved.setting || resolved.setting.mode === "disabled") {
        return [
          agentKey,
          {
            context: { unavailable: true, reason: "AGENT_DISABLED" },
            resolved
          }
        ];
      }

      const context = await loadAgentContext(orgId, agentKey, {
        storageKey: resolved.storageKey
      });
      return [agentKey, { context, resolved }];
    })
  );

  const contexts = {};
  const storageKeys = {};
  const legacyFallbacks = [];
  for (const [agentKey, { context, resolved }] of entries) {
    contexts[agentKey] = context;
    storageKeys[agentKey] = resolved.storageKey;
    if (resolved.legacyFallback) legacyFallbacks.push(agentKey);
  }

  return { contexts, storageKeys, legacyFallbacks };
}

const CONSULT_TOOL_TO_SPECIALIST = Object.fromEntries(
  Object.entries(CONSULT_TOOLS).map(([agentKey, toolName]) => [
    toolName,
    agentKey
  ])
);

function specialistsFromTools(toolsUsed = [], requestedAgent = ROOT_ROUTE) {
  if (requestedAgent !== ROOT_ROUTE) return [requestedAgent];

  // consult_mission_controller / consult_orpailleur / consult_sika
  return [
    ...new Set(
      toolsUsed
        .map(name => CONSULT_TOOL_TO_SPECIALIST[name])
        .filter(Boolean)
    )
  ];
}

// Tool events store the Supabase agent_key in specialist_key (possibly the
// legacy "grand-controleur" for mission-controller) and the logical agent key
// in metadata.logical_agent_key. Only real specialists are reported; tools run
// by the root Grand Contrôleur itself are not a "specialist used".
function specialistsFromEvents(toolEvents = []) {
  return toolEvents
    .map(event =>
      event?.metadata?.logical_agent_key || event?.specialist_key
    )
    .filter(key => SPECIALISTS.includes(key));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let run = null;

  try {
    requirePilotAccess(req);

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body || {};
    const message = String(body.message || "").trim();
    const rawRequestedAgent = String(body.agent || ROOT_ROUTE).trim();
    // "grand-controleur" (legacy specialist key) now means the root agent.
    const requestedAgent = normalizeRequestedAgent(rawRequestedAgent);
    const provider = String(body.provider || "auto").trim();
    const risk = String(body.risk || "normal").trim();

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    if (!requestedAgent) {
      return res.status(400).json({ error: "UNKNOWN_AGENT" });
    }

    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) {
      return res.status(500).json({ error: "DEFAULT_ORG_ID_MISSING" });
    }
    assertIsolatedOrg(orgId);
    await loadGoogleConnection(orgId).catch(() => null);

    const permissions = await getPermissions(orgId);

    if (!permissions?.external_ai_approved) {
      return res
        .status(409)
        .json({ error: "EXTERNAL_AI_APPROVAL_REQUIRED" });
    }

    if (!permissions?.selected_content_approved) {
      return res
        .status(409)
        .json({ error: "CONTENT_PROCESSING_APPROVAL_REQUIRED" });
    }

    // A firm set up in the app (go-ahead given) gets its agents on first use.
    await ensureAgentSettings(orgId).catch(() => null);

    let contexts;
    let rootContext = {};
    let storageKeys = {};
    let legacyFallbacks = [];
    let runAgentKey;

    if (requestedAgent === ROOT_ROUTE) {
      const rootSetting = await getAgentSetting(orgId, ROOT_AGENT_KEY);
      if (!rootSetting) return res.status(404).json({ error: "AGENT_NOT_CONFIGURED" });
      if (rootSetting.mode === "disabled") return res.status(409).json({ error: "AGENT_DISABLED" });
      const [loaded, loadedRoot] = await Promise.all([
        loadAllowedContexts(orgId),
        loadRootContext(orgId, { storageKey: ROOT_AGENT_KEY })
      ]);
      contexts = loaded.contexts;
      storageKeys = { ...loaded.storageKeys, [ROOT_AGENT_KEY]: ROOT_AGENT_KEY };
      legacyFallbacks = loaded.legacyFallbacks;
      rootContext = loadedRoot;
      // The root agent IS the Grand Contrôleur: its runs are stored under
      // agent_key "grand-controleur", which is also the historical key used
      // for manager runs in office_agent_runs (no data migration needed).
      runAgentKey = ROOT_AGENT_KEY;
    } else {
      const resolved = await resolveAgentSetting(orgId, requestedAgent);
      const setting = resolved.setting;

      if (!setting) {
        return res.status(404).json({
          error: "AGENT_NOT_CONFIGURED",
          agent: requestedAgent
        });
      }

      if (setting.mode === "disabled") {
        return res.status(409).json({
          error: "AGENT_DISABLED",
          agent: requestedAgent
        });
      }

      contexts = {
        [requestedAgent]: await loadAgentContext(
          orgId,
          requestedAgent,
          { storageKey: resolved.storageKey }
        )
      };

      storageKeys = { [requestedAgent]: resolved.storageKey };
      if (resolved.legacyFallback) legacyFallbacks = [requestedAgent];

      // mission-controller without its own settings row is stored under the
      // legacy "grand-controleur" agent_key (see resolveAgentSetting).
      runAgentKey = resolved.storageKey;
    }

    const orchestration =
      requestedAgent === ROOT_ROUTE ? "manager" : "direct-specialist";
    const logicalAgentKey =
      requestedAgent === ROOT_ROUTE ? ROOT_AGENT_KEY : requestedAgent;
    // Routing hint only; the root agent decides the actual delegation.
    const legacyRoute = chooseAgent(message);

    run = await createAgentRun({
      org_id: orgId,
      agent_key: runAgentKey,
      status: "running",
      metrics: {
        orchestration,
        logical_agent_key: logicalAgentKey,
        storage_agent_key: runAgentKey,
        legacy_setting_fallback: legacyFallbacks,
        legacy_route: legacyRoute,
        release: RELEASE
      },
      errors: [],
      summary:
        requestedAgent === ROOT_ROUTE
          ? "Grand Contrôleur / Office Manager AI multi-agent request started"
          : `${requestedAgent} operational direct request started`
    });

    const result = await runOfficeManager({
      message,
      requestedAgent,
      contexts,
      rootContext,
      provider,
      risk,
      orgId,
      runId: run?.id || null,
      storageKeys
    });

    const topLevelTools = result.toolsUsed || [];
    const toolEvents = run?.id
      ? await getRunToolEvents(orgId, run.id)
      : [];
    const eventTools = toolEvents
      .map(event => event.tool_name)
      .filter(Boolean);
    const toolsUsed = [...new Set([...topLevelTools, ...eventTools])];
    const eventSpecialists = specialistsFromEvents(toolEvents);
    const specialistsUsed = [
      ...new Set([
        ...specialistsFromTools(topLevelTools, requestedAgent),
        ...eventSpecialists
      ])
    ];

    if (run?.id) {
      await finishAgentRun(run.id, {
        status: "verified",
        finished_at: new Date().toISOString(),
        summary: result.text.slice(0, 1000),
        metrics: {
          provider: result.provider,
          orchestration,
          logical_agent_key: logicalAgentKey,
          storage_agent_key: runAgentKey,
          legacy_setting_fallback: legacyFallbacks,
          last_agent: result.lastAgent || null,
          reviewed: Boolean(result.review || result.reviewed),
          legacy_route: legacyRoute,
          specialists_used: specialistsUsed,
          tools_used: toolsUsed,
          release: RELEASE
        },
        errors: []
      });
    }

    return res.status(200).json({
      // "office-manager" kept as the response value of the root route for
      // existing clients; rootAgentKey identifies it as the Grand Contrôleur.
      agent:
        requestedAgent === ROOT_ROUTE
          ? "office-manager"
          : requestedAgent,
      rootAgentKey: ROOT_AGENT_KEY,
      agentName:
        requestedAgent === ROOT_ROUTE
          ? ROOT_AGENT_NAME
          : result.lastAgent || requestedAgent,
      provider: result.provider,
      answer: result.text,
      runId: run?.id || null,
      reviewed: Boolean(result.review || result.reviewed),
      lastAgent: result.lastAgent || null,
      specialistsUsed,
      toolsUsed
    });
  } catch (error) {
    if (run?.id) {
      try {
        await finishAgentRun(run.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          errors: [String(error.message || error)]
        });
      } catch {}
    }

    console.error(error);

    return res
      .status(error.statusCode || 500)
      .json({ error: error.statusCode === 401 ? "UNAUTHORIZED" : "AGENT_REQUEST_FAILED",
        runId: run?.id || null });
  }
}
