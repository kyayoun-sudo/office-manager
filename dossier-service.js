import {
  agentsForRole,
  AGENTS,
  dossierSteps,
  procedureSummary,
} from "./dossier-model.js";
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
  const steps = dossierSteps({
    opportunity,
    mission,
    programme,
    work,
    permissions: screens,
  });
  const title = mission?.mission?.name || opportunity?.title || "Dossier";
  return {
    title,
    mission_id: missionId || null,
    opportunity_id: opportunityId || null,
    role: account.role,
    permissions: screens,
    agents: agentsForRole(account.role)
      .filter((k) => k !== "shadow" || allowed("shadow"))
      .map((key) => ({ key, ...AGENTS[key] })),
    steps,
    next:
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
