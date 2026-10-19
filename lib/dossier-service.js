import { missionPresentation } from "./mission-function.js";
import {
  agentsForRole,
  AGENTS,
  dossierSteps,
  dossierStates,
  procedureSummary,
  STEPS,
} from "./dossier-model.js";
const RESPONSIBLE_LABELS = { partner: "Associé", manager: "Manager", supervisor: "Superviseur", senior: "Senior", auditor: "Auditeur",
  quality_reviewer: "Revue qualité", specialist: "Spécialiste", secretary: "Secrétariat", finance: "Finance", bdm: "BDM" };
const fail = (code, statusCode = 400) =>
  Object.assign(new Error(code), { statusCode });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const q = encodeURIComponent;
// Every section is authorised independently. The summary is not a new permission.
export async function dossierView(orgId, input, account, d = {}) {
  if (!account?.email) throw fail("USER_SESSION_REQUIRED", 401);
  const fetchRows = d.fetchRows || (await import("./supabase.js")).rest;
  const permissions = await (
    d.permissions ||
    ((o, a) =>
      import("./permissions.js").then((m) =>
        m.permissionsView(o, a, { fetchRows }),
      ))
  )(orgId, account);
  const screens = permissions.mine.screens;
  const allowed = (key) => screens[key]?.level && screens[key].level !== "none";
  const missionId = String(input.mission_id || ""),
    opportunityId = String(input.opportunity_id || "");
  if (!missionId && !opportunityId) throw fail("DOSSIER_REQUIRED");
  if (
    (missionId && !UUID.test(missionId)) ||
    (opportunityId && !UUID.test(opportunityId))
  )
    throw fail("INVALID_DOSSIER_ID");
  const issues = [];
  async function optional(label, fn) {
    try {
      return await fn();
    } catch (e) {
      issues.push({ section: label, code: "SECTION_UNAVAILABLE" });
      return null;
    }
  }
  let mission = null,
    opportunity = null,
    programme = null,
    work = [],
    events = [];
  if (missionId) {
    if (!allowed("mission")) throw fail("SCREEN_NOT_ALLOWED", 403);
    await (
      d.requireMissionAccess ||
      (await import("./mission-access.js")).requireMissionAccess
    )(orgId, missionId, account, fetchRows);
    mission = await (
      d.mission || (await import("./mission-full.js")).getMissionFull
    )(orgId, missionId);
    if (!mission?.mission) throw fail("MISSION_NOT_FOUND", 404);
  }
  if (opportunityId) {
    if (!allowed("opportunities")) throw fail("SCREEN_NOT_ALLOWED", 403);
    opportunity = await (
      d.opportunity || (await import("./opportunities.js")).getOpportunity
    )(opportunityId);
    const privileged = ["owner", "partner", "bdm", "secretary"].includes(
      account.role,
    );
    const email = account.email.toLowerCase();
    const inTeam = (opportunity.team?.members || []).some(
      (m) => String(m.email || "").toLowerCase() === email,
    );
    if (!privileged && !inTeam) throw fail("NOT_ON_THIS_DOSSIER", 403);
    if (missionId && opportunity.mission_id !== missionId)
      throw fail("DOSSIER_MISMATCH", 409);
  }
  if (missionId && allowed("workpapers")) {
    const data = await optional("programme", () =>
      fetchRows(
        `office_work_programmes?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&select=id,office_mission_id,version,status,cycles,reviews,workpapers,validated_at&order=version.desc&limit=20`,
      ),
    );
    programme =
      data?.find((p) => p.status === "validated") ||
      data?.find((p) => p.status === "draft") ||
      null;
    // Only the programme currently displayed. Never merge old and new procedure versions.
    if (programme)
      work =
        (await optional("procedures", () =>
          fetchRows(
            `office_procedure_work?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&programme_id=eq.${q(programme.id)}&select=procedure_code,status,items,review_points,reviews&limit=1000`,
          ),
        )) || [];
  }
  if (missionId && allowed("audit_log"))
    events =
      (await optional("timeline", () =>
        (
          d.events ||
          (async (...args) =>
            (await import("./event-bus.js")).listEvents(...args))
        )(orgId, { engagementId: missionId, limit: 40 }, fetchRows),
      )) || [];
  // The firm's workflow (point 1, 2026-10-19): the mission's type decides which one; the states are the application's own.
  // A mission opened alone finds the opportunity it came from (one link, never guessed): its steps' states come from it,
  // its content is shown only through the opportunity's own screen and rights.
  let linked = null;
  if (missionId && !opportunity)
    linked = await optional("opportunity-link", async () =>
      (await (d.opportunityLinks || (async () => (await import("./opportunities.js")).opportunityLinks(d)))()).byMission.get(missionId) || null);
  const source = opportunity || linked;
  const states = dossierStates({ opportunity: source, mission, programme, work });
  let position = {},
    missionType = "default";
  if (missionId) {
    const row = await optional("workflow-position", async () => {
      const base = `office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&limit=1&select=`;
      return (
        (await fetchRows(base + "engagement_type,workflow,followups").catch(() => fetchRows(base + "id")))?.[0] || {}
      );
    });
    position = row?.workflow || {};
    missionType = row?.engagement_type || "default";
    // A direct mission records its acceptance as an open item (lib/mission-quick.js), not on an opportunity.
    const acc = row?.followups?.acceptance?.status;
    if (!source && (acc === "done" || acc === "not_applicable")) states.acceptance = "recorded";
  }
  const wf = await optional("workflow", async () => {
    const m = await import("./firm-workflow.js");
    return m.workflowState(await (d.effectiveWorkflow || m.effectiveWorkflow)(orgId, missionType, fetchRows), states, position, { hasOpportunity: Boolean(source), missionStarted: Boolean(missionId) });
  });
  const builtinSteps = dossierSteps({
    opportunity: source,
    mission,
    programme,
    work,
    permissions: screens,
    states,
  });
  const screenOf = Object.fromEntries(STEPS.map((x) => [x[0], x[8]]));
  const visible = (x) => screens[x]?.level && screens[x].level !== "none";
  const steps =
    wf && !wf.builtin
      ? wf.steps
          .filter((x) => x.applicable && visible(screenOf[x.detector] || "mission"))
          .map((x, i, list) => ({
            id: x.id,
            label: x.label,
            person: x.responsible.map((r) => RESPONSIBLE_LABELS[r] || r).join(" / "),
            agent: x.agent,
            action: x.action || x.decision || "",
            result: (x.documents || []).join(" ; ") || x.decision || "",
            next_person: list[i + 1] ? list[i + 1].responsible.map((r) => RESPONSIBLE_LABELS[r] || r).join(" / ") : "—",
            next_agent: list[i + 1]?.agent || null,
            screen: screenOf[x.detector] || "mission",
            state: x.state,
            href: builtinSteps.find((b) => b.id === x.detector)?.href || (missionId ? "/mission.html?id=" + q(missionId) : "/dossiers.html"),
            gate: x.gate,
            current: wf.current === x.id,
          }))
      : builtinSteps.map((x) => {
          const w = wf?.steps.find((y) => y.id === x.id);
          return w ? { ...x, gate: w.gate, current: wf.current === x.id } : x;
        });
  const presentation = missionId
    ? await optional("mission-function", () =>
        missionPresentation(orgId, missionId, account, fetchRows),
      )
    : null;
  const title = mission?.mission?.name || opportunity?.title || "Dossier";
  return {
    title,
    mission_id: missionId || null,
    opportunity_id: opportunityId || null,
    linked_opportunity_id: linked?.id || null,
    role: account.role,
    presentation: presentation || {
      role: account.role,
      source: "account",
      label: null,
    },
    permissions: screens,
    agents: agentsForRole(account.role)
      .filter((k) => k !== "shadow" || allowed("shadow"))
      .map((key) => ({ key, ...AGENTS[key] })),
    steps,
    workflow: wf,
    workflow_position: position,
    next:
      steps.find((s) => s.current) ||
      steps.find((s) => s.state === "pending") ||
      steps.find((s) => s.state === "review") ||
      null,
    deadlines:
      mission?.deadlines ||
      (opportunity?.deadline
        ? [{ what: "Date limite du dossier", due: opportunity.deadline }]
        : []),
    blockers: mission?.blockers || [],
    team: allowed("team")
      ? (mission?.team_assigned || opportunity?.team?.members || []).map(
          (x) => ({
            name: x.full_name || x.name || null,
            role: x.mission_role || x.role || null,
            status: x.status || null,
          }),
        )
      : null,
    documents: allowed("documents")
      ? (mission?.documents || opportunity?.tdr_files || []).map((x) => ({
          id: x.file_id || x.id,
          name: x.name,
          url: x.web_url || x.url || null,
          type: x.document_type || null,
        }))
      : null,
    risks: allowed("workpapers") ? mission?.risks || [] : null,
    cycles: allowed("workpapers")
      ? procedureSummary(programme, work, account.role, account.email)
      : null,
    programme: programme
      ? {
          id: programme.id,
          version: programme.version,
          status: programme.status,
        }
      : null,
    quotation:
      allowed("billing") && opportunity
        ? {
            file: opportunity.quotation?.file || null,
            status: opportunity.quotation?.status || null,
            changes: opportunity.quotation?.changes || [],
            notification: opportunity.quotation?.notification || null,
          }
        : null,
    specialists:
      allowed("team") && opportunity
        ? Object.entries(opportunity.team?.specialists || {}).flatMap(
            ([gap, g]) =>
              (g.list || []).map((s) => ({
                id: s.id,
                name: s.name,
                gap,
                source: s.source || null,
                status: s.followup?.stage || "identified",
                followup: s.followup || null,
              })),
          )
        : null,
    may_manage:
      opportunity && ["owner", "partner", "manager"].includes(account.role)
        ? await (
            d.mayManage ||
            (await import("./opportunities.js")).mayManageOpportunity
          )(opportunity, account)
        : false,
    // No event payloads or unfiltered message text: they can contain financial or private data.
    timeline: events
      .filter((e) => allowed("billing") || !/^QUOTATION_/.test(e.event_type))
      .map((e) => ({
        id: e.id,
        type: e.event_type,
        agent: e.agent_id,
        consumer: e.consumer,
        at: e.occurred_at,
        status: e.status,
      })),
    source_status: issues,
    notice:
      "Vue des informations enregistrées. Une étape documentée ne vaut pas validation ; les signatures doivent être vérifiées sur la version actuelle du fichier.",
  };
}

export async function dossierList(orgId, account, d = {}) {
  if (!account?.email) throw fail("USER_SESSION_REQUIRED", 401);
  const fetchRows = d.fetchRows || (await import("./supabase.js")).rest;
  const rights = await (
    d.permissions ||
    ((o, a) =>
      import("./permissions.js").then((m) =>
        m.permissionsView(o, a, { fetchRows }),
      ))
  )(orgId, account);
  const allowed = (k) =>
    rights.mine.screens[k]?.level && rights.mine.screens[k].level !== "none";
  let missions = [],
    opportunities = [];
  if (allowed("mission")) {
    const ids = await (
      d.accessibleMissionIds ||
      (await import("./mission-access.js")).accessibleMissionIds
    )(orgId, account, fetchRows);
    if (ids === null || ids.size) {
      const filter =
        ids === null ? "" : "&id=in.(" + [...ids].map(q).join(",") + ")";
      missions = await fetchRows(
        "office_missions?org_id=eq." +
          q(orgId) +
          filter +
          "&status=not.in.(archived,cancelled,canceled)&select=id,name,status,planned_end&order=created_at.desc&limit=101",
      );
    }
  }
  if (allowed("opportunities"))
    opportunities = await (
      d.opportunities ||
      (await import("./opportunities.js")).workspaceOpportunities
    )(orgId, account);
  return {
    missions: (missions || []).slice(0, 100),
    opportunities: (opportunities || []).slice(0, 100),
    truncated: missions?.length > 100 || opportunities?.length > 100,
    permissions: rights.mine.screens,
  };
}
