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
import { resolveRequestOrg } from "../lib/firm-context.js";
import { CONSULT_TOOLS } from "../lib/orchestrator.js";
import { runOfficeManagerKernel, KERNEL_STATUS } from "../lib/office-manager-kernel.js";
import { assertIsolatedOrg } from "../lib/test-mode.js";
import { loadGoogleConnection } from "../lib/google-connection.js";
import { ensureAgentSettings } from "../lib/agent-permissions.js";
import { loadPeoplePolicy, peoplePolicyContext } from "../lib/people-policy.js";
import { deriveRunStatus } from "../lib/run-status.js";
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

function persistedRunStatus(kernelStatus) {
  if (kernelStatus === KERNEL_STATUS.VERIFIED) return 'verified';
  if (kernelStatus === KERNEL_STATUS.AWAITING_HUMAN) return 'partial';
  if (kernelStatus === KERNEL_STATUS.BLOCKED) return 'blocked';
  return 'partial';
}

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

  return [
    ...new Set(
      toolsUsed
        .map(name => CONSULT_TOOL_TO_SPECIALIST[name])
        .filter(Boolean)
    )
  ];
}

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
    const requestedAgent = normalizeRequestedAgent(rawRequestedAgent);
    const provider = String(body.provider || "auto").trim();
    const risk = String(body.risk || "normal").trim();

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    if (!requestedAgent) {
      return res.status(400).json({ error: "UNKNOWN_AGENT" });
    }

    const orgId = await resolveRequestOrg(req);
    if (!orgId) {
      return res.status(500).json({ error: "DEFAULT_ORG_ID_MISSING" });
    }
    assertIsolatedOrg(orgId);
    await loadGoogleConnection(orgId).catch(() => null);
    const personalAccount = (req.headers?.authorization || req.headers?.Authorization)
      ? await (await import('../lib/user-auth.js')).currentAccount(req)
      : null;

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
      runAgentKey = resolved.storageKey;
    }

    try {
      const memAgent = requestedAgent === ROOT_ROUTE ? ROOT_AGENT_KEY : requestedAgent;
      const { AGENT_FILES, loadAgentMemory, memorySummary } = await import("../lib/agent-memory.js");
      if (AGENT_FILES[memAgent]) {
        const loaded = await Promise.race([loadAgentMemory(memAgent), new Promise(r => setTimeout(() => r(null), 4000))]).catch(() => null);
        const summary = memorySummary(memAgent, loaded?.memory || null);
        if (requestedAgent === ROOT_ROUTE) rootContext = { ...rootContext, agent_memory: summary };
        else if (contexts[requestedAgent]) contexts[requestedAgent] = { ...contexts[requestedAgent], agent_memory: summary };
      }
    } catch { /* memory unavailable: the agent works as before */ }

    try {
      const { agentSettings } = await import("../lib/agent-persona.js");
      const { names } = await agentSettings(orgId);
      const line = "NOMS DANS CE CABINET (utilise-les pour te présenter et pour parler des autres agents) : agent central = " + names["grand-controleur"] + ", documents et Drive = " + names.orpailleur + ", facturation et administratif = " + names.sika + ", préparation des missions = " + names["mission-controller"] + ", revue d'audit = " + names["enhanced-auditor"] + ".";
      let members = null;
      try { members = await Promise.race([(await import("../lib/firm-members.js")).membersLine(orgId), new Promise(r => setTimeout(() => r(null), 5000))]); } catch { members = null; }
      if (members) { rootContext = { ...rootContext, firm_members: members }; for (const k of Object.keys(contexts || {})) contexts[k] = { ...contexts[k], firm_members: members }; }
      rootContext = { ...rootContext, agent_names: line };
      try {
        const { activeLessons } = await import("../lib/shadow.js");
        const own = await activeLessons(requestedAgent === ROOT_ROUTE ? ROOT_AGENT_KEY : requestedAgent);
        if (own.length) { const t = "LEÇONS APPRISES (applique-les) :\n- " + own.join("\n- "); if (requestedAgent === ROOT_ROUTE) rootContext = { ...rootContext, learned_lessons: t }; else if (contexts[requestedAgent]) contexts[requestedAgent] = { ...contexts[requestedAgent], learned_lessons: t }; }
      } catch { /* no lesson yet */ }
      for (const k of Object.keys(contexts || {})) contexts[k] = { ...contexts[k], agent_names: line };
    } catch { /* default names */ }

    const orchestration =
      requestedAgent === ROOT_ROUTE ? "manager" : "direct-specialist";
    const logicalAgentKey =
      requestedAgent === ROOT_ROUTE ? ROOT_AGENT_KEY : requestedAgent;
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

    const policy = peoplePolicyContext((await loadPeoplePolicy().catch(() => ({ text: '' }))).text);
    rootContext = { ...(rootContext || {}), people_management: policy };
    if (contexts && contexts["mission-controller"]) contexts["mission-controller"] = { ...contexts["mission-controller"], people_management: policy };

    const english = String(req.headers?.["x-om-lang"] || body.lang || "").toLowerCase() === "en";
    if (english) rootContext = { ...(rootContext || {}), reply_language: "English" };

    const kernel = await runOfficeManagerKernel({
      message: english ? message + "\n\n(Answer in English. The firm's documents can be in French or English.)" : message,
      requestedAgent,
      contexts,
      rootContext,
      provider,
      risk,
      orgId,
      runId: run?.id || null,
      storageKeys,
      personalAccount
    });
    const result = kernel.result;
    if (!result?.text) throw new Error('OFFICE_MANAGER_KERNEL_NO_RESULT');

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
    const runStatus = deriveRunStatus({ toolEvents, toolsUsed });

    if (run?.id) {
      await finishAgentRun(run.id, {
        status: persistedRunStatus(kernel.status),
        finished_at: new Date().toISOString(),
        summary: result.text.slice(0, 1000),
        metrics: {
          provider: result.provider,
          providers_used: result.providersUsed || [],
          orchestration,
          logical_agent_key: logicalAgentKey,
          storage_agent_key: runAgentKey,
          legacy_setting_fallback: legacyFallbacks,
          last_agent: result.lastAgent || null,
          reviewed: Boolean(result.review || result.reviewed),
          legacy_route: legacyRoute,
          specialists_used: specialistsUsed,
          tools_used: toolsUsed,
          kernel_status: kernel.status,
          kernel_cycle: kernel.cycle || null,
          kernel_verification: kernel.verification || null,
          release: RELEASE
        },
        errors: kernel.status === KERNEL_STATUS.BLOCKED
          ? [String(kernel.error?.reason || 'KERNEL_BLOCKED') + (kernel.error?.detail ? ': ' + kernel.error.detail : '')]
          : []
      });
    }

    return res.status(200).json({
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
      toolsUsed,
      kernelStatus: kernel.status,
      verification: kernel.verification || null,
      questions: kernel.questions || []
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
      .json({ error: error.statusCode === 401 ? (error.message === "TOKEN_EXPIRED" ? "TOKEN_EXPIRED" : "UNAUTHORIZED") : "AGENT_REQUEST_FAILED",
        runId: run?.id || null });
  }
}