import { acquireOfflineReaderLease } from "../lib/inspection-runtime.js";
import test from "node:test";
import assert from "node:assert/strict";
import mammoth from "mammoth";
import {
  planProgramme,
  saveProgramme,
  validateProgramme,
  programmeView,
  publishProgramme,
  proposeCycle,
} from "../lib/work-programme.js";
import {
  planningProposals,
  PLANNING_INSTRUCTIONS,
} from "../lib/programme-planning.js";
import {
  buildProgrammeDocument,
  exportProgramme,
} from "../lib/programme-document.js";
const M = "11111111-1111-1111-1111-111111111111",
  FILE = "document_source_12345678901";
const a = { role: "manager", email: "manager@test.invalid" };
const text =
  "Nous avons décidé de rechercher les factures fournisseurs en double après notre revue analytique.";
const lib = {
  sops: [
    {
      file_id: "sop",
      file_name: "Achats.docx",
      cycle: { code: "ACH", title: "Achats" },
      procedures: [
        {
          code: "ACH-01",
          title: "Compréhension des achats",
          type: "CORE",
          sampling_mode: "none",
        },
        {
          code: "ACH-02",
          title: "Recherche de factures en double",
          type: "RISK_DEPENDENT",
          sampling_mode: "none",
        },
      ],
    },
  ],
};
function fixture() {
  const rows = [],
    files = new Map();
  let seq = 0,
    analyses = 0;
  files.set(FILE, {
    id: FILE,
    name: "Discussion.docx",
    modifiedTime: "v1",
    parents: ["mission-root"],
    text,
  });
  const drive = {
    getMeta: async (id) => files.get(id),
    readText: async (id) => ({ text: files.get(id).text, file: files.get(id) }),
    downloadBuffer: async (id) => files.get(id).bytes,
    findFilesByExactName: async (name, parent) =>
      [...files.values()].filter(
        (f) => f.name === name && f.parents.includes(parent),
      ),
    createBinary: async ({ name, parentId, buffer }) => {
      const f = {
        id: "out" + ++seq,
        name,
        parents: [parentId],
        bytes: buffer,
        modifiedTime: "v" + seq,
      };
      files.set(f.id, f);
      return f;
    },
  };
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith("office_missions"))
      return path.includes("org_id=eq.other")
        ? []
        : [{ id: M, name: "Audit exemple", drive_folder_id: "mission-root" }];
    if (path.startsWith("office_mission_assignments"))
      return [{ staff_profile_id: "s", mission_role: "manager" }];
    if (path.startsWith("office_staff_profiles"))
      return [{ id: "s", email: a.email, full_name: "Responsable" }];
    if (path.startsWith("office_work_programmes")) {
      if (o.method === "POST") {
        const x = { id: "p" + rows.length, ...JSON.parse(o.body)[0] };
        rows.push(x);
        return [x];
      }
      if (o.method === "PATCH") {
        const id = /[?&]id=eq.([^&]+)/.exec(path)?.[1],
          x = rows.find(
            (x) =>
              x.id === id &&
              (!path.includes("status=eq.draft") || x.status === "draft") &&
              (!path.includes("status=eq.validated") ||
                x.status === "validated"),
          );
        if (!x) return [];
        Object.assign(x, JSON.parse(o.body));
        return [x];
      }
      return [...rows].sort((a, b) => b.version - a.version);
    }
    return [];
  };
  const d = {
    lease: async (org, scope) => acquireOfflineReaderLease(org + scope),
    drive,
    fetchRows,
    methodology: async () => lib,
    permissions: async () => ({ granted: true }),
    audit: async () => ({}),
    emit: async () => ({}),
    analyse: async (args) => {
      analyses++;
      assert.match(args.instructions, /DONNÉES/);
      return {
        provider: "simulated",
        model: "fixture",
        text: JSON.stringify({
          mappings: [
            {
              sop_file_id: "sop",
              code: "ACH-02",
              source_index: 0,
              quote: text,
              rationale: "La discussion prévoit de rechercher les doublons.",
              origin: "source",
            },
          ],
          questions: ["Quel exercice est concerné ?"],
        }),
      };
    },
  };
  return { rows, files, d, analyses: () => analyses };
}
function complete(p) {
  p.cycles[0].preparer = a.email;
  p.cycles[0].planning_questions[0].resolution = "Exercice 2025";
  const x = p.cycles[0].procedures.find((x) => x.code === "ACH-02");
  x.justification = "Risque de doublons identifié à la revue";
  x.planning.reviewed = true;
  x.planning.review_note = "Rapprochement vérifié, procédure retenue.";
  return {
    ...p,
    materiality: { overall: 1000, currency: "XOF" },
    reviews: { manager: true },
  };
}

test("full flow: prose without codes → sourced proposal → human review → validated Word in mission → new version", async () => {
  const f = fixture();
  const proposal = await planProgramme("org", M, { file: FILE }, a, f.d);
  assert.equal(proposal.mappings[0].code, "ACH-02");
  assert.equal(proposal.cycles[0].procedures[1].planning.reviewed, false);
  assert.equal(f.rows.length, 0);
  let body = complete(proposal);
  await saveProgramme("org", M, body, a, f.d);
  const valid = await validateProgramme("org", M, a, f.d);
  assert.equal(valid.document.status, "verified");
  const doc = f.files.get(valid.document.id);
  assert.ok(doc.parents.includes("mission-root"));
  const read = await mammoth.extractRawText({ buffer: doc.bytes });
  assert.match(read.value, /ACH-02/);
  assert.match(read.value, /manager@test.invalid/);
  assert.match(read.value, /Exercice 2025/);
  assert.match(read.value, /Ce programme planifie les travaux/);
  const again = await publishProgramme("org", M, a, f.d);
  assert.equal(again.id, valid.document.id);
  await saveProgramme("org", M, body, a, f.d);
  assert.equal(f.rows.length, 2);
  assert.equal(f.rows[1].version, 2);
  assert.equal(f.rows[0].status, "validated");
});

test("unreviewed mappings and unresolved questions block validation; authenticated reviewer is stamped", async () => {
  const f = fixture(),
    proposal = await planProgramme("org", M, { file: FILE }, a, f.d);
  const b = {
    ...proposal,
    materiality: { overall: 1 },
    reviews: { manager: true },
  };
  b.cycles[0].preparer = a.email;
  b.cycles[0].procedures[1].justification = "Risque";
  await saveProgramme("org", M, b, a, f.d);
  await assert.rejects(
    validateProgramme("org", M, a, f.d),
    (e) =>
      e.gaps.some((x) => x.gap === "PLANNING_REVIEW_REQUIRED") &&
      e.gaps.some((x) => x.gap === "PLANNING_QUESTION_OPEN"),
  );
  b.cycles[0].procedures[1].planning.reviewed = true;
  await assert.rejects(
    saveProgramme("org", M, b, a, f.d),
    /PLANNING_REVIEW_NOTE_REQUIRED/,
  );
  await saveProgramme("org", M, complete(proposal), a, f.d);
  assert.equal(f.rows[0].cycles[0].procedures[1].planning.reviewed_by, a.email);
});

test("unknown codes and fabricated quotes are rejected; source text never grants tool permissions", () => {
  const result = planningProposals(
    {
      mappings: [
        {
          sop_file_id: "sop",
          code: "FAKE-99",
          source_index: 0,
          quote: text,
          rationale: "x",
        },
        {
          sop_file_id: "sop",
          code: "ACH-02",
          source_index: 0,
          quote: "invented quote is not in document",
          rationale: "x",
        },
      ],
    },
    [{ text }],
    lib,
  );
  assert.equal(result.mappings.length, 0);
  assert.equal(result.questions.length, 2);
  assert.match(PLANNING_INSTRUCTIONS, /Aucun outil/);
});

test("external AI permission, mission membership, and organisation are checked before the provider", async () => {
  const f = fixture();
  f.d.permissions = async () => ({ granted: false });
  await assert.rejects(
    planProgramme("org", M, { file: FILE }, a, f.d),
    /AGENTS_NOT_AUTHORIZED/,
  );
  assert.equal(f.analyses(), 0);
  f.d.permissions = async () => ({ granted: true });
  await assert.rejects(
    planProgramme(
      "org",
      M,
      { file: FILE },
      { ...a, email: "other@test.invalid" },
      f.d,
    ),
    /NOT_ON_THIS_MISSION/,
  );
  await assert.rejects(
    planProgramme("other", M, { file: FILE }, a, f.d),
    /MISSION_NOT_FOUND/,
  );
  f.files.get(FILE).parents = ["another-mission"];
  await assert.rejects(
    planProgramme("org", M, { file: FILE }, a, f.d),
    /PLANNING_SOURCE_OUTSIDE_MISSION/,
  );
  assert.equal(f.analyses(), 0);
});

test("changed sources invalidate save and validation; a provider outage does not modify the draft", async () => {
  const f = fixture(),
    p = complete(await planProgramme("org", M, { file: FILE }, a, f.d));
  await saveProgramme("org", M, p, a, f.d);
  f.files.get(FILE).modifiedTime = "v2";
  await assert.rejects(
    validateProgramme("org", M, a, f.d),
    /PLANNING_SOURCE_CHANGED/,
  );
  await assert.rejects(
    saveProgramme("org", M, p, a, f.d),
    /PLANNING_SOURCE_CHANGED/,
  );
  f.d.analyse = async () => {
    throw new Error("NO_AI_PROVIDER_CONFIGURED");
  };
  await assert.rejects(
    planProgramme("org", M, { discussion: "Notre discussion libre" }, a, f.d),
    /NO_AI_PROVIDER_CONFIGURED/,
  );
  assert.equal(f.rows[0].status, "draft");
});

test("existing manual assignments, samples and decisions survive additional analysis", async () => {
  const f = fixture(),
    c = proposeCycle(lib.sops[0]);
  c.preparer = "auditor@test.invalid";
  c.procedures[0].active = false;
  c.procedures[0].justification = "Périmètre justifié";
  c.procedures[1].sample_size = 45;
  const result = await planProgramme(
    "org",
    M,
    { file: FILE, cycles: [c] },
    a,
    f.d,
  );
  assert.equal(result.cycles[0].preparer, c.preparer);
  assert.equal(result.cycles[0].procedures[0].active, false);
  assert.equal(result.cycles[0].procedures[1].sample_size, 45);
});

test("Drive export failure leaves the validated programme intact and can be retried", async () => {
  const f = fixture(),
    p = complete(await planProgramme("org", M, { file: FILE }, a, f.d));
  await saveProgramme("org", M, p, a, f.d);
  const result = await validateProgramme("org", M, a, {
    ...f.d,
    exportProgramme: async () => {
      throw new Error("DRIVE_OFFLINE");
    },
  });
  assert.equal(result.document.status, "pending");
  assert.equal(f.rows[0].status, "validated");
  assert.equal((await publishProgramme("org", M, a, f.d)).status, "verified");
});

test("real DOCX source is read as prose, and a content change with unchanged metadata is detected", async () => {
  const f = fixture();
  const bytes = await buildProgrammeDocument(
    { name: text },
    {
      version: 1,
      validated_by: "fixture",
      validated_at: "2026-10-17",
      materiality: { overall: 1, currency: "XOF" },
      reviews: {},
      cycles: [],
    },
  );
  f.files.get(FILE).bytes = bytes;
  f.d.drive.readText = async (id) => ({
    text: (await mammoth.extractRawText({ buffer: f.files.get(id).bytes }))
      .value,
  });
  const proposal = complete(
    await planProgramme("org", M, { file: FILE }, a, f.d),
  );
  await saveProgramme("org", M, proposal, a, f.d);
  f.files.get(FILE).bytes = await buildProgrammeDocument(
    { name: text + " Décision ultérieure." },
    {
      version: 1,
      validated_by: "fixture",
      validated_at: "2026-10-17",
      materiality: { overall: 1, currency: "XOF" },
      reviews: {},
      cycles: [],
    },
  );
  await assert.rejects(
    validateProgramme("org", M, a, f.d),
    /PLANNING_SOURCE_CHANGED/,
  );
});

test("stale browser refuses to replace another saved draft", async () => {
  const f = fixture(),
    proposal = complete(await planProgramme("org", M, { file: FILE }, a, f.d));
  await saveProgramme("org", M, proposal, a, f.d);
  await assert.rejects(
    saveProgramme(
      "org",
      M,
      { ...proposal, expected_programme_id: null, expected_updated_at: null },
      a,
      f.d,
    ),
    /PROGRAMME_CHANGED_RELOAD/,
  );
  assert.equal(f.rows.length, 1);
});
