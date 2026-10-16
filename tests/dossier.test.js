import test from "node:test";
import assert from "node:assert/strict";
import {
  dossierSteps,
  procedureSummary,
  agentsForRole,
} from "../lib/dossier-model.js";
import { dossierView, dossierList } from "../lib/dossier-service.js";
import {
  recordQuotationChange,
  updateSpecialist,
  quotationInbox,
  acknowledgeQuotations,
} from "../lib/dossier-actions.js";
const mid = "11111111-1111-4111-8111-111111111111",
  oid = "22222222-2222-4222-8222-222222222222";
const role = { email: "manager@example.test", role: "manager" };
const screens = Object.fromEntries(
  [
    "mission",
    "opportunities",
    "workpapers",
    "billing",
    "team",
    "documents",
    "acceptance",
    "engagement_letter",
    "audit_log",
    "shadow",
  ].map((k) => [k, { level: "view" }]),
);
const opportunity = {
  id: oid,
  title: "Dossier",
  mission_id: mid,
  status: "go",
  team: {
    members: [{ email: role.email }],
    specialists: { tax: { list: [{ id: "s", name: "Expert" }] } },
  },
  quotation: { file: { id: "file" } },
};
const programme = {
  id: "p",
  office_mission_id: mid,
  status: "validated",
  cycles: [
    {
      cycle_code: "ACH",
      preparer: role.email,
      procedures: [{ code: "ACH01", active: true, title: "Achats" }],
    },
  ],
  workpapers: [{ cycle_code: "ACH", file_id: "wp" }],
};
const mission = {
  mission: { id: mid, name: "Mission" },
  documents: [{ file_id: "e", name: "Preuve" }],
  risks: [],
  team_assigned: [],
  blockers: [],
  deadlines: [],
};
function deps() {
  return {
    permissions: async () => ({ mine: { screens } }),
    requireMissionAccess: async () => {},
    mission: async () => mission,
    opportunity: async () => opportunity,
    mayManage: () => true,
    events: async () => [],
    fetchRows: async (path) =>
      path.startsWith("office_work_programmes") ? [programme] : [],
  };
}
test("workflow displays person, agent, result and next handoff without granting approval", () => {
  const steps = dossierSteps({
    opportunity,
    mission,
    programme,
    work: [
      { procedure_code: "ACH01", reviews: [{ kind: "signoff", bound: true }] },
    ],
    permissions: screens,
  });
  assert(
    steps.every(
      (s) => s.person && s.agent && s.result && s.next_person && s.next_agent,
    ),
  );
  assert.equal(steps.find((s) => s.id === "working_files").state, "recorded");
  assert.equal(steps.find((s) => s.id === "review").state, "review");
  assert.equal(steps.find((s) => s.id === "acceptance").state, "pending");
});
test("mission-only dossier does not show unconnected AMI steps", () =>
  assert(
    !dossierSteps({ mission, permissions: screens }).some(
      (s) => s.id === "decision",
    ),
  ));
test("role agents preserve the restriction on Shadow", () => {
  assert(!agentsForRole("auditor").includes("shadow"));
  assert(agentsForRole("owner").includes("shadow"));
});
test("procedure counts distinguish exceptions, missing evidence and uncleared review points", () => {
  const result = procedureSummary(
    programme,
    [
      {
        procedure_code: "ACH01",
        items: [
          { result: "PASS", evidence: [{}] },
          { result: "EXCEPTION", evidence_ref: "x" },
          { result: null },
        ],
        review_points: [{ status: "open" }, { status: "cleared" }],
      },
    ],
    "manager",
  );
  assert.equal(result[0].file.file_id, "wp");
  assert.equal(result[0].procedures[0].exceptions, 1);
  assert.equal(result[0].procedures[0].missing, 1);
  assert.equal(result[0].procedures[0].open_points, 1);
  assert.equal(
    procedureSummary(programme, [], "auditor", "another@example.test").length,
    0,
  );
});
test("dossier requires identity and checks mission access before loading content", async () => {
  await assert.rejects(
    dossierView("org", { mission_id: mid }, { role: "owner" }, deps()),
    /USER_SESSION_REQUIRED/,
  );
  let calls = 0;
  await assert.rejects(
    dossierView("org", { mission_id: mid }, role, {
      ...deps(),
      requireMissionAccess: async () => {
        throw Error("NOT_ON_THIS_MISSION");
      },
      mission: async () => {
        calls++;
      },
    }),
    /NOT_ON_THIS_MISSION/,
  );
  assert.equal(calls, 0);
});
test("unknown ids and mismatched linked dossiers are refused", async () => {
  await assert.rejects(
    dossierView("org", { mission_id: "bad" }, role, deps()),
    /INVALID_DOSSIER_ID/,
  );
  await assert.rejects(
    dossierView("org", { mission_id: mid, opportunity_id: oid }, role, {
      ...deps(),
      opportunity: async () => ({ ...opportunity, mission_id: "other" }),
    }),
    /DOSSIER_MISMATCH/,
  );
});
test("an unassigned person cannot inspect a commercial dossier", async () =>
  await assert.rejects(
    dossierView(
      "org",
      { opportunity_id: oid },
      { role: "auditor", email: "other@example.test" },
      deps(),
    ),
    /NOT_ON_THIS_DOSSIER/,
  ));
test("sections denied by the permission matrix return neither private data nor finance events", async () => {
  const limited = {
    ...screens,
    billing: { level: "none" },
    team: { level: "none" },
    documents: { level: "none" },
    workpapers: { level: "none" },
    shadow: { level: "none" },
  };
  const d = {
    ...deps(),
    permissions: async () => ({ mine: { screens: limited } }),
    events: async () => [
      { event_type: "QUOTATION_UPDATED", small_payload: { secret: "amount" } },
    ],
  };
  const result = await dossierView(
    "org",
    { mission_id: mid, opportunity_id: oid },
    role,
    d,
  );
  assert.equal(result.quotation, null);
  assert.equal(result.team, null);
  assert.equal(result.documents, null);
  assert.equal(result.cycles, null);
  assert.equal(result.timeline.length, 0);
  assert(!result.steps.some((x) => x.screen === "billing"));
  assert(!JSON.stringify(result).includes("amount"));
});
test("an unavailable procedure store is explicit and does not remove the rest of the dossier", async () => {
  const result = await dossierView("org", { mission_id: mid }, role, {
    ...deps(),
    fetchRows: async () => {
      throw Error("unavailable");
    },
  });
  assert.equal(result.title, "Mission");
  assert(result.source_status.some((x) => x.section === "programme"));
});
test("workspace index scopes missions at the query and never fetches all when no assignment exists", async () => {
  let queries = [];
  const d = {
    ...deps(),
    accessibleMissionIds: async () => new Set([mid]),
    fetchRows: async (p) => {
      queries.push(p);
      return [];
    },
    opportunities: async () => [],
  };
  await dossierList("org", role, d);
  assert(queries[0].includes("id=in.(" + mid + ")"));
  queries = [];
  await dossierList("org", role, {
    ...d,
    accessibleMissionIds: async () => new Set(),
  });
  assert.equal(queries.length, 0);
});
function actionWorld() {
  const state = structuredClone(opportunity);
  const emitted = [];
  let version = "v1";
  return {
    state,
    emitted,
    setVersion: (v) => (version = v),
    d: {
      opportunities: {
        getOpportunity: async () => state,
        mayManageOpportunity: () => true,
        updateOpportunityRecord: async (id, fn) => fn(state),
      },
      drive: { getMeta: async () => ({ id: "file", modifiedTime: version }) },
      emit: async (org, event) => {
        emitted.push(event);
        return { recorded: true };
      },
    },
  };
}
test("quotation changes preserve the original file and deduplicate the same Drive version", async () => {
  const w = actionWorld(),
    body = { opportunity_id: oid, reason: "Jours ajustés" };
  await recordQuotationChange("org", body, role, w.d);
  await recordQuotationChange("org", body, role, w.d);
  assert.equal(w.state.quotation.changes.length, 1);
  assert.equal(w.state.quotation.file.id, "file");
  assert.equal(w.emitted[0].idempotency_key, w.emitted[1].idempotency_key);
  w.setVersion("v2");
  await recordQuotationChange(
    "org",
    { ...body, reason: "Spécialiste ajouté" },
    role,
    w.d,
  );
  assert.equal(w.state.quotation.changes.length, 2);
  assert(w.state.quotation.changes[1].previous_version_key);
});
test("quotation requires a reason and an observed Drive version", async () => {
  const w = actionWorld();
  await assert.rejects(
    recordQuotationChange("org", { opportunity_id: oid }, role, w.d),
    /QUOTATION_REASON_REQUIRED/,
  );
  await assert.rejects(
    recordQuotationChange("org", { opportunity_id: oid, reason: "x" }, role, {
      ...w.d,
      drive: { getMeta: async () => ({}) },
    }),
    /QUOTATION_VERSION_UNVERIFIED/,
  );
});
test("only the dossier manager can record specialist followup, with an optimistic revision check", async () => {
  const w = actionWorld(),
    body = {
      opportunity_id: oid,
      gap: "tax",
      specialist_id: "s",
      stage: "meeting",
      note: "Réunion tenue ; avis à demander",
      expected_version: 0,
    };
  await updateSpecialist("org", body, role, w.d);
  assert.equal(w.state.team.specialists.tax.list[0].followup.declared, true);
  await assert.rejects(
    updateSpecialist("org", body, role, w.d),
    /FOLLOWUP_CHANGED_RELOAD/,
  );
  await assert.rejects(
    updateSpecialist("org", { ...body, expected_version: 1 }, role, {
      ...w.d,
      opportunities: {
        ...w.d.opportunities,
        mayManageOpportunity: () => false,
      },
    }),
    /NOT_THE_MISSION_MANAGER/,
  );
  assert.equal(w.emitted.length, 1);
});
test("SIKA receives only its outstanding quote references and acknowledgement never approves finance", async () => {
  const calls = [],
    d = {
      fetchRows: async (p, o) => {
        calls.push([p, o]);
        return [];
      },
    };
  await quotationInbox("org", d);
  await acknowledgeQuotations("org", [{ id: "event" }], d);
  assert.match(calls[0][0], /consumer=eq.sika/);
  assert.match(calls[0][0], /event_type=eq.QUOTATION_UPDATED/);
  const row = JSON.parse(calls[1][1].body);
  assert.equal(row.status, "handled");
  assert.match(row.result, /aucune approbation/);
});

test("automatic quotation observation notifies SIKA only when the real version changes", async () => {
  const { observeQuotationVersion } = await import("../lib/dossier-actions.js");
  const w = actionWorld();
  await observeQuotationVersion("org", w.state, w.d);
  assert.equal(w.state.quotation.changes.length, 1);
  assert.equal(w.state.quotation.changes[0].observed, true);
  await observeQuotationVersion("org", w.state, w.d);
  assert.equal(w.emitted.length, 1);
  await recordQuotationChange(
    "org",
    { opportunity_id: oid, reason: "Le manager a ajusté les jours" },
    role,
    w.d,
  );
  assert.equal(w.state.quotation.changes.length, 1);
  assert.equal(w.state.quotation.changes[0].observed, false);
  assert.match(w.emitted.at(-1).idempotency_key, /:explanation$/);
  w.setVersion("v2");
  await observeQuotationVersion("org", w.state, w.d);
  assert.equal(w.state.quotation.changes.length, 2);
});
test("an event bus failure remains pending for retry rather than claiming SIKA was informed", async () => {
  const { observeQuotationVersion } = await import("../lib/dossier-actions.js");
  const w = actionWorld();
  let calls = 0;
  const d = {
    ...w.d,
    emit: async () => {
      calls++;
      return { error: "unavailable" };
    },
  };
  await observeQuotationVersion("org", w.state, d);
  await observeQuotationVersion("org", w.state, d);
  assert.equal(calls, 2);
  assert.equal(w.state.quotation.changes.length, 1);
  assert.equal(w.state.quotation.notification.error, "unavailable");
});
test("a reference confirmation persists once in the shared registry and emits a Shadow observation", async () => {
  const { confirmDocumentReference } = await import("../lib/file-index.js");
  let state = { files: {} },
    event;
  const record = await confirmDocumentReference(
    "org",
    {
      document_type: "quotation_workbook",
      document_role: "template",
      file_id: "f",
      requested_by_agent: "mission-controller",
    },
    role,
    {
      drive: {
        getMeta: async () => ({ id: "f", name: "Devis", modifiedTime: "v1" }),
      },
      updateJsonFile: async (n, fn) => {
        state = fn(state);
        return { state };
      },
      emit: async (o, e) => {
        event = e;
        return { recorded: true };
      },
    },
  );
  assert.equal(Object.values(state.references)[0].file_id, "f");
  assert.equal(event.type, "DOCUMENT_REFERENCE_CONFIRMED");
  assert.equal(record.notification.recorded, true);
});
test("attached evidence reaches the existing mission registry without moving it or completing a PBC", async () => {
  const { handleMissionEvents } = await import("../lib/mission-events.js");
  let records = [],
    patches = [];
  const event = {
    id: "e",
    event_type: "EVIDENCE_ATTACHED",
    engagement_id: mid,
    object_id: "f",
    small_payload: {
      name: "Facture",
      cycle: "ACH",
      procedure: "ACH01",
      sample: "S01",
    },
    attempts: 0,
  };
  const result = await handleMissionEvents("org", {
    fetchRows: async (p, o) => {
      if (o?.method === "PATCH") {
        patches.push(JSON.parse(o.body));
        return [];
      }
      if (p.startsWith("office_events")) return [event];
      if (p.startsWith("office_missions")) return [{ id: mid, name: "Audit" }];
      return [];
    },
    loadScan: async () => ({ state: { items: [] } }),
    recordMissionDocuments: async (m, docs) => records.push([m, docs]),
    writeAgentMemory: async () => null,
  });
  assert.equal(result.handled, 1);
  assert.equal(records[0][1][0].id, "f");
  assert.equal(records[0][1][0].pbc_status, "RECEIVED_REVIEW_REQUIRED");
  assert.equal(patches[0].status, "handled");
});
