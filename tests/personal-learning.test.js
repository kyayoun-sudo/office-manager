import test from "node:test";
import assert from "node:assert/strict";
import {
  learningView,
  learningNotice,
  startLearning,
  answerLearning,
  saveLearningPreference,
  personalLearningContext,
  learningAgents,
} from "../lib/personal-learning.js";
import { buildNotifications } from "../lib/notifications.js";
const auditor = {
    email: "auditor@test.local",
    role: "auditor",
    position: "Junior 1",
  },
  partner = { email: "partner@test.local", role: "partner" };
function harness() {
  const states = new Map();
  let time = "2026-10-16T10:00:00Z";
  const key = (o, a) => o + ":" + a.email;
  const empty = (o, a) => ({
    org_id: o,
    owner: a.email,
    revision: 0,
    sessions: [],
    preferences: {},
  });
  let calls = 0;
  const d = {
    now: () => time,
    aiAllowed: async () => true,
    load: async (o, a) => ({
      state: structuredClone(states.get(key(o, a)) || empty(o, a)),
    }),
    save: async (o, a, s) => states.set(key(o, a), structuredClone(s)),
    ai: async (order, args) => {
      calls++;
      const input = JSON.parse(args.input);
      if (input.answers)
        return {
          text: JSON.stringify({
            feedback: ["q1", "q2", "q3"].map((id) => ({
              id,
              comment: "Bonne piste : vérifiez les pièces.",
              next_step: "Documentez votre conclusion et faites-la revoir.",
            })),
          }),
        };
      return {
        text: JSON.stringify({
          scenario: "Cas fictif pour " + input.role,
          questions: [1, 2, 3].map((i) => ({
            text: "Question métier " + i + " pour " + input.role,
            reference: "Comparer les pièces puis documenter.",
          })),
        }),
      };
    },
  };
  return { d, states, setTime: (x) => (time = x), calls: () => calls };
}
const answers = {
  q1: "Identifier le risque",
  q2: "Vérifier les pièces",
  q3: "Documenter puis demander la revue",
};
test("monthly training has exactly three questions, hides corrections, resumes and repeats next month", async () => {
  const h = harness();
  assert.equal((await learningNotice("org", auditor, h.d)).due, true);
  const { session } = await startLearning(
    "org",
    auditor,
    { kind: "monthly" },
    h.d,
  );
  assert.equal(session.questions.length, 3);
  assert.equal(session.questions[0].reference, undefined);
  assert.match(session.scenario, /auditor/);
  assert.equal(
    (await startLearning("org", auditor, { kind: "monthly" }, h.d)).session.id,
    session.id,
  );
  assert.equal(h.calls(), 1);
  const draft = await answerLearning(
    "org",
    auditor,
    { session_id: session.id, revision: 0, answers: { q1: "mon brouillon" } },
    h.d,
  );
  assert.equal(draft.session.answers.q1, "mon brouillon");
  assert.equal((await learningNotice("org", auditor, h.d)).due, true);
  await assert.rejects(
    answerLearning(
      "org",
      auditor,
      {
        session_id: session.id,
        revision: 1,
        answers: { q1: "one" },
        submit: true,
      },
      h.d,
    ),
    /THREE_ANSWERS/,
  );
  const done = await answerLearning(
    "org",
    auditor,
    { session_id: session.id, revision: 1, answers, submit: true },
    h.d,
  );
  assert.equal(done.session.feedback.length, 3);
  assert(done.session.questions[0].reference);
  assert.equal(done.session.feedback_source, "ai");
  assert.equal((await learningNotice("org", auditor, h.d)).due, false);
  h.setTime("2026-11-01T00:00:00Z");
  assert.equal((await learningNotice("org", auditor, h.d)).due, true);
  assert.notEqual(
    (await startLearning("org", auditor, { kind: "monthly" }, h.d)).session.id,
    session.id,
  );
});
test("practice and collaboration are separate and do not satisfy the monthly task", async () => {
  const { d } = harness();
  const p = (await startLearning("org", auditor, { kind: "practice" }, d))
      .session,
    c = (await startLearning("org", auditor, { kind: "collaboration" }, d))
      .session;
  assert.notEqual(p.id, c.id);
  await answerLearning(
    "org",
    auditor,
    { session_id: p.id, revision: 0, answers, submit: true },
    d,
  );
  assert.equal((await learningNotice("org", auditor, d)).due, true);
  assert.equal(
    (await startLearning("org", auditor, { kind: "collaboration" }, d)).session
      .id,
    c.id,
  );
  assert.equal((await learningView("org", auditor, d)).sessions.length, 2);
});
test("only the requester can see or answer sessions and old grade sessions do not grant authority", async () => {
  const { d } = harness();
  const { session } = await startLearning(
    "org",
    auditor,
    { kind: "monthly" },
    d,
  );
  assert.equal(
    (await learningView("other-org", auditor, d)).sessions.length,
    0,
  );
  assert.equal((await learningView("org", partner, d)).sessions.length, 0);
  await assert.rejects(
    answerLearning(
      "org",
      partner,
      { session_id: session.id, revision: 0, answers },
      d,
    ),
    /NOT_FOUND/,
  );
  await assert.rejects(
    answerLearning(
      "org",
      { ...auditor, role: "partner" },
      { session_id: session.id, revision: 0, answers },
      d,
    ),
    /NOT_FOUND/,
  );
  await assert.rejects(learningView("org", null, d), /USER_SESSION/);
});
test("stale drafts and modifications after completion cannot replace newer answers", async () => {
  const { d } = harness();
  const { session } = await startLearning(
    "org",
    auditor,
    { kind: "monthly" },
    d,
  );
  await answerLearning(
    "org",
    auditor,
    { session_id: session.id, revision: 0, answers },
    d,
  );
  await assert.rejects(
    answerLearning(
      "org",
      auditor,
      { session_id: session.id, revision: 0, answers: { q1: "stale" } },
      d,
    ),
    /CHANGED_RELOAD/,
  );
  await answerLearning(
    "org",
    auditor,
    { session_id: session.id, revision: 1, answers, submit: true },
    d,
  );
  await assert.rejects(
    answerLearning(
      "org",
      auditor,
      { session_id: session.id, revision: 2, answers },
      d,
    ),
    /ALREADY_COMPLETED/,
  );
});
test("preferences are personal, agent scoped, revision checked and removable", async () => {
  const { d } = harness();
  assert(!learningAgents(auditor).some((a) => a.key === "auto"));
  assert(learningAgents(partner).some((a) => a.key === "auto"));
  await assert.rejects(
    saveLearningPreference(
      "org",
      auditor,
      { agent: "auto", revision: 0, desired: "decide for me" },
      d,
    ),
    /AGENT_NOT_ALLOWED/,
  );
  await saveLearningPreference(
    "org",
    auditor,
    {
      agent: "enhanced-auditor",
      revision: 0,
      desired: "Cite les pièces",
      avoid: "Conclure sans preuve",
      example: "Pièce, constat, suite",
    },
    d,
  );
  const ctx = await personalLearningContext(
    "org",
    auditor,
    { "enhanced-auditor": { mission: "unchanged" } },
    d,
  );
  assert.equal(ctx["enhanced-auditor"].mission, "unchanged");
  assert.equal(
    ctx["enhanced-auditor"].personal_working_preferences.desired,
    "Cite les pièces",
  );
  assert.match(
    ctx["enhanced-auditor"].personal_working_preferences.scope,
    /ne modifient jamais/,
  );
  assert.equal(
    (await personalLearningContext("org", partner, {}, d))["enhanced-auditor"],
    undefined,
  );
  await assert.rejects(
    saveLearningPreference(
      "org",
      auditor,
      { agent: "enhanced-auditor", revision: 0, desired: "stale" },
      d,
    ),
    /CHANGED_RELOAD/,
  );
  await saveLearningPreference(
    "org",
    auditor,
    { agent: "enhanced-auditor", revision: 1, clear: true },
    d,
  );
  assert.equal(
    (await learningView("org", auditor, d)).preferences["enhanced-auditor"],
    undefined,
  );
});
test("AI failure or cabinet refusal gives explicit reference exercises, not a fake AI evaluation", async () => {
  const { d } = harness();
  let calls = 0;
  d.aiAllowed = async () => false;
  d.ai = async () => {
    calls++;
    throw Error("should not call");
  };
  const { session } = await startLearning(
    "org",
    auditor,
    { kind: "collaboration" },
    d,
  );
  assert.equal(session.source, "reference");
  assert.match(session.questions[0].text, /agent/);
  const done = await answerLearning(
    "org",
    auditor,
    { session_id: session.id, revision: 0, answers, submit: true },
    d,
  );
  assert.equal(done.session.feedback_source, "reference");
  assert.equal(calls, 0);
});
test("malformed AI questions and duplicate feedback IDs are rejected rather than falsely graded", async () => {
  const { d } = harness();
  d.ai = async () => ({ text: '{"scenario":"bad","questions":[]}' });
  const { session } = await startLearning(
    "org",
    auditor,
    { kind: "monthly" },
    d,
  );
  assert.equal(session.questions.length, 3);
  assert.equal(session.source, "reference");
  d.ai = async () => ({
    text: JSON.stringify({
      feedback: Array(3).fill({ id: "q1", comment: "x", next_step: "y" }),
    }),
  });
  const done = await answerLearning(
    "org",
    auditor,
    { session_id: session.id, revision: 0, answers, submit: true },
    d,
  );
  assert.equal(done.session.feedback_source, "reference");
});
test("simultaneous starts keep one monthly session", async () => {
  const { d } = harness();
  const [a, b] = await Promise.all([
    startLearning("org", auditor, { kind: "monthly" }, d),
    startLearning("org", auditor, { kind: "monthly" }, d),
  ]);
  assert.equal(a.session.id, b.session.id);
  assert.equal((await learningView("org", auditor, d)).sessions.length, 1);
});
test("monthly reminder is actionable, month-specific and absent after completion", () => {
  const one = buildNotifications(
      {},
      { personalTraining: { due: true, month: "2026-10", role: "auditor" } },
    ),
    two = buildNotifications(
      {},
      { personalTraining: { due: true, month: "2026-11", role: "auditor" } },
    );
  assert.equal(one[0].action_required, true);
  assert.equal(one[0].href, "/apprentissage.html?mode=monthly");
  assert.notEqual(one[0].key, two[0].key);
  assert.equal(
    buildNotifications({}, { personalTraining: { due: false } }).length,
    0,
  );
});
test("storage read failure is explicit, never a new empty session or overwrite", async () => {
  const drive = {
    findFilesByExactName: async () => {
      throw Error("DRIVE_UNAVAILABLE");
    },
    createBinary: async () => {
      throw Error("SHOULD_NOT_WRITE");
    },
  };
  await assert.rejects(
    startLearning(
      "org",
      auditor,
      { kind: "monthly" },
      { drive, folder: "memory" },
    ),
    /DRIVE_UNAVAILABLE/,
  );
});
