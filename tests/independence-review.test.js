import test from "node:test";
import assert from "node:assert/strict";
import {
  independenceCases,
  reviewIndependence,
  assertIndependenceContinuation,
  safeguardSuggestions,
} from "../lib/independence-review.js";
const partner = { role: "partner", email: "partner@firm.test" };
function fixture() {
  return {
    team: { members: [{ email: "a@firm.test", name: "A" }] },
    declarations: {
      "a@firm.test": {
        name: "A",
        at: "2026-10-17",
        answers: {
          C01: {
            answer: "Oui",
            detail: "Mon conjoint travaille chez le client.",
          },
        },
        threats: ["C01 Relation familiale"],
      },
    },
  };
}
function input(o, action, extra = {}) {
  const c = independenceCases(o)[0];
  return {
    action,
    case_id: c.id,
    version: c.version,
    note: "Décision humaine motivée",
    ...extra,
  };
}
test("explanations drive targeted proposals, without automatic resolution", () => {
  const o = fixture(),
    c = independenceCases(o)[0];
  assert.equal(c.status, "pending");
  assert.ok(c.suggestions.some((s) => s.id === "restrict_scope"));
  assert.ok(
    safeguardSuggestions("Je possède des actions").some(
      (s) => s.id === "end_interest",
    ),
  );
  assert.throws(
    () => assertIndependenceContinuation(o),
    /INDEPENDENCE_REVIEW_REQUIRED/,
  );
});
test("only partner/owner can decide; selection is not application; evidence required", () => {
  const o = fixture();
  assert.throws(
    () =>
      reviewIndependence(
        o,
        input(o, "independence-decide", { selected: ["independent_review"] }),
        { role: "manager", email: "m@test" },
      ),
    /PARTNER_OR_OWNER/,
  );
  const c = reviewIndependence(
    o,
    input(o, "independence-decide", { selected: ["independent_review"] }),
    partner,
  );
  assert.equal(c.status, "measures_pending");
  assert.equal(c.responsible, partner.email);
  assert.throws(
    () => reviewIndependence(o, input(o, "independence-applied"), partner),
    /APPLICATION_EVIDENCE/,
  );
  reviewIndependence(
    o,
    input(o, "independence-applied", {
      evidence: "Revue indépendante documentée dans le WP",
    }),
    { role: "owner", email: "owner@test" },
  );
  assert.doesNotThrow(() => assertIndependenceContinuation(o));
});
test("management override requires business reason and applicable-rule review; threat remains open and traced", () => {
  const o = fixture();
  assert.throws(
    () => reviewIndependence(o, input(o, "independence-override"), partner),
    /BUSINESS_REASON/,
  );
  assert.throws(
    () =>
      reviewIndependence(
        o,
        input(o, "independence-override", {
          business_reason: "Planning urgent",
        }),
        partner,
      ),
    /APPLICABLE_RULE/,
  );
  const c = reviewIndependence(
    o,
    input(o, "independence-override", {
      business_reason: "Préparer le dossier sans participation aux tests",
      regulatory_basis: "Analyse documentée par le Partner",
      confirm_no_prohibition: true,
    }),
    partner,
  );
  assert.equal(c.status, "override_open");
  assert.equal(c.independence_resolved, false);
  assert.equal(c.application, null);
  assert.equal(o.independence_history.length, 1);
  assert.throws(() => assertIndependenceContinuation(o), /INDEPENDENCE_REVIEW/);
  assert.doesNotThrow(() =>
    assertIndependenceContinuation(o, { allowOverride: true }),
  );
});
test("confirmed prohibition cannot be overridden or silently replaced with safeguards", () => {
  const o = fixture();
  reviewIndependence(o, input(o, "independence-prohibit"), partner);
  for (const action of ["independence-override", "independence-decide"])
    assert.throws(
      () =>
        reviewIndependence(
          o,
          input(o, action, {
            business_reason: "Commercial",
            regulatory_basis: "Test",
            confirm_no_prohibition: true,
            selected: ["independent_review"],
          }),
          partner,
        ),
      /PROHIBITION/,
    );
  assert.throws(
    () => assertIndependenceContinuation(o, { allowOverride: true }),
    /PROHIBITION/,
  );
});
test("changed explanation invalidates previous decision and rejects stale browser submission", () => {
  const o = fixture(),
    old = input(o, "independence-decide", { selected: ["independent_review"] });
  reviewIndependence(o, old, partner);
  o.declarations["a@firm.test"].answers.C01.detail =
    "Je détiens aussi des actions.";
  assert.equal(independenceCases(o)[0].status, "pending");
  assert.throws(
    () => reviewIndependence(o, old, partner),
    /DECLARATION_CHANGED/,
  );
  assert.throws(
    () => assertIndependenceContinuation(o, { allowOverride: true }),
    /INDEPENDENCE_REVIEW/,
  );
  assert.equal(o.independence_history.length, 1);
});
test("replacement cannot be certified before actual team removal, history stays available afterward", () => {
  const o = fixture();
  reviewIndependence(
    o,
    input(o, "independence-decide", { selected: ["replace_member"] }),
    partner,
  );
  assert.throws(
    () =>
      reviewIndependence(
        o,
        input(o, "independence-applied", { evidence: "Décision" }),
        partner,
      ),
    /REMOVE_MEMBER/,
  );
  o.team.members = [];
  assert.doesNotThrow(() => assertIndependenceContinuation(o));
  reviewIndependence(
    o,
    input(o, "independence-applied", {
      evidence: "Équipe révisée et retrait confirmé",
    }),
    partner,
  );
  assert.equal(independenceCases(o)[0].status, "resolved");
});
test("a changed or withdrawn declaration cannot erase an existing prohibition", () => {
  const o = fixture();
  reviewIndependence(o, input(o, "independence-prohibit"), partner);
  o.declarations["a@firm.test"].answers.C01.answer = "Non";
  assert.throws(
    () => assertIndependenceContinuation(o, { allowOverride: true }),
    /PROHIBITION/,
  );
  assert.equal(independenceCases(o)[0].status, "prohibited");
});
test("withdrawal of a previously reviewed threat requires a fresh human review", () => {
  const o = fixture();
  reviewIndependence(
    o,
    input(o, "independence-decide", { selected: ["independent_review"] }),
    partner,
  );
  reviewIndependence(
    o,
    input(o, "independence-applied", { evidence: "WP revu" }),
    partner,
  );
  o.declarations["a@firm.test"].answers.C01 = {
    answer: "Non",
    detail: "Erreur de déclaration expliquée",
  };
  assert.equal(independenceCases(o)[0].status, "pending");
  assert.throws(
    () => assertIndependenceContinuation(o, { allowOverride: true }),
    /INDEPENDENCE_REVIEW/,
  );
  reviewIndependence(
    o,
    input(o, "independence-decide", { selected: ["confirm_correction"] }),
    partner,
  );
  reviewIndependence(
    o,
    input(o, "independence-applied", {
      evidence: "Correction examinée par le Partner",
    }),
    partner,
  );
  assert.doesNotThrow(() => assertIndependenceContinuation(o));
});
